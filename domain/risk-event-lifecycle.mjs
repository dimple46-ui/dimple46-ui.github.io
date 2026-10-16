// PRIVATE pure reducer only. No sending, persistence, scheduler or public Worker integration.
const time=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(s);
const type=s=>typeof s==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(s);
const version=n=>Number.isSafeInteger(n)&&n>=1;
const severity=s=>['INFO','WARNING','CRITICAL'].includes(s);
const notification=()=>({connection:'NOT_CONNECTED',requestStatus:'NOT_REQUESTED',deliveryStatus:'UNCONFIRMED',
 acknowledgementStatus:'UNCONFIRMED',lastNotifiedAtMs:null,lastNotifiedEvidenceVersion:null});
const notificationValid=n=>n&&Object.entries(notification()).every(([k,v])=>n[k]===v);
const empty=()=>({schemaVersion:1,lastObservedAtMs:null,lastInputCutoffMs:null,events:[]});
export const createRiskEventState=()=>empty();
function normalizeState(previous,now){
 if(previous?.schemaVersion!==1||!Array.isArray(previous.events)||previous.events.length>1000)
  throw new Error('INVALID_PREVIOUS_EVENT_STATE');
 const hasTime=previous.lastObservedAtMs!==null||previous.lastInputCutoffMs!==null;
 if(hasTime&&(!time(previous.lastObservedAtMs)||!time(previous.lastInputCutoffMs)||
    previous.lastInputCutoffMs>previous.lastObservedAtMs||previous.lastObservedAtMs>now))
  throw new Error('INVALID_PREVIOUS_EVENT_STATE');
 if(!hasTime&&previous.events.length)throw new Error('INVALID_PREVIOUS_EVENT_STATE');
 const seen=new Set(),events=[];
 for(const e of previous.events){
  if(!id(e?.eventId)||seen.has(e.eventId)||!type(e?.eventType)||!version(e?.evidenceVersion)||!severity(e?.severity)||
    !['ACTIVE','RESOLVED'].includes(e?.status)||![e?.firstSeenAtMs,e?.lastSeenAtMs,e?.lastChangedAtMs].every(time)||
    e.firstSeenAtMs>e.lastChangedAtMs||e.lastChangedAtMs>e.lastSeenAtMs||e.lastSeenAtMs>previous.lastObservedAtMs||
    (e.status==='ACTIVE'?e.resolvedAtMs!==null:!time(e.resolvedAtMs)||e.resolvedAtMs<e.firstSeenAtMs||e.resolvedAtMs>e.lastChangedAtMs)||!notificationValid(e.notification))
   throw new Error('INVALID_PREVIOUS_EVENT_STATE');
  seen.add(e.eventId);
  events.push({eventId:e.eventId,eventType:e.eventType,evidenceVersion:e.evidenceVersion,severity:e.severity,status:e.status,
   firstSeenAtMs:e.firstSeenAtMs,lastSeenAtMs:e.lastSeenAtMs,lastChangedAtMs:e.lastChangedAtMs,resolvedAtMs:e.resolvedAtMs,
   notification:notification()});
 }
 return {schemaVersion:1,lastObservedAtMs:previous.lastObservedAtMs,lastInputCutoffMs:previous.lastInputCutoffMs,events};
}
export function reduceRiskEvents(previous,capture,{nowMs,maxCaptureAgeMs,maxInputAgeMs}={}){
 if(!time(nowMs)||![maxCaptureAgeMs,maxInputAgeMs].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('INVALID_EVENT_POLICY');
 const state=normalizeState(previous,nowMs);
 const result=(status,code,intents=[],unverifiedEventIds=[])=>({contractVersion:1,status,scope:'PRIVATE_LOCAL_EVENT_LIFECYCLE_ONLY',
  generatedAtMs:nowMs,state,intents,unverifiedEventIds,issues:code?[{code}]:[],notificationConnection:'NOT_CONNECTED',
  limitations:['INTENT_IS_NOT_SENT_DELIVERED_OR_ACKNOWLEDGED','CALLER_VERSION_MUST_REPRESENT_MATERIAL_EVIDENCE',
   'EXPLICIT_RESOLUTION_ONLY_NO_ABSENCE_OR_FAILURE_RESOLUTION','NO_STORAGE_OR_TRANSPORT_CONNECTED']});
 if(capture?.schemaVersion!==1||!['OK','FAILED'].includes(capture?.sourceStatus))return result('BLOCKED','INVALID_CAPTURE');
 if(capture.sourceStatus==='FAILED')return result('DEGRADED','CAPTURE_FAILED',[],state.events.filter(e=>e.status==='ACTIVE').map(e=>e.eventId));
 if(!time(capture.observedAtMs)||!time(capture.inputCutoffMs)||capture.inputCutoffMs>capture.observedAtMs||capture.observedAtMs>nowMs)
  return result('BLOCKED','INVALID_OR_FUTURE_CAPTURE_TIME');
 if(nowMs-capture.observedAtMs>maxCaptureAgeMs)return result('DEGRADED','STALE_CAPTURE');
 if(nowMs-capture.inputCutoffMs>maxInputAgeMs)return result('DEGRADED','STALE_INPUT');
 if((state.lastObservedAtMs!==null&&capture.observedAtMs<state.lastObservedAtMs)||
   (state.lastInputCutoffMs!==null&&capture.inputCutoffMs<state.lastInputCutoffMs))return result('BLOCKED','OUT_OF_ORDER_CAPTURE');
 if(!Array.isArray(capture.events)||capture.events.length>100)return result('BLOCKED','BOUNDED_EVENT_CAPTURE_REQUIRED');
 const old=new Map(state.events.map(e=>[e.eventId,e])),seen=new Set();
 // Validate the complete batch before mutating any event or emitting an intent.
 for(const e of capture.events){
  if(!id(e?.eventId)||seen.has(e.eventId)||!type(e?.eventType)||!version(e?.evidenceVersion)||!severity(e?.severity)||
    !['ACTIVE','RESOLVED','UNKNOWN'].includes(e?.status))return result('BLOCKED','INVALID_OR_DUPLICATE_EVENT');
  seen.add(e.eventId);const p=old.get(e.eventId);
  if(p&&e.eventType!==p.eventType)return result('BLOCKED','EVENT_IDENTITY_CONFLICT');
  if(e.status==='UNKNOWN')continue;
  if(!p&&e.status==='RESOLVED')return result('BLOCKED','RESOLUTION_WITHOUT_PRIOR_EVENT');
  if(p&&(e.evidenceVersion<p.evidenceVersion||(e.evidenceVersion===p.evidenceVersion&&
      (e.status!==p.status||e.severity!==p.severity))))return result('BLOCKED','EVIDENCE_VERSION_CONFLICT');
 }
 if(state.events.length+capture.events.filter(e=>e.status==='ACTIVE'&&!old.has(e.eventId)).length>1000)
  return result('BLOCKED','EVENT_STATE_CAPACITY_EXCEEDED');
 const intents=[],unverified=new Set(state.events.filter(e=>e.status==='ACTIVE'&&!seen.has(e.eventId)).map(e=>e.eventId));
 for(const e of capture.events){
  const p=old.get(e.eventId);
  if(e.status==='UNKNOWN'){if(p?.status==='ACTIVE')unverified.add(e.eventId);continue;}
  if(p&&e.evidenceVersion===p.evidenceVersion){p.lastSeenAtMs=capture.observedAtMs;continue;}
  const transition=!p?'OPENED':p.status==='RESOLVED'&&e.status==='ACTIVE'?'REOPENED':e.status==='RESOLVED'&&p.status==='ACTIVE'?'RESOLVED':'CHANGED';
  const next={eventId:e.eventId,eventType:e.eventType,evidenceVersion:e.evidenceVersion,severity:e.severity,status:e.status,
   firstSeenAtMs:p?.firstSeenAtMs??capture.observedAtMs,lastSeenAtMs:capture.observedAtMs,
   lastChangedAtMs:capture.observedAtMs,resolvedAtMs:e.status==='RESOLVED'?
    (p?.status==='RESOLVED'?p.resolvedAtMs:capture.observedAtMs):null,notification:notification()};
  old.set(e.eventId,next);
  intents.push({intentId:`${e.eventId}:${e.evidenceVersion}:${transition}`,eventId:e.eventId,eventType:e.eventType,
   evidenceVersion:e.evidenceVersion,severity:e.severity,transition,generatedAtMs:nowMs,requestStatus:'NOT_REQUESTED'});
 }
 state.events=[...old.values()].sort((a,b)=>a.eventId<b.eventId?-1:a.eventId>b.eventId?1:0);
 intents.sort((a,b)=>a.eventId<b.eventId?-1:a.eventId>b.eventId?1:0);
 state.lastObservedAtMs=capture.observedAtMs;state.lastInputCutoffMs=capture.inputCutoffMs;
 return result(unverified.size?'DEGRADED':'REDUCED',unverified.size?'ACTIVE_EVENT_NOT_CONFIRMED':null,intents,[...unverified].sort());
}
