// PRIVATE local consistency only. No external account attestation or broker formula.
import {validateCollateralInput} from './collateral-input-contract.mjs';
const money=n=>Number.isSafeInteger(n)&&n>=0;
const time=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());
const ref=s=>typeof s==='string'&&s.length>0&&s.length<=128;
export function reconcileCollateralToLedger(ledger,input,policy={}){
 if(!money(policy.maxLedgerAgeMs))throw new Error('INVALID_COLLATERAL_LEDGER_POLICY');
 const gate=validateCollateralInput(input,policy),issues=[...gate.issues];
 const finish=()=>{
  const valid=issues.length===0;
  return {...gate,status:valid?'UNAVAILABLE':'BLOCKED',inputValidationStatus:valid?'VALIDATED_LOCAL':'BLOCKED',
   validatedAccountCount:valid?gate.validatedAccountCount:null,validatedPositionCount:valid?gate.validatedPositionCount:null,
   reconciliation:{status:valid?'MATCHED_LOCAL':'BLOCKED',matchedAccountCount:valid?input.accounts.length:null},issues,
   limitations:[...gate.limitations,'LOCAL_QUANTITY_DEBT_MATCH_NOT_EXTERNAL_VERIFICATION','OWNED_SETTLED_ACCOUNT_ONLY_NO_CROSS_ACCOUNT_NETTING']};
 };
 if(issues.length)return finish();
 const issue=(path,code)=>issues.push({path,code});
 if(ledger?.schemaVersion!==1||ledger?.currency!=='KRW'||!time(ledger?.asOfMs)||
   ledger.asOfMs!==input.asOfMs||policy.nowMs-ledger.asOfMs>policy.maxLedgerAgeMs)
  issue('ledger','LEDGER_COLLATERAL_CUTOFF_OR_EVIDENCE_MISMATCH');
 if(!Array.isArray(ledger?.accounts)||ledger.accounts.length===0||ledger.accounts.length>32)
  issue('ledger.accounts','BOUNDED_ACCOUNT_SCOPE_REQUIRED');
 if(issues.length)return finish();
 const accounts=new Map(),debtRefs=new Set();
 for(const [i,a] of ledger.accounts.entries()){
  if(!ref(a?.accountRef)||accounts.has(a.accountRef))issue(`ledger.accounts[${i}]`,'INVALID_OR_DUPLICATE_ACCOUNT');
  accounts.set(a?.accountRef,a);
 }
 if(accounts.size!==input.accounts.length||!input.accounts.every(a=>accounts.has(a.accountRef)))
  issue('ledger.accounts','LEDGER_COLLATERAL_ACCOUNT_SCOPE_MISMATCH');
 if(issues.length)return finish();
 for(const [i,c] of input.accounts.entries()){
  const p=`accounts[${i}]`,a=accounts.get(c.accountRef);
  if(!ref(a.sourceRef)||!time(a.verifiedAtMs)||a.verifiedAtMs>ledger.asOfMs||policy.nowMs-a.verifiedAtMs>policy.maxLedgerAgeMs)
   issue(p,'MISSING_STALE_OR_FUTURE_LEDGER_VERIFICATION');
  if(a.coverage?.holdings!==true||a.coverage?.debts!==true||a.holdingBasis!=='OWNED_SETTLED_SHARES'||
    c.positionScope!=='OWNED_PLEDGED_SUBSET'||c.debtScope!=='ALL_DEBT_SECURED_TO_THIS_ACCOUNT')
   issue(p,'EXPLICIT_OWNERSHIP_AND_DEBT_SCOPE_REQUIRED');
  if(!Array.isArray(a.holdings)||a.holdings.length>256||!Array.isArray(a.debts)||a.debts.length>128){
   issue(p,'BOUNDED_HOLDING_AND_DEBT_SCOPE_REQUIRED');continue;
  }
  const owned=new Map();
  for(const h of a.holdings){
   if(typeof h?.ticker!=='string'||!/^\d{6}$/.test(h.ticker)||owned.has(h.ticker)||!money(h?.quantity))issue(p,'INVALID_OR_DUPLICATE_OWNED_POSITION');
   else owned.set(h.ticker,h.quantity);
  }
  for(const h of c.positions){
   // Covered absence is known zero; unknown/incomplete ledger scope is already blocked above.
   if(h.quantity>(owned.get(h.ticker)??0))issue(p,'PLEDGED_QUANTITY_EXCEEDS_OWNED_SETTLED_SHARES');
  }
  let principal=0n,charges=0n;
  for(const d of a.debts){
   if(!ref(d?.debtRef)||debtRefs.has(d.debtRef)||!money(d?.principalKrw)||!money(d?.accruedChargesKrw)||
      !['SECURED_TO_THIS_ACCOUNT','UNSECURED'].includes(d?.securityType)){
    issue(p,'EXPLICIT_UNIQUE_CLASSIFIED_DEBT_REQUIRED');continue;
   }
   debtRefs.add(d.debtRef);
   if(d.securityType==='SECURED_TO_THIS_ACCOUNT'){
    principal+=BigInt(d.principalKrw);charges+=BigInt(d.accruedChargesKrw);
   }
  }
  if(principal+charges>BigInt(Number.MAX_SAFE_INTEGER))issue(p,'UNSAFE_RECONCILED_DEBT_TOTAL');
  if(principal!==BigInt(c.securedDebtKrw)||charges!==BigInt(c.accruedChargesKrw))
   issue(p,'SECURED_DEBT_OR_ACCRUED_CHARGES_MISMATCH');
 }
 return finish();
}
