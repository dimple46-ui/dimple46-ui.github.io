import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCashDeadlines} from '../domain/cash-deadline-contract.mjs';
const now=1792130400000,day=86400000;
const policy={nowMs:now,maxLedgerAgeMs:day,horizonAtMs:now+3*day};
function fixture(){return {ledger:{schemaVersion:1,currency:'KRW',asOfMs:now,accounts:[{
 accountRef:'fictional-A',sourceRef:'synthetic',verifiedAtMs:now,
 coverage:{cash:true,obligations:true},cash:{balanceKrw:9000,withdrawableKrw:1000},additionalOutflowsKrw:1500}]},
 schedule:{schemaVersion:1,ledgerAsOfMs:now,accounts:[{accountRef:'fictional-A',coverageComplete:true,
 obligations:[obligation('one',600,now+day),obligation('two',500,now+2*day),obligation('later',400,now+4*day)]}]}};}
function obligation(id,amountKrw,dueAtMs){return {obligationRef:`fictional-${id}`,amountKrw,dueAtMs,
 status:'OPEN',cashTreatment:'NOT_DEDUCTED_FROM_WITHDRAWABLE',sourceRef:'synthetic',verifiedAtMs:now};}
const run=(f,p=policy)=>evaluateCashDeadlines(f.ledger,f.schedule,p);
test('dated cash shortage uses withdrawable, not balance; includes horizon and keeps later obligations separate',()=>{
 const f=fixture(),copy=structuredClone(f),r=run(f);assert.deepEqual(f,copy);assert.deepEqual(r,run(f));
 assert.equal(r.status,'CALCULATED');assert.equal(r.accounts[0].balanceKrw,9000);
 assert.equal(r.accounts[0].cashHeadroomKrw,-100);assert.equal(r.accounts[0].deadlines[0].cashHeadroomKrw,400);
 assert.deepEqual(r.totals,{dueThroughHorizonKrw:1100,accountShortfallSumKrw:100,earliestShortfallDueAtMs:now+2*day});
 assert.equal(r.riskEvents[0].type,'CASH_SHORTFALL_AT_DEADLINE');
 assert.ok(!('investableCashKrw' in r.totals));assert.ok(!('action' in r));
});
test('account surplus cannot hide another account shortage; no transfer is inferred',()=>{
 const f=fixture(),b=structuredClone(f.ledger.accounts[0]);b.accountRef='fictional-B';b.cash.withdrawableKrw=8000;b.additionalOutflowsKrw=0;
 f.ledger.accounts.push(b);f.schedule.accounts.push({accountRef:b.accountRef,coverageComplete:true,obligations:[]});
 const r=run(f);assert.equal(r.status,'CALCULATED');assert.equal(r.totals.accountShortfallSumKrw,100);
 assert.equal(r.accounts[1].shortfallKrw,0);
});
test('missing dates/amount/coverage or schedule mismatch blocks every total instead of inventing zero',()=>{
 for(const mutate of [f=>f.schedule.accounts[0].obligations[0].dueAtMs=null,
 f=>f.schedule.accounts[0].obligations[0].amountKrw=null,f=>f.schedule.accounts[0].coverageComplete=false,
 f=>f.ledger.accounts[0].coverage.cash=false,f=>delete f.ledger.accounts[0].cash.withdrawableKrw,
 f=>f.schedule.ledgerAsOfMs--,f=>f.ledger.accounts[0].additionalOutflowsKrw++,
 f=>f.schedule.accounts=[],f=>f.ledger.accounts=[]]){
  const f=fixture();mutate(f);const r=run(f);assert.equal(r.status,'BLOCKED');
  assert.ok(Object.values(r.totals).every(v=>v===null));assert.deepEqual(r.accounts,[]);assert.deepEqual(r.riskEvents,[]);
 }
});
test('overdue open payment is a separate direct risk even when cash fully covers it',()=>{
 const f=fixture();f.schedule.accounts[0].obligations=[obligation('past',1500,now-1)];
 f.ledger.accounts[0].cash.withdrawableKrw=2000;
 const r=run(f);assert.equal(r.totals.accountShortfallSumKrw,0);assert.equal(r.accounts[0].overdueOpenCount,1);
 assert.deepEqual(r.riskEvents.map(e=>e.type),['OVERDUE_OPEN_OBLIGATION']);
});
test('same deadline amounts are grouped and input order does not change coverage',()=>{
 const f=fixture();f.schedule.accounts[0].obligations[1].dueAtMs=now+day;
 const a=run(f);f.schedule.accounts[0].obligations.reverse();const b=run(f);
 assert.deepEqual(a,b);assert.equal(a.accounts[0].deadlines.length,1);
 assert.equal(a.totals.earliestShortfallDueAtMs,now+day);
});
test('empty covered schedule and explicit zero are valid; due exactly at now/horizon is included',()=>{
 const f=fixture();f.schedule.accounts[0].obligations=[];f.ledger.accounts[0].additionalOutflowsKrw=0;
 let r=run(f);assert.equal(r.status,'CALCULATED');assert.equal(r.totals.dueThroughHorizonKrw,0);
 assert.equal(r.totals.earliestShortfallDueAtMs,null);
 f.schedule.accounts[0].obligations=[obligation('now',0,now),obligation('edge',1500,policy.horizonAtMs)];
 f.ledger.accounts[0].additionalOutflowsKrw=1500;r=run(f);
 assert.equal(r.totals.dueThroughHorizonKrw,1500);assert.equal(r.totals.accountShortfallSumKrw,500);
 assert.equal(r.accounts[0].overdueOpenCount,0);
});
test('stale/future verification, paid/already-deducted, duplicate and coercion inputs fail closed',()=>{
 for(const mutate of [f=>f.ledger.asOfMs=now+1,f=>f.ledger.accounts[0].verifiedAtMs=now-day-1,
 f=>f.schedule.accounts[0].obligations[0].verifiedAtMs=now+1,
 f=>f.schedule.accounts[0].obligations[0].status='PAID',
 f=>f.schedule.accounts[0].obligations[0].cashTreatment='ALREADY_DEDUCTED',
 f=>f.schedule.accounts[0].obligations[0].amountKrw='600',
 f=>f.schedule.accounts[0].obligations.push(structuredClone(f.schedule.accounts[0].obligations[0])),
 f=>f.schedule.accounts.push(structuredClone(f.schedule.accounts[0])),
 f=>f.schedule.accounts.push({accountRef:'undeclared',coverageComplete:true,obligations:[]})]){
  const f=fixture();mutate(f);assert.equal(run(f).status,'BLOCKED');
 }
 assert.throws(()=>run(fixture(),{...policy,horizonAtMs:now-1}),/INVALID_CASH_DEADLINE_POLICY/);
});
test('aggregate safe-integer overflow blocks output, even when each account is individually valid',()=>{
 const f=fixture(),a=f.ledger.accounts[0];a.cash={balanceKrw:0,withdrawableKrw:0};a.additionalOutflowsKrw=Number.MAX_SAFE_INTEGER;
 f.schedule.accounts[0].obligations=[obligation('max',Number.MAX_SAFE_INTEGER,now)];
 const b=structuredClone(a);b.accountRef='fictional-B';f.ledger.accounts.push(b);
 f.schedule.accounts.push({accountRef:b.accountRef,coverageComplete:true,obligations:[obligation('max-b',Number.MAX_SAFE_INTEGER,now)]});
 const r=run(f);assert.equal(r.status,'BLOCKED');assert.ok(r.issues.some(x=>x.code==='ARITHMETIC_OVERFLOW'));
});
