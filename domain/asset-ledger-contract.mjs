// Local contract only. Never import into a public Worker or log its input/output.
const time=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());
const money=n=>Number.isSafeInteger(n)&&n>=0;
const ref=s=>typeof s==='string'&&s.length>0&&s.length<=128;
const empty=()=>({securitiesValueKrw:null,grossAssetsKrw:null,debtPrincipalKrw:null,
  netAssetsKrw:null,withdrawableCashKrw:null,additionalOutflowsKrw:null,
  cashHeadroomAfterReserveKrw:null,investableCashKrw:null,cashShortfallKrw:null});

export function evaluateAssetLedger(ledger,prices,{nowMs,maxLedgerAgeMs,maxPriceAgeMs,reserveKrw}={}) {
  if(!time(nowMs)||![maxLedgerAgeMs,maxPriceAgeMs].every(n=>money(n))) throw new Error('INVALID_LEDGER_POLICY');
  const issues=[],totals=empty();
  const issue=(path,code)=>issues.push({path,code});
  if(ledger?.schemaVersion!==1||ledger?.currency!=='KRW') issue('ledger','UNSUPPORTED_LEDGER_SCHEMA_OR_CURRENCY');
  if(!time(ledger?.asOfMs)||ledger.asOfMs>nowMs) issue('ledger.asOfMs','INVALID_OR_FUTURE_TIME');
  if(!Array.isArray(ledger?.accounts)||ledger.accounts.length===0) issue('ledger.accounts','ACCOUNT_SCOPE_REQUIRED');
  if(reserveKrw!==undefined&&!money(reserveKrw)) issue('reserveKrw','INVALID_EXPLICIT_RESERVE');
  const seen=new Set();
  let securities=0,cash=0,debt=0,withdrawable=0,outflows=0;
  function add(a,b,path){const n=a+b;if(!Number.isSafeInteger(n))issue(path,'ARITHMETIC_OVERFLOW');return n;}
  for(const [i,a] of (Array.isArray(ledger?.accounts)?ledger.accounts:[]).entries()) {
    const path=`accounts[${i}]`;
    if(!ref(a?.accountRef)||seen.has(a.accountRef))issue(path,'INVALID_OR_DUPLICATE_ACCOUNT');
    seen.add(a?.accountRef);
    if(!ref(a?.sourceRef)||!time(a?.verifiedAtMs)||a.verifiedAtMs>ledger.asOfMs||
      nowMs-a.verifiedAtMs>maxLedgerAgeMs) issue(path,'MISSING_STALE_OR_FUTURE_VERIFICATION');
    for(const key of ['holdings','cash','debts','obligations'])
      if(a?.coverage?.[key]!==true)issue(`${path}.coverage.${key}`,'EXPLICIT_COMPLETENESS_REQUIRED');
    if(!Array.isArray(a?.holdings))issue(`${path}.holdings`,'HOLDINGS_REQUIRED');
    const tickers=new Set();
    for(const [j,h] of (Array.isArray(a?.holdings)?a.holdings:[]).entries()){
      const p=`${path}.holdings[${j}]`;
      if(typeof h?.ticker!=='string'||!/^\d{6}$/.test(h.ticker)||tickers.has(h.ticker))issue(p,'INVALID_OR_DUPLICATE_TICKER');
      tickers.add(h?.ticker);
      if(!money(h?.quantity)) {issue(p,'QUANTITY_REQUIRED');continue;}
      if(h.quantity===0)continue;
      const quote=prices?.[h.ticker];
      if(!money(quote?.priceKrw)||quote.priceKrw===0||quote.currency!=='KRW'||quote.quality!=='VERIFIED'||
        !ref(quote.sourceRef)||!time(quote.observedAtMs)||quote.observedAtMs>ledger.asOfMs||
        nowMs-quote.observedAtMs>maxPriceAgeMs){issue(p,'MISSING_OR_UNUSABLE_PRICE');continue;}
      const value=h.quantity*quote.priceKrw;
      if(!Number.isSafeInteger(value))issue(p,'ARITHMETIC_OVERFLOW');
      securities=add(securities,value,p);
    }
    if(!money(a?.cash?.balanceKrw)||!money(a?.cash?.withdrawableKrw)||a.cash.withdrawableKrw>a.cash.balanceKrw)
      issue(`${path}.cash`,'CASH_BALANCE_AND_WITHDRAWABLE_REQUIRED');
    else {cash=add(cash,a.cash.balanceKrw,path);withdrawable=add(withdrawable,a.cash.withdrawableKrw,path);}
    if(!Array.isArray(a?.debts))issue(`${path}.debts`,'DEBT_SCOPE_REQUIRED');
    for(const [j,d] of (Array.isArray(a?.debts)?a.debts:[]).entries()) {
      if(!money(d?.principalKrw))issue(`${path}.debts[${j}]`,'DEBT_PRINCIPAL_REQUIRED');
      else debt=add(debt,d.principalKrw,path);
    }
    if(!money(a?.additionalOutflowsKrw))issue(`${path}.additionalOutflowsKrw`,'ADDITIONAL_OUTFLOWS_REQUIRED');
    else outflows=add(outflows,a.additionalOutflowsKrw,path);
  }
  const gross=add(securities,cash,'grossAssetsKrw');
  if(issues.length)return {contractVersion:1,status:'BLOCKED',asOfMs:ledger?.asOfMs??null,totals,issues,
    limitations:['NO_PARTIAL_ACCOUNT_TOTALS','NO_COLLATERAL_TAX_OR_TRADING_DECISION']};
  Object.assign(totals,{securitiesValueKrw:securities,grossAssetsKrw:gross,debtPrincipalKrw:debt,
    netAssetsKrw:gross-debt,withdrawableCashKrw:withdrawable,additionalOutflowsKrw:outflows});
  if(reserveKrw!==undefined){
    // Subtract in bounded stages; a sum of obligations/reserve may exceed safe-integer range.
    const headroom=withdrawable-outflows-reserveKrw;
    if(!Number.isSafeInteger(headroom))return {contractVersion:1,status:'BLOCKED',asOfMs:ledger.asOfMs,
      totals:empty(),issues:[{path:'cashHeadroomAfterReserveKrw',code:'ARITHMETIC_OVERFLOW'}]};
    Object.assign(totals,{cashHeadroomAfterReserveKrw:headroom,investableCashKrw:Math.max(0,headroom),
      cashShortfallKrw:Math.max(0,-headroom)});
  }
  return {contractVersion:1,status:reserveKrw===undefined?'PARTIAL':'CALCULATED',asOfMs:ledger.asOfMs,
    totals,issues:reserveKrw===undefined?[{path:'reserveKrw',code:'EXPLICIT_RESERVE_REQUIRED_FOR_INVESTABLE_CASH'}]:[],
    limitations:['LOCAL_INPUT_VALIDATION_NOT_EXTERNAL_ACCOUNT_VERIFICATION',
      'CASH_ONLY_FUNDING_NO_SECURITY_SALE_OR_NEW_BORROWING','NO_COLLATERAL_TAX_OR_TRADING_DECISION']};
}
