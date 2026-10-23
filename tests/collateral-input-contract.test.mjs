import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCollateralInput} from '../domain/collateral-input-contract.mjs';
const now=1792131000000,day=86400000,policy={nowMs:now,maxInputAgeMs:day,maxQuoteAgeMs:120000};
function fixture(){return {schemaVersion:1,currency:'KRW',asOfMs:now,accounts:[{
 accountRef:'fictional-A',collateralScope:'ACCOUNT_ONLY',coverage:{positions:true,securedDebt:true,brokerTerms:true},
 sourceRef:'synthetic-not-a-broker',quality:'VERIFIED',verifiedAtMs:now,securedDebtKrw:500,accruedChargesKrw:0,
 debtBasis:'PRINCIPAL_PLUS_ACCRUED_CHARGES',rule:{versionRef:'fictional-rule-v1',formulaRef:'fictional-unsupported',
 sourceRef:'synthetic-not-official',quality:'VERIFIED',verifiedAtMs:now,effectiveFromMs:now-day,effectiveUntilMs:now+day,
 calculationBasis:'POSITION_HAIRCUT_VALUE',requiredCoverageBps:12345},positions:[{ticker:'005930',quantity:10,
 priceKrw:100,currency:'KRW',quality:'VERIFIED',sourceRef:'synthetic',observedAtMs:now,
 eligibility:'ELIGIBLE',haircutBps:2000}]}]};}
const run=f=>validateCollateralInput(f,policy);
test('complete fictional input passes schema only; all collateral calculations remain unavailable/null',()=>{
 const f=fixture(),copy=structuredClone(f),r=run(f);assert.deepEqual(f,copy);assert.deepEqual(r,run(f));
 assert.equal(r.inputValidationStatus,'VALIDATED_LOCAL');assert.equal(r.status,'UNAVAILABLE');
 assert.equal(r.validatedAccountCount,1);assert.equal(r.validatedPositionCount,1);
 assert.equal(r.calculation.reason,'BROKER_FORMULA_NOT_IMPLEMENTED');
 for(const key of ['collateralValueKrw','coverageRatioBps','headroomKrw','liquidationQuantity'])assert.equal(r.calculation[key],null);
 assert.ok(!('safe' in r));assert.ok(!JSON.stringify(r).includes('fictional-A'));
});
test('missing coverage, debt, haircut, eligibility, rule identity or effective time blocks inputs',()=>{
 for(const mutate of [f=>delete f.accounts[0].coverage.securedDebt,f=>f.accounts[0].securedDebtKrw=null,
 f=>f.accounts[0].positions[0].ticker=123456,
 f=>delete f.accounts[0].accruedChargesKrw,f=>delete f.accounts[0].positions[0].haircutBps,
 f=>f.accounts[0].positions[0].eligibility='UNKNOWN',f=>delete f.accounts[0].rule.formulaRef,
 f=>delete f.accounts[0].rule.effectiveUntilMs,f=>f.accounts[0].collateralScope='CROSS_ACCOUNT_POOL']){
  const f=fixture();mutate(f);const r=run(f);assert.equal(r.status,'BLOCKED');assert.equal(r.validatedAccountCount,null);
  assert.equal(r.calculation.headroomKrw,null);
 }
});
test('future/stale/unverified data and not-effective/expired terms cannot be promoted',()=>{
 for(const mutate of [f=>f.asOfMs=now+1,f=>f.asOfMs=now-day-1,f=>f.accounts[0].verifiedAtMs=now+1,
 f=>f.accounts[0].quality='RECENT_FETCH',f=>f.accounts[0].positions[0].quality='UNVERIFIED_TIME',
 f=>f.accounts[0].positions[0].observedAtMs=now-120001,f=>f.accounts[0].rule.quality='STALE_INPUT',
 f=>f.accounts[0].rule.effectiveFromMs=now+1,f=>f.accounts[0].rule.effectiveUntilMs=now]){
  const f=fixture();mutate(f);assert.equal(run(f).status,'BLOCKED');
 }
 const f=fixture();f.asOfMs=now+1;assert.equal(run(f).inputCutoffMs,null);
});
test('explicit zero debt/charges and bounded haircuts are valid metadata but never zero headroom',()=>{
 for(const haircutBps of [0,10000]){
  const f=fixture();f.accounts[0].securedDebtKrw=0;f.accounts[0].positions[0].haircutBps=haircutBps;
  const r=run(f);assert.equal(r.inputValidationStatus,'VALIDATED_LOCAL');assert.equal(r.calculation.headroomKrw,null);
 }
 for(const value of [null,'2000',NaN,Infinity,-1,10001,1.5]){
  const f=fixture();f.accounts[0].positions[0].haircutBps=value;assert.equal(run(f).status,'BLOCKED');
 }
});
test('duplicate accounts/positions, oversized scopes and unsafe debt totals are rejected',()=>{
 for(const mutate of [f=>f.accounts.push(structuredClone(f.accounts[0])),
 f=>f.accounts[0].positions.push(structuredClone(f.accounts[0].positions[0])),
 f=>f.accounts=Array(33).fill(f.accounts[0]),f=>f.accounts[0].positions=Array(257).fill(f.accounts[0].positions[0]),
 f=>{f.accounts[0].securedDebtKrw=Number.MAX_SAFE_INTEGER;f.accounts[0].accruedChargesKrw=1;},f=>f.accounts=[]]){
  const f=fixture();mutate(f);assert.equal(run(f).status,'BLOCKED');
 }
});
test('invalid policy is rejected; generic error output never echoes raw descriptions or input values',()=>{
 assert.throws(()=>validateCollateralInput(fixture(),{...policy,maxQuoteAgeMs:null}),/INVALID_COLLATERAL_INPUT_POLICY/);
 const f=fixture();f.accounts[0].rule.sourceRef='PRIVATE_SENTINEL';f.accounts[0].rule.formulaRef=null;
 const r=run(f);assert.equal(r.status,'BLOCKED');assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));
});
