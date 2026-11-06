// PRIVATE local-only cash coverage. No quotes, personal storage, network or public Worker import.
const time=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());
const money=n=>Number.isSafeInteger(n)&&n>=0;
const ref=s=>typeof s==='string'&&s.length>0&&s.length<=128;
const safe=n=>n<=BigInt(Number.MAX_SAFE_INTEGER)&&n>=BigInt(Number.MIN_SAFE_INTEGER);
const empty=()=>({dueThroughHorizonKrw:null,accountShortfallSumKrw:null,earliestShortfallDueAtMs:null});

export function evaluateCashDeadlines(ledger,schedule,{nowMs,maxLedgerAgeMs,horizonAtMs}={}){
 if(!time(nowMs)||!money(maxLedgerAgeMs)||!time(horizonAtMs)||horizonAtMs<nowMs)
  throw new Error('INVALID_CASH_DEADLINE_POLICY');
 const issues=[],accounts=[],riskEvents=[];
 const issue=(path,code)=>issues.push({path,code});
 const blocked=()=>({contractVersion:1,status:'BLOCKED',scope:'PRIVATE_LOCAL_CASH_COVERAGE_ONLY',
  inputCutoffMs:time(ledger?.asOfMs)&&ledger.asOfMs<=nowMs?ledger.asOfMs:null,totals:empty(),accounts:[],riskEvents:[],issues});
 if(ledger?.schemaVersion!==1||ledger?.currency!=='KRW')issue('ledger','UNSUPPORTED_LEDGER_SCHEMA_OR_CURRENCY');
 if(!time(ledger?.asOfMs)||ledger.asOfMs>nowMs||nowMs-ledger.asOfMs>maxLedgerAgeMs)
  issue('ledger.asOfMs','MISSING_STALE_OR_FUTURE_TIME');
 if(!Array.isArray(ledger?.accounts)||ledger.accounts.length===0)issue('ledger.accounts','ACCOUNT_SCOPE_REQUIRED');
 if(schedule?.schemaVersion!==1||schedule.ledgerAsOfMs!==ledger?.asOfMs||!Array.isArray(schedule?.accounts))
  issue('schedule','MATCHING_SCHEDULE_REQUIRED');
 if(issues.length)return blocked();
 const scheduled=new Map();
 for(const [i,s] of schedule.accounts.entries()){
  if(!ref(s?.accountRef)||scheduled.has(s.accountRef))issue(`schedule.accounts[${i}]`,'INVALID_OR_DUPLICATE_ACCOUNT');
  scheduled.set(s?.accountRef,s);
 }
 const seen=new Set(),obligationRefs=new Set();
 let totalDue=0n,totalShortfall=0n,earliest=null;
 for(const [i,a] of ledger.accounts.entries()){
  const p=`accounts[${i}]`;
  if(!ref(a?.accountRef)||seen.has(a.accountRef))issue(p,'INVALID_OR_DUPLICATE_ACCOUNT');
  seen.add(a?.accountRef);
  if(!ref(a?.sourceRef)||!time(a?.verifiedAtMs)||a.verifiedAtMs>ledger.asOfMs||nowMs-a.verifiedAtMs>maxLedgerAgeMs)
   issue(p,'MISSING_STALE_OR_FUTURE_VERIFICATION');
  if(a?.coverage?.cash!==true||a?.coverage?.obligations!==true)issue(p,'EXPLICIT_CASH_OBLIGATION_COVERAGE_REQUIRED');
  if(!money(a?.cash?.balanceKrw)||!money(a?.cash?.withdrawableKrw)||a.cash.withdrawableKrw>a.cash.balanceKrw)
   issue(`${p}.cash`,'CASH_BALANCE_AND_WITHDRAWABLE_REQUIRED');
  if(!money(a?.additionalOutflowsKrw))issue(p,'ADDITIONAL_OUTFLOWS_REQUIRED');
  const s=scheduled.get(a?.accountRef);
  if(s?.coverageComplete!==true||!Array.isArray(s?.obligations)){
   issue(p,'COMPLETE_DATED_OBLIGATIONS_REQUIRED');continue;
  }
  let sum=0n;const buckets=new Map();let overdueCount=0;
  for(const [j,o] of s.obligations.entries()){
   const op=`${p}.obligations[${j}]`;
   const validRef=ref(o?.obligationRef)&&!obligationRefs.has(o.obligationRef);
   obligationRefs.add(o?.obligationRef);
   const valid=validRef&&money(o?.amountKrw)&&time(o?.dueAtMs)&&o?.status==='OPEN'&&
    o?.cashTreatment==='NOT_DEDUCTED_FROM_WITHDRAWABLE'&&ref(o?.sourceRef)&&time(o?.verifiedAtMs)&&
    o.verifiedAtMs<=ledger.asOfMs&&nowMs-o.verifiedAtMs<=maxLedgerAgeMs;
   if(!valid){issue(op,'INVALID_MISSING_DUPLICATE_OR_UNVERIFIED_OBLIGATION');continue;}
   sum+=BigInt(o.amountKrw);
   if(o.dueAtMs<=horizonAtMs){
    buckets.set(o.dueAtMs,(buckets.get(o.dueAtMs)??0n)+BigInt(o.amountKrw));
    if(o.dueAtMs<nowMs&&o.amountKrw>0)overdueCount++;
   }
  }
  if(money(a?.additionalOutflowsKrw)&&sum!==BigInt(a.additionalOutflowsKrw))issue(p,'OBLIGATION_TOTAL_MISMATCH');
  if(issues.length)continue;
  let due=0n,firstShortfall=null;const deadlines=[];
  for(const [dueAtMs,amount] of [...buckets].sort(([a],[b])=>a-b)){
   due+=amount;const headroom=BigInt(a.cash.withdrawableKrw)-due;
   if(!safe(due)||!safe(headroom)){issue(p,'ARITHMETIC_OVERFLOW');break;}
   deadlines.push({dueAtMs,cumulativeDueKrw:Number(due),cashHeadroomKrw:Number(headroom)});
   if(headroom<0n&&firstShortfall===null)firstShortfall=dueAtMs;
  }
  if(issues.length)continue;
  const headroom=BigInt(a.cash.withdrawableKrw)-due,shortfall=headroom<0n?-headroom:0n;
  totalDue+=due;totalShortfall+=shortfall;
  if(firstShortfall!==null){
   earliest=earliest===null?firstShortfall:Math.min(earliest,firstShortfall);
   riskEvents.push({type:'CASH_SHORTFALL_AT_DEADLINE',accountRef:a.accountRef,dueAtMs:firstShortfall});
  }
  if(overdueCount)riskEvents.push({type:'OVERDUE_OPEN_OBLIGATION',accountRef:a.accountRef,count:overdueCount});
  accounts.push({accountRef:a.accountRef,balanceKrw:a.cash.balanceKrw,withdrawableKrw:a.cash.withdrawableKrw,
   dueThroughHorizonKrw:Number(due),cashHeadroomKrw:Number(headroom),shortfallKrw:Number(shortfall),
   firstShortfallDueAtMs:firstShortfall,overdueOpenCount:overdueCount,deadlines});
 }
 for(const key of scheduled.keys())if(!seen.has(key))issue('schedule.accounts','UNDECLARED_ACCOUNT');
 if(!safe(totalDue)||!safe(totalShortfall))issue('totals','ARITHMETIC_OVERFLOW');
 if(issues.length)return blocked();
 return {contractVersion:1,status:'CALCULATED',scope:'PRIVATE_LOCAL_CASH_COVERAGE_ONLY',currency:'KRW',
  inputCutoffMs:ledger.asOfMs,generatedAtMs:nowMs,horizonAtMs,
  coverage:'DECLARED_ACCOUNTS_ONLY_NOT_EXTERNAL_VERIFICATION',
  totals:{dueThroughHorizonKrw:Number(totalDue),accountShortfallSumKrw:Number(totalShortfall),earliestShortfallDueAtMs:earliest},
  accounts,riskEvents,issues:[],assumptions:['CURRENT_WITHDRAWABLE_CASH_ONLY','NO_CROSS_ACCOUNT_NETTING',
   'NO_FUTURE_INCOME_SECURITY_SALE_OR_NEW_BORROWING','SCHEDULE_EQUALS_ADDITIONAL_NOT_DEDUCTED_OUTFLOWS'],
  limitations:['FICTIONAL_FIXTURE_VALIDATION_ONLY','NOT_INVESTABLE_CASH_OR_COLLATERAL_TAX_MODEL',
   'NO_NOTIFICATION_DELIVERY_OR_PRIVATE_STORAGE_CONNECTION']};
}
