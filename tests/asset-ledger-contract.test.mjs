import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateAssetLedger} from '../domain/asset-ledger-contract.mjs';
// Fictional round numbers and references only. Never replace with personal account data.
const now=Date.parse('2026-10-16T04:00:00Z');
const policy={nowMs:now,maxLedgerAgeMs:86400000,maxPriceAgeMs:120000,reserveKrw:500};
function fixture(){return {ledger:{schemaVersion:1,currency:'KRW',asOfMs:now,accounts:[{
 accountRef:'fictional-account-A',sourceRef:'synthetic-fixture',verifiedAtMs:now-1000,
 coverage:{holdings:true,cash:true,debts:true,obligations:true},
 holdings:[{ticker:'005930',quantity:10},{ticker:'000660',quantity:2}],
 cash:{balanceKrw:5000,withdrawableKrw:3000},debts:[{principalKrw:4000}],additionalOutflowsKrw:1000}]},
 prices:{'005930':{priceKrw:100,currency:'KRW',quality:'VERIFIED',sourceRef:'synthetic',observedAtMs:now-1000},
 '000660':{priceKrw:500,currency:'KRW',quality:'VERIFIED',sourceRef:'synthetic',observedAtMs:now-1000}}};}
const run=(f,p=policy)=>evaluateAssetLedger(f.ledger,f.prices,p);
test('fictional assets, debt, withdrawable and investable cash stay distinct and deterministic',()=>{
 const f=fixture(),before=structuredClone(f),r=run(f);assert.deepEqual(f,before);assert.deepEqual(r,run(f));
 assert.equal(r.status,'CALCULATED');assert.deepEqual(r.totals,{securitiesValueKrw:2000,grossAssetsKrw:7000,
 debtPrincipalKrw:4000,netAssetsKrw:3000,withdrawableCashKrw:3000,additionalOutflowsKrw:1000,
 cashHeadroomAfterReserveKrw:1500,investableCashKrw:1500,cashShortfallKrw:0});
});
test('unknown holdings, cash, debt or scope blocks every total instead of inventing zero',()=>{
 for(const mutate of [a=>delete a.holdings,a=>a.holdings[0].quantity=null,a=>delete a.cash,
 a=>a.cash.withdrawableKrw=null,a=>delete a.debts,a=>a.debts[0].principalKrw=null,
 a=>delete a.additionalOutflowsKrw,a=>a.coverage.debts=false]){
  const f=fixture();mutate(f.ledger.accounts[0]);const r=run(f);assert.equal(r.status,'BLOCKED');
  assert.ok(r.issues.length);assert.ok(Object.values(r.totals).every(v=>v===null));
 }
 const f=fixture();f.ledger.accounts=[];assert.equal(run(f).status,'BLOCKED');
});
test('explicit zero balances/empty covered holdings and debt are valid; reserve is never defaulted',()=>{
 const f=fixture(),a=f.ledger.accounts[0];a.holdings=[];a.debts=[];a.cash={balanceKrw:0,withdrawableKrw:0};a.additionalOutflowsKrw=0;
 const r=run(f,{...policy,reserveKrw:0});assert.equal(r.status,'CALCULATED');assert.equal(r.totals.netAssetsKrw,0);
 const p=run(f,{...policy,reserveKrw:undefined});assert.equal(p.status,'PARTIAL');
 assert.equal(p.totals.withdrawableCashKrw,0);assert.equal(p.totals.investableCashKrw,null);
});
test('cash shortfall and negative net assets remain visible without prescribing transactions',()=>{
 const f=fixture();f.ledger.accounts[0].additionalOutflowsKrw=4000;f.ledger.accounts[0].debts[0].principalKrw=9000;
 const r=run(f);assert.equal(r.totals.netAssetsKrw,-2000);assert.equal(r.totals.cashShortfallKrw,1500);
 assert.equal(r.totals.investableCashKrw,0);assert.equal(r.totals.cashHeadroomAfterReserveKrw,-1500);
 assert.ok(!('action' in r));
});
test('stale/future/unverified prices and stale ledger evidence cannot pass',()=>{
 for(const mutate of [f=>f.prices['005930'].quality='STALE_INPUT',f=>f.prices['005930'].quality='UNVERIFIED_TIME',
 f=>f.prices['005930'].observedAtMs=now+1,f=>f.prices['005930'].observedAtMs=now-120001,
 f=>f.ledger.accounts[0].verifiedAtMs=now-86400001,f=>f.ledger.asOfMs=now+1]){
  const f=fixture();mutate(f);assert.equal(run(f).status,'BLOCKED');
 }
});
test('duplicate accounts/holdings, currency, coercion, negative/nonfinite/overflow amounts fail closed',()=>{
 for(const mutate of [f=>f.ledger.accounts.push(structuredClone(f.ledger.accounts[0])),
 f=>f.ledger.accounts[0].holdings.push({ticker:'005930',quantity:1}),f=>f.ledger.currency='USD',
 f=>f.ledger.accounts[0].cash.balanceKrw='5000',f=>f.ledger.accounts[0].debts[0].principalKrw=-1,
 f=>f.prices['005930'].priceKrw=Infinity,f=>f.ledger.accounts[0].holdings[0].quantity=Number.MAX_SAFE_INTEGER]){
  const f=fixture();mutate(f);assert.equal(run(f).status,'BLOCKED');
 }
 assert.throws(()=>run(fixture(),{...policy,maxPriceAgeMs:null}),/INVALID_LEDGER_POLICY/);
});
