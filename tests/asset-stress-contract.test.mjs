import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateAssetStress} from '../domain/asset-stress-contract.mjs';
// Entirely fictional; never substitute private account data in public tests.
const now=1792128000000,policy={nowMs:now,maxLedgerAgeMs:86400000,maxPriceAgeMs:120000};
function fixture(){return {ledger:{schemaVersion:1,currency:'KRW',asOfMs:now,accounts:[{
 accountRef:'fictional-A',sourceRef:'synthetic',verifiedAtMs:now,
 coverage:{holdings:true,cash:true,debts:true,obligations:true},holdings:[{ticker:'005930',quantity:10},{ticker:'000660',quantity:2}],
 cash:{balanceKrw:5000,withdrawableKrw:3000},debts:[{principalKrw:4000}],additionalOutflowsKrw:1000}]},
 prices:Object.fromEntries([['005930',100],['000660',500]].map(([ticker,priceKrw])=>[ticker,
 {priceKrw,currency:'KRW',quality:'VERIFIED',sourceRef:'synthetic',observedAtMs:now}])),
 scenario:{schemaVersion:1,id:'fictional-downside',shocksBps:{'005930':-1000,'000660':-1500}}};}
const run=f=>evaluateAssetStress(f.ledger,f.prices,f.scenario,policy);
test('explicit Samsung/Hynix shocks affect valuation, never cash/debt or observed inputs',()=>{
 const f=fixture(),copy=structuredClone(f),r=run(f);assert.deepEqual(f,copy);assert.deepEqual(r,run(f));
 assert.equal(r.status,'CALCULATED');assert.deepEqual(r.totals,{baseNetAssetsKrw:3000,stressedSecuritiesValueKrw:1750,
 stressedGrossAssetsKrw:6750,stressedNetAssetsKrw:2750,netAssetChangeKrw:-250,scenarioLossKrw:250});
 assert.equal(r.scope,'PRIVATE_LOCAL_SCENARIO_ONLY');assert.equal(r.inputCutoffMs,now);
 for(const key of ['probability','confidence','action','orderQuantity','collateralHeadroom'])assert.ok(!(key in r));
});
test('missing/stale/unverified base ledger data blocks every scenario total',()=>{
 for(const mutate of [f=>f.ledger.accounts[0].holdings[0].quantity=null,f=>delete f.ledger.accounts[0].debts,
 f=>f.prices['005930'].quality='UNVERIFIED_TIME',f=>f.prices['005930'].observedAtMs=now-120001,
 f=>f.ledger.accounts[0].coverage.cash=false]){
  const f=fixture();mutate(f);const r=run(f);assert.equal(r.status,'BLOCKED');assert.ok(Object.values(r.totals).every(x=>x===null));
 }
});
test('missing shock is unknown, explicit zero shock is valid, no default loss limit',()=>{
 const f=fixture();delete f.scenario.shocksBps['005930'];assert.equal(run(f).status,'BLOCKED');
 f.scenario.shocksBps={'005930':0,'000660':0};const r=run(f);
 assert.equal(r.status,'CALCULATED');assert.equal(r.totals.scenarioLossKrw,0);assert.equal(r.totals.netAssetChangeKrw,0);
 assert.ok(!('riskLimit' in r));assert.ok(!('investableCashKrw' in r.totals));
});
test('invalid/nonfinite/coerced shock input is rejected without defaulting zero',()=>{
 for(const shocksBps of [null,[],{'005930':null},{'005930':'-1000'},{'005930':NaN},
 {'005930':-10001},{'005930':Infinity},{'005930':-1.5},{bad:0}]){
  const f=fixture();f.scenario.shocksBps=shocksBps;assert.equal(run(f).status,'BLOCKED');
 }
});
test('exact whole-KRW floor and negative net assets survive; overflow fails closed',()=>{
 const f=fixture();f.ledger.accounts[0].holdings=[{ticker:'005930',quantity:1}];f.prices['005930'].priceKrw=101;
 f.scenario.shocksBps={'005930':-5000};f.ledger.accounts[0].debts[0].principalKrw=9000;
 let r=run(f);assert.equal(r.totals.stressedSecuritiesValueKrw,50);assert.equal(r.totals.stressedNetAssetsKrw,-3950);
 f.ledger.accounts[0].cash={balanceKrw:0,withdrawableKrw:0};f.ledger.accounts[0].debts=[];
 f.prices['005930'].priceKrw=Number.MAX_SAFE_INTEGER;f.scenario.shocksBps={'005930':10000};
 r=run(f);assert.equal(r.status,'BLOCKED');assert.equal(r.issues[0].code,'ARITHMETIC_OVERFLOW');
});
