import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCollateralToLedger} from '../domain/collateral-reconciliation.mjs';
const now=1792131000000,day=86400000;
const policy={nowMs:now,maxInputAgeMs:day,maxQuoteAgeMs:120000,maxLedgerAgeMs:day};
function fixture(){return {ledger:{schemaVersion:1,currency:'KRW',asOfMs:now,accounts:[{
 accountRef:'fictional-A',sourceRef:'synthetic',verifiedAtMs:now,coverage:{holdings:true,debts:true},
 holdingBasis:'OWNED_SETTLED_SHARES',holdings:[{ticker:'005930',quantity:10},{ticker:'000660',quantity:2}],
 debts:[{debtRef:'fictional-secured',principalKrw:500,accruedChargesKrw:10,securityType:'SECURED_TO_THIS_ACCOUNT'},
 {debtRef:'fictional-unsecured',principalKrw:9000,accruedChargesKrw:100,securityType:'UNSECURED'}]}]},
 input:{schemaVersion:1,currency:'KRW',asOfMs:now,accounts:[{accountRef:'fictional-A',collateralScope:'ACCOUNT_ONLY',
 positionScope:'OWNED_PLEDGED_SUBSET',debtScope:'ALL_DEBT_SECURED_TO_THIS_ACCOUNT',
 coverage:{positions:true,securedDebt:true,brokerTerms:true},sourceRef:'synthetic',quality:'VERIFIED',verifiedAtMs:now,
 securedDebtKrw:500,accruedChargesKrw:10,debtBasis:'PRINCIPAL_PLUS_ACCRUED_CHARGES',
 rule:{versionRef:'fictional-v1',formulaRef:'unsupported',sourceRef:'synthetic',quality:'VERIFIED',verifiedAtMs:now,
 effectiveFromMs:now-day,effectiveUntilMs:now+day,calculationBasis:'POSITION_HAIRCUT_VALUE',requiredCoverageBps:12345},
 positions:[{ticker:'005930',quantity:5,priceKrw:100,currency:'KRW',quality:'VERIFIED',sourceRef:'synthetic',
 observedAtMs:now,eligibility:'ELIGIBLE',haircutBps:0}]}]}};}
const run=f=>reconcileCollateralToLedger(f.ledger,f.input,policy);
test('owned pledged subset and explicitly classified secured debt match without adding unsecured debt',()=>{
 const f=fixture(),copy=structuredClone(f),r=run(f);assert.deepEqual(f,copy);assert.deepEqual(r,run(f));
 assert.equal(r.reconciliation.status,'MATCHED_LOCAL');assert.equal(r.status,'UNAVAILABLE');
 assert.equal(r.calculation.headroomKrw,null);assert.equal(r.calculation.coverageRatioBps,null);
 f.ledger.accounts[0].debts[1].principalKrw=19000;assert.equal(run(f).reconciliation.status,'MATCHED_LOCAL');
});
test('missing ownership/debt semantics and unsupported classifications block instead of guessing',()=>{
 for(const mutate of [f=>delete f.ledger.accounts[0].holdingBasis,f=>delete f.input.accounts[0].positionScope,
 f=>delete f.input.accounts[0].debtScope,f=>delete f.ledger.accounts[0].debts[0].securityType,
 f=>f.ledger.accounts[0].debts[0].securityType='SECURED_ELSEWHERE',f=>delete f.ledger.accounts[0].debts[0].accruedChargesKrw]){
  const f=fixture();mutate(f);const r=run(f);assert.equal(r.status,'BLOCKED');assert.equal(r.validatedAccountCount,null);
 }
});
test('pledged quantity cannot exceed same-account holdings or borrow another account position',()=>{
 const f=fixture(),b=structuredClone(f.ledger.accounts[0]);b.accountRef='fictional-B';b.debts=[];b.holdings[0].quantity=100;
 f.ledger.accounts.push(b);const cb=structuredClone(f.input.accounts[0]);cb.accountRef=b.accountRef;
 cb.positions=[];cb.securedDebtKrw=0;cb.accruedChargesKrw=0;f.input.accounts.push(cb);
 f.input.accounts[0].positions[0].quantity=11;let r=run(f);assert.equal(r.status,'BLOCKED');
 assert.ok(r.issues.some(x=>x.code==='PLEDGED_QUANTITY_EXCEEDS_OWNED_SETTLED_SHARES'));
 f.input.accounts[0].positions[0].ticker='035420';assert.equal(run(f).status,'BLOCKED');
});
test('principal and accrued charges must match separately; covered empty/zero data remains valid',()=>{
 for(const key of ['securedDebtKrw','accruedChargesKrw']){const f=fixture();f.input.accounts[0][key]++;assert.equal(run(f).status,'BLOCKED');}
 const f=fixture();f.ledger.accounts[0].holdings=[];f.ledger.accounts[0].debts=[];
 f.input.accounts[0].positions=[];f.input.accounts[0].securedDebtKrw=0;f.input.accounts[0].accruedChargesKrw=0;
 assert.equal(run(f).reconciliation.status,'MATCHED_LOCAL');
 delete f.ledger.accounts[0].debts;assert.equal(run(f).status,'BLOCKED');
});
test('cutoff, account coverage, verification and duplicate identities are checked without exposing refs',()=>{
 for(const mutate of [f=>f.ledger.asOfMs--,f=>f.input.accounts[0].accountRef='PRIVATE_SENTINEL',
 f=>f.ledger.accounts[0].coverage.debts=false,f=>f.ledger.accounts[0].verifiedAtMs=now-day-1,
 f=>f.ledger.accounts[0].holdings[0].ticker=123456,
 f=>f.ledger.accounts[0].holdings.push(structuredClone(f.ledger.accounts[0].holdings[0])),
 f=>f.ledger.accounts[0].debts.push(structuredClone(f.ledger.accounts[0].debts[0]))]){
  const f=fixture();mutate(f);const r=run(f);assert.equal(r.status,'BLOCKED');assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));
 }
});
test('bounded inputs, unsafe aggregate debt and invalid policies fail closed',()=>{
 const f=fixture();f.ledger.accounts[0].debts=Array.from({length:2},(_,i)=>({debtRef:`fictional-${i}`,
 principalKrw:Number.MAX_SAFE_INTEGER,accruedChargesKrw:0,securityType:'SECURED_TO_THIS_ACCOUNT'}));
 assert.ok(run(f).issues.some(x=>x.code==='UNSAFE_RECONCILED_DEBT_TOTAL'));
 f.ledger.accounts[0].debts=Array(129).fill(f.ledger.accounts[0].debts[0]);assert.equal(run(f).status,'BLOCKED');
 assert.throws(()=>reconcileCollateralToLedger(f.ledger,f.input,{...policy,maxLedgerAgeMs:null}),/INVALID_COLLATERAL_LEDGER_POLICY/);
});
test('input gate failure cannot become a locally matched reconciliation',()=>{
 const f=fixture();f.input.accounts[0].positions[0].quality='UNVERIFIED_TIME';const r=run(f);
 assert.equal(r.reconciliation.status,'BLOCKED');assert.equal(r.calculation.headroomKrw,null);
 assert.equal(r.validatedPositionCount,null);
});
