// PRIVATE schema gate only. No broker formula, collateral valuation, margin call or liquidation calculation.
const time=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());
const money=n=>Number.isSafeInteger(n)&&n>=0;
const ref=s=>typeof s==='string'&&s.length>0&&s.length<=128;
const bases=['BROKER_STATEMENT_VALUE','POSITION_HAIRCUT_VALUE'];
export function validateCollateralInput(input,{nowMs,maxInputAgeMs,maxQuoteAgeMs}={}){
 if(!time(nowMs)||!money(maxInputAgeMs)||!money(maxQuoteAgeMs))throw new Error('INVALID_COLLATERAL_INPUT_POLICY');
 const issues=[];const issue=(path,code)=>issues.push({path,code});
 const recent=(n,max)=>time(n)&&n<=input?.asOfMs&&nowMs-n<=max;
 if(input?.schemaVersion!==1||input?.currency!=='KRW')issue('input','UNSUPPORTED_SCHEMA_OR_CURRENCY');
 if(!time(input?.asOfMs)||input.asOfMs>nowMs||nowMs-input.asOfMs>maxInputAgeMs)
  issue('asOfMs','MISSING_STALE_OR_FUTURE_TIME');
 if(!Array.isArray(input?.accounts)||input.accounts.length===0||input.accounts.length>32)
  issue('accounts','BOUNDED_ACCOUNT_SCOPE_REQUIRED');
 const seen=new Set();let positions=0;
 // Reject oversized inputs before traversing their contents.
 if(!issues.length)for(const [i,a] of input.accounts.entries()){
  const p=`accounts[${i}]`;
  if(!ref(a?.accountRef)||seen.has(a.accountRef))issue(p,'INVALID_OR_DUPLICATE_ACCOUNT');
  seen.add(a?.accountRef);
  if(a?.collateralScope!=='ACCOUNT_ONLY'||a?.coverage?.positions!==true||
    a?.coverage?.securedDebt!==true||a?.coverage?.brokerTerms!==true)issue(p,'EXPLICIT_ACCOUNT_COVERAGE_REQUIRED');
  if(a?.quality!=='VERIFIED'||!ref(a?.sourceRef)||!recent(a?.verifiedAtMs,maxInputAgeMs))
   issue(p,'MISSING_OR_UNVERIFIED_ACCOUNT_EVIDENCE');
  if(!money(a?.securedDebtKrw)||!money(a?.accruedChargesKrw)||a?.debtBasis!=='PRINCIPAL_PLUS_ACCRUED_CHARGES')
   issue(p,'EXPLICIT_VERIFIED_DEBT_BASIS_REQUIRED');
  else if(BigInt(a.securedDebtKrw)+BigInt(a.accruedChargesKrw)>BigInt(Number.MAX_SAFE_INTEGER))
   issue(p,'UNSAFE_DEBT_TOTAL');
  const r=a?.rule;
  if(!ref(r?.versionRef)||!ref(r?.formulaRef)||!ref(r?.sourceRef)||r?.quality!=='VERIFIED'||
    !recent(r?.verifiedAtMs,maxInputAgeMs)||!time(r?.effectiveFromMs)||!time(r?.effectiveUntilMs)||
    r.effectiveFromMs>input.asOfMs||input.asOfMs>=r.effectiveUntilMs||
    !bases.includes(r?.calculationBasis)||!Number.isSafeInteger(r?.requiredCoverageBps)||r.requiredCoverageBps<=0)
   issue(`${p}.rule`,'MISSING_EXPIRED_OR_UNVERIFIED_RULE');
  if(!Array.isArray(a?.positions)||a.positions.length>256){issue(`${p}.positions`,'BOUNDED_POSITIONS_REQUIRED');continue;}
  const tickers=new Set();positions+=a.positions.length;
  for(const [j,h] of a.positions.entries()){
   const hp=`${p}.positions[${j}]`;
   if(typeof h?.ticker!=='string'||!/^\d{6}$/.test(h.ticker)||tickers.has(h.ticker)||!money(h?.quantity)||!money(h?.priceKrw)||
      (h.quantity>0&&h.priceKrw===0)||h?.currency!=='KRW'||h?.quality!=='VERIFIED'||
      !ref(h?.sourceRef)||!recent(h?.observedAtMs,maxQuoteAgeMs)||
      !['ELIGIBLE','INELIGIBLE'].includes(h?.eligibility)||!Number.isInteger(h?.haircutBps)||h.haircutBps<0||h.haircutBps>10000)
    issue(hp,'MISSING_INVALID_OR_UNVERIFIED_COLLATERAL_POSITION');
   tickers.add(h?.ticker);
  }
 }
 const valid=issues.length===0;
 return {contractVersion:1,status:valid?'UNAVAILABLE':'BLOCKED',inputValidationStatus:valid?'VALIDATED_LOCAL':'BLOCKED',
  scope:'PRIVATE_COLLATERAL_INPUT_GATE_ONLY',
  inputCutoffMs:time(input?.asOfMs)&&input.asOfMs<=nowMs?input.asOfMs:null,generatedAtMs:nowMs,
  validatedAccountCount:valid?input.accounts.length:null,validatedPositionCount:valid?positions:null,
  calculation:{status:'UNAVAILABLE',reason:'BROKER_FORMULA_NOT_IMPLEMENTED',
   collateralValueKrw:null,coverageRatioBps:null,headroomKrw:null,liquidationQuantity:null},issues,
  limitations:['LOCAL_SCHEMA_NOT_EXTERNAL_BROKER_RULE_VERIFICATION','REQUIRED_RATIO_AND_HAIRCUT_ARE_CALLER_SUPPLIED_NOT_APPROVED_LIMITS',
   'NO_BROKER_FORMULA_MARGIN_CALL_LIQUIDATION_OR_TRADE','NO_PRIVATE_STORAGE_PUBLIC_ENDPOINT_OR_NOTIFICATION']};
}
