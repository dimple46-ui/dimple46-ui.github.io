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

test('concentration is opt-in with explicit denominator; never infers a maximum weight',()=>{
 const f=fixture();const off=buildPrivateRiskSummary(f,policy);
 assert.equal(off.capabilities.concentration,'UNAVAILABLE');assert.equal(off.components.concentration.status,'NOT_REQUESTED');
 const r=buildPrivateRiskSummary(f,{...policy,concentrationDenominator:'DECLARED_GROSS_ASSETS'});
 assert.equal(r.capabilities.concentration,'AVAILABLE');assert.equal(r.components.concentration.denominatorKrw,7000);
 assert.equal(r.components.concentration.samsungHynixCombined.weightBps,2857);assert.equal(r.status,'PARTIAL');
 assert.ok(!('maxWeight' in r));assert.equal(r.capabilities.tradeDecision,'UNAVAILABLE');
});
test('bad concentration policy or missing quote cannot suppress independent cash shortage',()=>{
 const f=fixture();let r=buildPrivateRiskSummary(f,{...policy,concentrationDenominator:'NET_ASSETS'});
 assert.equal(r.capabilities.concentration,'UNAVAILABLE');assert.equal(r.capabilities.cashDeadlines,'AVAILABLE');
 delete f.prices['005930'];r=buildPrivateRiskSummary(f,{...policy,concentrationDenominator:'DECLARED_SECURITIES_VALUE'});
 assert.equal(r.components.concentration.status,'BLOCKED');assert.equal(r.capabilities.cashDeadlines,'AVAILABLE');
 assert.equal(r.components.cashDeadlines.totals.accountShortfallSumKrw,500);
});

function collateralFixture(){const f=fixture();f.ledger.accounts[0].holdingBasis='OWNED_SETTLED_SHARES';
 Object.assign(f.ledger.accounts[0].debts[0],{debtRef:'fictional-secured',accruedChargesKrw:0,securityType:'SECURED_TO_THIS_ACCOUNT'});
 return {...f,collateralInput:{schemaVersion:1,currency:'KRW',asOfMs:now,
 accounts:f.ledger.accounts.map(a=>({accountRef:a.accountRef,collateralScope:'ACCOUNT_ONLY',
 positionScope:'OWNED_PLEDGED_SUBSET',debtScope:'ALL_DEBT_SECURED_TO_THIS_ACCOUNT',
 coverage:{positions:true,securedDebt:true,brokerTerms:true},sourceRef:'synthetic',quality:'VERIFIED',verifiedAtMs:now,
 securedDebtKrw:4000,accruedChargesKrw:0,debtBasis:'PRINCIPAL_PLUS_ACCRUED_CHARGES',
 rule:{versionRef:'fictional-v1',formulaRef:'unsupported-fictional',sourceRef:'synthetic',quality:'VERIFIED',
 verifiedAtMs:now,effectiveFromMs:now-86400000,effectiveUntilMs:now+86400000,
 calculationBasis:'POSITION_HAIRCUT_VALUE',requiredCoverageBps:12345},
 positions:a.holdings.map(h=>({...h,...f.prices[h.ticker],eligibility:'ELIGIBLE',haircutBps:0}))}))}};}
const collateralPolicy={...policy,maxCollateralInputAgeMs:86400000,maxCollateralQuoteAgeMs:120000};
test('collateral opt-in validates matching fictional input without enabling collateral calculation',()=>{
 const off=buildPrivateRiskSummary(fixture(),policy);assert.equal(off.components.collateral.status,'NOT_REQUESTED');
 const f=collateralFixture(),copy=structuredClone(f),r=buildPrivateRiskSummary(f,collateralPolicy);assert.deepEqual(f,copy);
 assert.equal(r.components.collateral.inputValidationStatus,'VALIDATED_LOCAL');
 assert.equal(r.components.collateral.reconciliation.status,'MATCHED_LOCAL');
 assert.equal(r.components.collateral.status,'UNAVAILABLE');assert.equal(r.capabilities.collateral,'UNAVAILABLE');
 assert.equal(r.components.collateral.calculation.headroomKrw,null);assert.equal(r.capabilities.cashDeadlines,'AVAILABLE');
});
test('collateral cutoff/account mismatch or missing age policy is isolated without suppressing cash risk',()=>{
 for(const mutate of [f=>f.collateralInput.asOfMs++,f=>f.collateralInput.accounts[0].accountRef='fictional-other',
 f=>f.collateralInput.accounts.push(structuredClone(f.collateralInput.accounts[0])),
 f=>f.collateralInput.accounts[0].positions[0].quantity++,f=>delete f.ledger.accounts[0].debts[0].securityType,
 f=>f.collateralInput.accounts[0].securedDebtKrw++]){
  const f=collateralFixture();mutate(f);const r=buildPrivateRiskSummary(f,collateralPolicy);
  assert.equal(r.components.collateral.status,'BLOCKED');assert.equal(r.capabilities.collateral,'UNAVAILABLE');
  assert.equal(r.capabilities.cashDeadlines,'AVAILABLE');assert.equal(r.components.cashDeadlines.totals.accountShortfallSumKrw,500);
 }
 const r=buildPrivateRiskSummary(collateralFixture(),policy);
 assert.equal(r.components.collateral.status,'BLOCKED');assert.equal(r.capabilities.cashDeadlines,'AVAILABLE');
});
