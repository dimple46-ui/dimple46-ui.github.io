import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateConcentration} from '../domain/concentration-contract.mjs';
const now=1792130400000,policy={nowMs:now,maxLedgerAgeMs:86400000,maxPriceAgeMs:120000,denominator:'DECLARED_SECURITIES_VALUE'};
function fixture(){return {ledger:{schemaVersion:1,currency:'KRW',asOfMs:now,accounts:[{
 accountRef:'fictional-A',sourceRef:'synthetic',verifiedAtMs:now,coverage:{holdings:true,cash:true,debts:true,obligations:true},
 holdings:[{ticker:'005930',quantity:10},{ticker:'000660',quantity:2}],cash:{balanceKrw:5000,withdrawableKrw:1000},
 debts:[{principalKrw:4000}],additionalOutflowsKrw:0}]},prices:Object.fromEntries([['005930',100],['000660',500]].map(([ticker,priceKrw])=>
 [ticker,{priceKrw,currency:'KRW',quality:'VERIFIED',sourceRef:'synthetic',observedAtMs:now}]))};}
const run=(f,p=policy)=>evaluateConcentration(f.ledger,f.prices,p);
test('explicit denominator distinguishes securities weights from declared gross-asset exposure',()=>{
 const f=fixture(),copy=structuredClone(f),s=run(f),g=run(f,{...policy,denominator:'DECLARED_GROSS_ASSETS'});
 assert.deepEqual(f,copy);assert.deepEqual(s,run(f));assert.equal(s.status,'CALCULATED');
 assert.equal(s.denominatorKrw,2000);assert.equal(s.samsungHynixCombined.weightBps,10000);
 assert.deepEqual(s.perTicker.map(x=>x.weightBps),[5000,5000]);
 assert.equal(g.denominatorKrw,7000);assert.equal(g.samsungHynixCombined.weightBps,2857);
 assert.deepEqual(g.perTicker.map(x=>x.weightBps),[1428,1428]);
 assert.equal(g.precision,'FLOOR_BASIS_POINTS_NOT_NORMALIZED');
 for(const k of ['maxWeight','riskLimit','action','taxThreshold','safe'])assert.ok(!(k in g));
});
test('same ticker across covered accounts is aggregated once; account ordering does not change result',()=>{
 const f=fixture(),a=structuredClone(f.ledger.accounts[0]);a.accountRef='fictional-B';
 a.holdings=[{ticker:'005930',quantity:5}];a.cash={balanceKrw:0,withdrawableKrw:0};a.debts=[];
 f.ledger.accounts.push(a);const r=run(f);
 assert.equal(r.perTicker.find(x=>x.ticker==='005930').valueKrw,1500);
 assert.equal(r.perTicker.find(x=>x.ticker==='005930').weightBps,6000);assert.equal(r.denominatorKrw,2500);
 f.ledger.accounts.reverse();assert.deepEqual(run(f),r);
});
test('missing/null/stale/unverified inputs block all exposure, not partial-account totals',()=>{
 for(const mutate of [f=>delete f.prices['005930'],f=>f.prices['005930'].quality='UNVERIFIED_TIME',
 f=>f.prices['005930'].observedAtMs=now-120001,f=>f.ledger.accounts[0].holdings[0].quantity=null,
 f=>f.ledger.accounts[0].coverage.holdings=false,f=>delete f.ledger.accounts[0].debts,
 f=>f.ledger.asOfMs=now+1]){
  const f=fixture();mutate(f);const r=run(f);assert.equal(r.status,'BLOCKED');assert.equal(r.denominatorKrw,null);
  assert.deepEqual(r.perTicker,[]);assert.equal(r.samsungHynixCombined,null);
 }
});
test('empty covered positions mean known zero value but undefined zero-denominator weight',()=>{
 const f=fixture();f.ledger.accounts[0].holdings=[];
 let r=run(f);assert.equal(r.status,'UNAVAILABLE');assert.equal(r.denominatorKrw,0);
 assert.equal(r.samsungHynixCombined.valueKrw,0);assert.equal(r.samsungHynixCombined.weightBps,null);
 r=run(f,{...policy,denominator:'DECLARED_GROSS_ASSETS'});
 assert.equal(r.status,'CALCULATED');assert.equal(r.samsungHynixCombined.weightBps,0);
});
test('zero-quantity holding needs no quote, denominator policy is never defaulted to net assets',()=>{
 const f=fixture();f.ledger.accounts[0].holdings[0].quantity=0;delete f.prices['005930'];
 const r=run(f);assert.equal(r.perTicker.length,1);assert.equal(r.samsungHynixCombined.weightBps,10000);
 for(const denominator of [undefined,null,'NET_ASSETS','UNKNOWN'])
  assert.throws(()=>run(f,{...policy,denominator}),/EXPLICIT_CONCENTRATION_DENOMINATOR_REQUIRED/);
});
test('large safe monetary values use exact integer ratios without overflow or forced normalization',()=>{
 const f=fixture(),a=f.ledger.accounts[0];a.cash={balanceKrw:0,withdrawableKrw:0};a.debts=[];
 a.holdings=[{ticker:'005930',quantity:1},{ticker:'000660',quantity:1}];
 f.prices['005930'].priceKrw=Number.MAX_SAFE_INTEGER-1;f.prices['000660'].priceKrw=1;
 const r=run(f);assert.equal(r.status,'CALCULATED');assert.equal(r.denominatorKrw,Number.MAX_SAFE_INTEGER);
 assert.equal(r.perTicker.find(x=>x.ticker==='005930').weightBps,9999);
 assert.equal(r.perTicker.find(x=>x.ticker==='000660').weightBps,0);
 assert.equal(r.samsungHynixCombined.weightBps,10000);
 a.holdings[0].quantity=2;assert.equal(run(f).status,'BLOCKED');
});
