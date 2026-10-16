import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPrivateRiskSummary} from '../domain/private-risk-summary.mjs';
const now=1792130400000,day=86400000;
const policy={nowMs:now,maxLedgerAgeMs:day,maxPriceAgeMs:120000,horizonAtMs:now+day};
function fixture(){return {ledger:{schemaVersion:1,currency:'KRW',asOfMs:now,accounts:[{
 accountRef:'fictional-A',sourceRef:'synthetic',verifiedAtMs:now,coverage:{holdings:true,cash:true,debts:true,obligations:true},
 holdings:[{ticker:'005930',quantity:10},{ticker:'000660',quantity:2}],cash:{balanceKrw:5000,withdrawableKrw:1000},
 debts:[{principalKrw:4000}],additionalOutflowsKrw:1500}]},
 prices:Object.fromEntries([['005930',100],['000660',500]].map(([t,priceKrw])=>[t,
 {priceKrw,currency:'KRW',quality:'VERIFIED',sourceRef:'synthetic',observedAtMs:now}])),
 scenario:{schemaVersion:1,id:'fictional-shock',shocksBps:{'005930':-1000,'000660':-1500}},
 schedule:{schemaVersion:1,ledgerAsOfMs:now,accounts:[{accountRef:'fictional-A',coverageComplete:true,obligations:[{
 obligationRef:'fictional-due',amountKrw:1500,dueAtMs:now+day,status:'OPEN',cashTreatment:'NOT_DEDUCTED_FROM_WITHDRAWABLE',
 sourceRef:'synthetic',verifiedAtMs:now}]}]}};}
test('separate valid components remain partial analysis; no reserve means investable cash unavailable',()=>{
 const f=fixture(),copy=structuredClone(f),r=buildPrivateRiskSummary(f,policy);
 assert.deepEqual(f,copy);assert.deepEqual(r,buildPrivateRiskSummary(f,policy));
 assert.equal(r.status,'PARTIAL');assert.equal(r.scope,'PRIVATE_LOCAL_RISK_SUMMARY_ONLY');
 assert.equal(r.capabilities.valuation,'AVAILABLE');assert.equal(r.capabilities.priceStress,'AVAILABLE');
 assert.equal(r.capabilities.cashDeadlines,'AVAILABLE');assert.equal(r.capabilities.investableCash,'UNAVAILABLE');
 assert.equal(r.components.cashDeadlines.totals.accountShortfallSumKrw,500);
 assert.equal(r.components.cashDeadlines.riskEvents[0].type,'CASH_SHORTFALL_AT_DEADLINE');
 for(const k of ['collateral','tax','tradeDecision','notifications'])assert.equal(r.capabilities[k],'UNAVAILABLE');
 assert.ok(!('safe' in r));assert.ok(!('action' in r));assert.ok(!('confidence' in r));
});
test('missing/unverified price blocks valuation/stress without hiding direct cash risk',()=>{
 for(const mutate of [f=>delete f.prices['005930'],f=>f.prices['005930'].quality='UNVERIFIED_TIME']){
  const f=fixture();mutate(f);const r=buildPrivateRiskSummary(f,policy);
  assert.equal(r.capabilities.valuation,'UNAVAILABLE');assert.equal(r.capabilities.priceStress,'UNAVAILABLE');
  assert.equal(r.capabilities.cashDeadlines,'AVAILABLE');assert.equal(r.components.cashDeadlines.totals.accountShortfallSumKrw,500);
 }
});
test('missing deadline blocks cash output while valid asset/scenario results remain separately usable',()=>{
 const f=fixture();delete f.schedule.accounts[0].obligations[0].dueAtMs;
 const r=buildPrivateRiskSummary(f,{...policy,reserveKrw:0});
 assert.equal(r.capabilities.valuation,'AVAILABLE');assert.equal(r.capabilities.priceStress,'AVAILABLE');
 assert.equal(r.capabilities.cashDeadlines,'UNAVAILABLE');assert.equal(r.capabilities.investableCash,'AVAILABLE');
 assert.equal(r.components.cashDeadlines.totals.accountShortfallSumKrw,null);
 assert.ok(r.components.cashDeadlines.issues.length>0);assert.equal(r.status,'PARTIAL');
});
test('component policy exception is isolated and generic; common reference remains mandatory',()=>{
 const f=fixture(),r=buildPrivateRiskSummary(f,{...policy,maxPriceAgeMs:null});
 assert.equal(r.capabilities.valuation,'UNAVAILABLE');assert.equal(r.capabilities.priceStress,'UNAVAILABLE');
 assert.equal(r.capabilities.cashDeadlines,'AVAILABLE');
 assert.deepEqual(r.components.valuation,{status:'BLOCKED',issues:[{code:'COMPONENT_INPUT_OR_POLICY_REJECTED'}]});
 assert.throws(()=>buildPrivateRiskSummary(f,{...policy,nowMs:NaN}),/INVALID_RISK_SUMMARY_REFERENCE_TIME/);
 const stale=buildPrivateRiskSummary(f,{...policy,nowMs:now+2*day,horizonAtMs:now+3*day});
 for(const key of ['valuation','priceStress','cashDeadlines'])assert.equal(stale.capabilities[key],'UNAVAILABLE');
 f.ledger.asOfMs=now+1;const future=buildPrivateRiskSummary(f,policy);
 assert.equal(future.inputCutoffMs,null);assert.equal(future.components.cashDeadlines.inputCutoffMs,null);
 for(const key of ['valuation','priceStress','cashDeadlines'])assert.equal(future.capabilities[key],'UNAVAILABLE');
});
