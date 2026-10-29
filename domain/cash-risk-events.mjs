// PRIVATE local adapter only; no persistence, notification or scheduler connection.
import {createRiskEventState,reduceRiskEvents} from './risk-event-lifecycle.mjs';
const time=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());
const money=n=>Number.isSafeInteger(n)&&n>=0;
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(s);
const ref=s=>typeof s==='string'&&s.length>0&&s.length<=128;
const kinds={shortfall:'CASH_SHORTFALL_AT_DEADLINE',overdue:'OVERDUE_OPEN_OBLIGATION'};
export function createCashRiskEventState({horizonAtMs,bindings}={}){
 if(!time(horizonAtMs)||!Array.isArray(bindings)||bindings.length===0||bindings.length>32)throw new Error('INVALID_CASH_EVENT_SCOPE');
 const accounts=new Set(),ids=new Set();
 const normalized=bindings.map(b=>{
  if(!ref(b?.accountRef)||accounts.has(b.accountRef))throw new Error('INVALID_CASH_EVENT_SCOPE');
  accounts.add(b.accountRef);const item={accountRef:b.accountRef};
  for(const kind of Object.keys(kinds)){
   const e=b[kind];if(!id(e?.eventId)||ids.has(e.eventId)||!['INFO','WARNING','CRITICAL'].includes(e?.severity))
    throw new Error('INVALID_CASH_EVENT_SCOPE');
   ids.add(e.eventId);item[kind]={eventId:e.eventId,severity:e.severity};
  }
  return item;
 }).sort((a,b)=>a.accountRef<b.accountRef?-1:1);
 return {schemaVersion:1,horizonAtMs,bindings:normalized,lifecycle:createRiskEventState(),evidence:[]};
}
function validatedCash(cash,scope,now){
 if(cash?.contractVersion!==1||cash.status!=='CALCULATED'||cash.scope!=='PRIVATE_LOCAL_CASH_COVERAGE_ONLY'||
   cash.currency!=='KRW'||cash.coverage!=='DECLARED_ACCOUNTS_ONLY_NOT_EXTERNAL_VERIFICATION'||
   !Array.isArray(cash.issues)||cash.issues.length||!time(cash.generatedAtMs)||!time(cash.inputCutoffMs)||
   cash.inputCutoffMs>cash.generatedAtMs||cash.generatedAtMs>now||cash.horizonAtMs!==scope.horizonAtMs||
   cash.generatedAtMs>cash.horizonAtMs||!Array.isArray(cash.accounts)||cash.accounts.length!==scope.bindings.length||
   !Array.isArray(cash.riskEvents)||cash.riskEvents.length>64)return null;
 const accounts=new Map(),risks=[];let due=0n,gaps=0n,earliest=null;
 for(const a of cash.accounts){
  if(!ref(a?.accountRef)||accounts.has(a.accountRef)||!scope.bindings.some(b=>b.accountRef===a.accountRef)||
    ![a.balanceKrw,a.withdrawableKrw,a.dueThroughHorizonKrw,a.shortfallKrw,a.overdueOpenCount].every(money)||
    a.withdrawableKrw>a.balanceKrw||!Number.isSafeInteger(a.cashHeadroomKrw)||
    !Array.isArray(a.deadlines)||a.deadlines.length>128)return null;
  let lastDue=0,lastAmount=0,firstGap=null;const overdue=[];
  for(const d of a.deadlines){
   if(!time(d?.dueAtMs)||d.dueAtMs<=lastDue||d.dueAtMs>cash.horizonAtMs||!money(d.cumulativeDueKrw)||
      d.cumulativeDueKrw<lastAmount||d.cashHeadroomKrw!==a.withdrawableKrw-d.cumulativeDueKrw)return null;
   if(d.cashHeadroomKrw<0&&firstGap===null)firstGap=d.dueAtMs;
   const amount=d.cumulativeDueKrw-lastAmount;
   if(d.dueAtMs<cash.generatedAtMs&&amount>0)overdue.push([d.dueAtMs,amount]);
   lastDue=d.dueAtMs;lastAmount=d.cumulativeDueKrw;
  }
  if(lastAmount!==a.dueThroughHorizonKrw||a.cashHeadroomKrw!==a.withdrawableKrw-lastAmount||
    a.shortfallKrw!==Math.max(0,-a.cashHeadroomKrw)||a.firstShortfallDueAtMs!==firstGap||
    (overdue.length===0?a.overdueOpenCount!==0:a.overdueOpenCount<overdue.length))return null;
  if(firstGap!==null){risks.push({type:kinds.shortfall,accountRef:a.accountRef,dueAtMs:firstGap});earliest=earliest===null?firstGap:Math.min(earliest,firstGap);}
  if(a.overdueOpenCount>0)risks.push({type:kinds.overdue,accountRef:a.accountRef,count:a.overdueOpenCount});
  due+=BigInt(lastAmount);gaps+=BigInt(a.shortfallKrw);accounts.set(a.accountRef,{...a,overdue});
 }
 if(due>BigInt(Number.MAX_SAFE_INTEGER)||gaps>BigInt(Number.MAX_SAFE_INTEGER)||
   cash.totals?.dueThroughHorizonKrw!==Number(due)||cash.totals?.accountShortfallSumKrw!==Number(gaps)||
   cash.totals?.earliestShortfallDueAtMs!==earliest)return null;
 const key=r=>JSON.stringify([r?.type,r?.accountRef,r?.dueAtMs??null,r?.count??null]);
 if(JSON.stringify(risks.map(key).sort())!==JSON.stringify(cash.riskEvents.map(key).sort()))return null;
 return accounts;
}
export function advanceCashRiskEvents(previous,cash,policy){
 if(previous?.schemaVersion!==1)throw new Error('INVALID_CASH_EVENT_STATE');
 const scope=createCashRiskEventState(previous);
 const baseline=reduceRiskEvents(previous.lifecycle,{schemaVersion:1,sourceStatus:'FAILED'},policy);
 const records=new Map(),known=new Map();
 for(const b of scope.bindings)for(const [kind,eventType] of Object.entries(kinds))known.set(b[kind].eventId,{...b[kind],eventType});
 if(!Array.isArray(previous.evidence)||previous.evidence.length>64)throw new Error('INVALID_CASH_EVENT_STATE');
 for(const e of previous.evidence){
  if(!known.has(e?.eventId)||records.has(e.eventId)||!Number.isSafeInteger(e.evidenceVersion)||e.evidenceVersion<1||
    typeof e.signature!=='string'||e.signature.length>8192)throw new Error('INVALID_CASH_EVENT_STATE');
  records.set(e.eventId,{eventId:e.eventId,evidenceVersion:e.evidenceVersion,signature:e.signature});
 }
 if(records.size!==baseline.state.events.length)throw new Error('INVALID_CASH_EVENT_STATE');
 for(const e of baseline.state.events){const binding=known.get(e.eventId),r=records.get(e.eventId);
  if(!binding||!r||e.evidenceVersion!==r.evidenceVersion||e.eventType!==binding.eventType||e.severity!==binding.severity)
   throw new Error('INVALID_CASH_EVENT_STATE');
 }
 const state={...scope,lifecycle:baseline.state,evidence:[...records.values()].sort((a,b)=>a.eventId<b.eventId?-1:1)};
 const fail=code=>({...baseline,scope:'PRIVATE_CASH_EVENT_ADAPTER_ONLY',state,issues:[{code}]});
 const accounts=validatedCash(cash,scope,policy.nowMs);
 if(!accounts)return fail('CASH_RESULT_UNAVAILABLE_OR_SCOPE_INCONSISTENT');
 if(policy.nowMs-cash.generatedAtMs>policy.maxCaptureAgeMs||policy.nowMs-cash.inputCutoffMs>policy.maxInputAgeMs)
  return fail('STALE_CASH_CAPTURE_OR_INPUT');
 const events=[],nextRecords=new Map(records);
 for(const b of scope.bindings){const a=accounts.get(b.accountRef);
  for(const [kind,eventType] of Object.entries(kinds)){
   const binding=b[kind],active=kind==='shortfall'?a.shortfallKrw>0:a.overdueOpenCount>0;
   const old=records.get(binding.eventId);if(!active&&!old)continue;
   const signature=JSON.stringify(!active?['RESOLVED']:kind==='shortfall'?
    ['ACTIVE',a.shortfallKrw,a.firstShortfallDueAtMs]:['ACTIVE',a.overdueOpenCount,a.overdue]);
   const changed=old&&old.signature!==signature;
   if(changed&&old.evidenceVersion===Number.MAX_SAFE_INTEGER)return fail('EVENT_EVIDENCE_VERSION_EXHAUSTED');
   const evidenceVersion=old?old.evidenceVersion+(changed?1:0):1;
   nextRecords.set(binding.eventId,{eventId:binding.eventId,evidenceVersion,signature});
   events.push({eventId:binding.eventId,eventType,severity:binding.severity,evidenceVersion,status:active?'ACTIVE':'RESOLVED'});
  }
 }
 const reduced=reduceRiskEvents(state.lifecycle,{schemaVersion:1,sourceStatus:'OK',observedAtMs:cash.generatedAtMs,
  inputCutoffMs:cash.inputCutoffMs,events},policy);
 if(reduced.status!=='REDUCED')return {...reduced,scope:'PRIVATE_CASH_EVENT_ADAPTER_ONLY',state};
 return {...reduced,scope:'PRIVATE_CASH_EVENT_ADAPTER_ONLY',
  state:{...state,lifecycle:reduced.state,evidence:[...nextRecords.values()].sort((a,b)=>a.eventId<b.eventId?-1:1)}};
}
