// Fictional amounts/identities only. Model arithmetic is NOT broker, settlement or investment validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCashFundingScenarios} from '../domain/cash-funding-scenarios.mjs';
const now=1792132200000,day=86400000;
const policy={nowMs:now,maxLedgerAgeMs:1000,maxPriceAgeMs:1000,accountReserveKrw:100};
function fixture(){
 const plan=(id,sales)=>({id,kind:sales.length?'SECURITY_SALE':'CASH_ONLY',sales,
  costs:{feesKrw:sales.length?20:0,taxesKrw:sales.length?10:0},proceedsAvailableAtMs:sales.length?now+day:null,
  sourceRef:'fictional-explicit-assumptions',verifiedAtMs:now,expiresAtMs:now+1000,invalidation:'Recheck if prices, costs, timing or holdings change'});
 return {schemaVersion:1,ledger:{schemaVersion:1,currency:'KRW',asOfMs:now,accounts:[{
  accountRef:'fictional-A',sourceRef:'fictional-only',verifiedAtMs:now,coverage:{holdings:true,cash:true,debts:true,obligations:true},
  holdings:[{ticker:'005930',quantity:10},{ticker:'000660',quantity:2}],cash:{balanceKrw:1000,withdrawableKrw:300},
  debts:[{principalKrw:400}],additionalOutflowsKrw:100}]},
  prices:Object.fromEntries([['005930',100],['000660',500]].map(([ticker,priceKrw])=>[ticker,
   {priceKrw,currency:'KRW',quality:'VERIFIED',sourceRef:'fictional-quote',observedAtMs:now}])),
  need:{accountRef:'fictional-A',amountKrw:800,dueAtMs:now+2*day,cashTreatment:'ADDITIONAL_TO_DECLARED_OUTFLOWS',
   cashUse:'OUTFLOW_OUTSIDE_DECLARED_FINANCIAL_SCOPE',sourceRef:'fictional-additional-need',verifiedAtMs:now},
  stressScenario:{schemaVersion:1,id:'fictional-downside',shocksBps:{'005930':-1000,'000660':-2000}},
  plans:[plan('cash-only',[]),plan('samsung',[{ticker:'005930',quantity:7}]),plan('hynix',[{ticker:'000660',quantity:2}]),
   plan('split',[{ticker:'005930',quantity:4},{ticker:'000660',quantity:1}])]};
}
const run=(f=fixture(),p=policy)=>compareCashFundingScenarios(f,p);
test('four explicit funding plans reuse valuations/concentration/stress and compare exact costs, cash gaps and unchanged debt',()=>{
 const r=run();assert.equal(r.status,'SCENARIO_COMPARISON_ONLY');assert.equal(r.baseline.valuation.grossAssetsKrw,3000);
 assert.equal(r.baseline.valuation.netAssetsKrw,2600);assert.equal(r.baseline.liquidity.cashShortfallKrw,700);
 assert.equal(r.baseline.leverage.debtToGrossAssetsBps,1333);assert.equal(r.baseline.leverage.debtToNetAssetsBps,1538);
 assert.equal(r.baseline.stress.totals.scenarioLossKrw,300);
 assert.deepEqual(r.rows.map(x=>x.status),['KNOWN_CASH_SHORTFALL','KNOWN_CASH_SHORTFALL','MODEL_COVERS_DECLARED_NEED','MODEL_COVERS_DECLARED_NEED']);
 assert.deepEqual(r.rows.map(x=>x.funding.cashShortfallAtDeadlineKrw),[700,30,0,0]);
 assert.deepEqual(r.rows.map(x=>x.projected.stress.totals.scenarioLossKrw),[300,230,100,160]);
 for(const row of r.rows.slice(1)){
  assert.equal(row.projected.valuation.grossAssetsKrw,2970);assert.equal(row.projected.valuation.debtPrincipalKrw,400);
  assert.equal(row.projected.valuation.netAssetsKrw,2570);assert.equal(row.projected.leverage.debtToGrossAssetsBps,1346);
  assert.equal(row.projected.temporalScope,'AFTER_ALL_DECLARED_PROCEEDS_BEFORE_TARGET_PAYMENT');
 }
 assert.equal(r.rows[1].projected.concentration.perTicker.find(x=>x.ticker==='005930').valueKrw,300);
 assert.equal(r.rows[3].projected.valuation.withdrawableCashKrw,1170);assert.equal(r.recommendation,null);assert.equal(r.ranking,null);assert.equal(r.automaticOrder,false);
});
test('same input is deterministic and frozen inputs/outputs do not mutate the declared ledger or plan',()=>{
 const f=fixture(),original=structuredClone(f);const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};freeze(f);
 const r=run(f);assert.deepEqual(r,run(f));r.rows[1].projected.valuation.netAssetsKrw=0;assert.deepEqual(f,original);
 assert.equal(r.inputCutoffMs,now);assert.equal(r.generatedAtMs,now);assert.ok(!JSON.stringify(r).includes('fictional-A'));
});
test('late proceeds cannot erase deadline shortfall even when the all-settled projection would cover it',()=>{
 const f=fixture();f.plans[2].proceedsAvailableAtMs=f.need.dueAtMs+1;const r=run(f).rows[2];
 assert.equal(r.status,'MISSES_DEADLINE');assert.equal(r.funding.proceedsAvailableByDeadline,false);
 assert.equal(r.funding.cashShortfallAtDeadlineKrw,700);assert.equal(r.funding.cashShortfallAfterAllProceedsKrw,0);
 assert.equal(r.funding.cashAtDeadlineKrw,300);assert.equal(r.projected.valuation.withdrawableCashKrw,1270);
});
test('existing sufficient cash remains distinct from timely sale proceeds; exact deadline availability is allowed only as declared assumption',()=>{
 const f=fixture();f.need.amountKrw=100;f.plans[1].proceedsAvailableAtMs=f.need.dueAtMs+1;
 let r=run(f);assert.equal(r.rows[0].status,'MODEL_COVERS_DECLARED_NEED');assert.equal(r.rows[1].status,'MODEL_COVERS_DECLARED_NEED');
 assert.equal(r.rows[1].funding.proceedsAvailableByDeadline,false);
 f.need.amountKrw=800;f.plans[2].proceedsAvailableAtMs=f.need.dueAtMs;r=run(f);assert.equal(r.rows[2].funding.cashShortfallAtDeadlineKrw,0);
});
test('missing/null/negative/coerced/unsupported policy and need do not calculate or invent cash',()=>{
 for(const p of [null,{...policy,accountReserveKrw:undefined},{...policy,accountReserveKrw:null},{...policy,nowMs:Infinity},
  {...policy,maxPriceAgeMs:-1}])assert.equal(run(fixture(),p).status,'BLOCKED');
 for(const change of [f=>f.need.amountKrw=null,f=>f.need.amountKrw='800',f=>f.need.amountKrw=0,f=>f.need.amountKrw=-1,
  f=>f.need.dueAtMs=now-1,f=>f.need.cashTreatment='ALREADY_IN_DECLARED_OUTFLOWS',f=>f.need.cashUse='INTERNAL_TRANSFER',
  f=>f.need.accountRef='other',f=>f.need.verifiedAtMs=now+1,f=>delete f.need.sourceRef]){
  const f=fixture();change(f);const r=run(f);assert.equal(r.status,'BLOCKED');assert.equal(r.baseline,null);assert.deepEqual(r.rows,[]);
 }
});
test('missing quantities, cash, debt, coverage, future/stale/unverified prices block all financial projections',()=>{
 for(const change of [f=>f.ledger.accounts[0].holdings[0].quantity=null,f=>f.ledger.accounts[0].cash.withdrawableKrw=null,
  f=>delete f.ledger.accounts[0].debts,f=>f.ledger.accounts[0].debts[0].principalKrw=NaN,
  f=>f.ledger.accounts[0].coverage.obligations=false,f=>f.prices['005930'].quality='STALE_INPUT',
  f=>f.prices['005930'].quality='UNVERIFIED_TIME',f=>f.prices['005930'].observedAtMs=now-1001,
  f=>f.prices['005930'].observedAtMs=now+1,f=>f.ledger.accounts[0].verifiedAtMs=now-1001]){
  const f=fixture();change(f);const r=run(f);assert.equal(r.status,'BLOCKED');assert.equal(r.baseline,null);
 }
});
test('explicit cost zero is retained, absent/null/nonfinite/negative costs block only that plan',()=>{
 for(const change of [p=>delete p.costs.taxesKrw,p=>p.costs.feesKrw=null,p=>p.costs.taxesKrw=Infinity,p=>p.costs.feesKrw=-1]){
  const f=fixture();change(f.plans[2]);const r=run(f);assert.equal(r.status,'PARTIAL');assert.equal(r.rows[2].status,'BLOCKED');assert.equal(r.rows[2].projected,null);
  assert.equal(r.rows[3].status,'MODEL_COVERS_DECLARED_NEED');
 }
 const f=fixture();f.plans[1].costs={feesKrw:0,taxesKrw:0};const r=run(f).rows[1];assert.equal(r.funding.feesKrw,0);assert.equal(r.funding.cashShortfallAtDeadlineKrw,0);
});
test('overselling, zero/decimal sales, duplicate legs, invalid ticker and nonzero cash-only costs fail closed',()=>{
 for(const change of [p=>p.sales[0].quantity=11,p=>p.sales[0].quantity=0,p=>p.sales[0].quantity=1.5,
  p=>p.sales.push({...p.sales[0]}),p=>p.sales[0].ticker='999999',p=>p.sales[0].quantity=Number.MAX_SAFE_INTEGER]){
  const f=fixture();change(f.plans[1]);const r=run(f).rows[1];assert.equal(r.status,'BLOCKED');assert.equal(r.funding,null);
 }
 const f=fixture();f.plans[0].costs.feesKrw=1;assert.equal(run(f).rows[0].status,'BLOCKED');
});
test('other accounts cannot fund the chosen account, supply its sale quantities or conceal missing account scope',()=>{
 const f=fixture(),a=structuredClone(f.ledger.accounts[0]);a.accountRef='fictional-B';a.cash={balanceKrw:100000,withdrawableKrw:100000};
 f.ledger.accounts.push(a);let r=run(f);assert.equal(r.baseline.liquidity.cashShortfallKrw,700);assert.equal(r.rows[0].funding.cashShortfallAtDeadlineKrw,700);
 f.ledger.accounts[0].holdings[0].quantity=1;r=run(f);assert.equal(r.rows[1].status,'BLOCKED');
 assert.equal(r.rows[3].status,'BLOCKED');assert.equal(r.rows[2].status,'MODEL_COVERS_DECLARED_NEED');
});
test('unconfirmed borrowing, repayment and deferral remain unavailable rather than zero-cost recommendations',()=>{
 for(const kind of ['NEW_BORROWING','REPAY_DEBT','DEFER_PAYMENT']){
  const f=fixture();f.plans[0].kind=kind;const r=run(f);assert.equal(r.rows[0].status,'BLOCKED');assert.equal(r.rows[0].funding,null);
  for(const key of ['newBorrowing','debtRepayment','paymentDeferral','collateralClearance','legalMajorShareholderAssessment'])assert.equal(r.capabilities[key],'UNAVAILABLE');
 }
});
test('missing/expired/future plan evidence, missing invalidation or unknown settlement does not permit action',()=>{
 for(const change of [p=>p.expiresAtMs=now,p=>p.verifiedAtMs=now+1,p=>p.verifiedAtMs=now-1001,p=>delete p.invalidation,
  p=>p.proceedsAvailableAtMs=null,p=>p.proceedsAvailableAtMs=now-1,p=>p.proceedsAvailableAtMs='tomorrow']){
  const f=fixture();change(f.plans[2]);assert.equal(run(f).rows[2].status,'BLOCKED');
 }
});
test('bounded comparison requires distinct IDs and at most eight plans, with no default sizing or automatic rank',()=>{
 for(const change of [f=>f.plans=[],f=>f.plans=Array(9).fill(f.plans[0]),f=>f.plans[1].id=f.plans[0].id,f=>delete f.plans[0].id]){
  const f=fixture();change(f);assert.equal(run(f).status,'BLOCKED');
 }
});
test('aggregate sale/cost/cash overflow blocks projections; negative net assets retain null leverage denominator',()=>{
 const f=fixture();f.plans[1].costs={feesKrw:Number.MAX_SAFE_INTEGER,taxesKrw:1};assert.equal(run(f).rows[1].status,'BLOCKED');
 f.plans[1].costs={feesKrw:20,taxesKrw:10};f.ledger.accounts[0].debts[0].principalKrw=5000;
 const r=run(f);assert.equal(r.baseline.valuation.netAssetsKrw,-2000);assert.equal(r.baseline.leverage.debtToNetAssetsBps,null);
 assert.equal(r.baseline.leverage.nonPositiveNetAssets,true);assert.equal(r.rows[2].projected.valuation.netAssetsKrw,-2030);
 assert.equal(r.baseline.leverage.debtToNetAssetsStatus,'NON_POSITIVE_DENOMINATOR');
 const x=fixture();x.ledger.accounts[0].holdings=[{ticker:'005930',quantity:1}];x.prices['005930'].priceKrw=Number.MAX_SAFE_INTEGER;
 x.ledger.accounts[0].cash={balanceKrw:0,withdrawableKrw:0};x.plans[1].sales[0].quantity=1;x.plans[1].costs={feesKrw:0,taxesKrw:0};
 assert.equal(run(x).rows[1].projected.valuation.grossAssetsKrw,Number.MAX_SAFE_INTEGER);
});
test('stress missing/invalid shock is unavailable independently, never a fabricated zero risk or probability',()=>{
 const f=fixture();delete f.stressScenario.shocksBps['000660'];let r=run(f);assert.equal(r.baseline.stress.status,'BLOCKED');
 assert.equal(r.baseline.stress.totals.scenarioLossKrw,null);assert.equal(r.rows[2].status,'MODEL_COVERS_DECLARED_NEED');
 delete f.stressScenario;r=run(f);assert.equal(r.rows[1].projected.stress.status,'NOT_REQUESTED');assert.equal(r.rows[1].projected.stress.totals,null);
 assert.ok(!('probability'in r)&&!('taxThresholdKrw'in r));
});
