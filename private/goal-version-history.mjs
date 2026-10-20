// PRIVATE admission check over the existing sealed revision log; no new registry, SQL writes or financial recalculation.
import {canonicalJson,context,PrivateStorageError} from './storage-contract.mjs';
import {openPrivateAnalysis} from './analysis-provenance.mjs';
export const GOAL_HISTORY_MAX_VERSIONS=128;
export const GOAL_HISTORY_MAX_BYTES=8388608;
export const GOAL_DECLARED_REVISION='CALLER_DECLARED_NOT_CONTENT_BOUND_OR_MONOTONICALLY_VERIFIED';
export const GOAL_CHECKED_REVISION='CONTENT_CHECKED_IN_COMPLETE_STORED_LINEAGE';
const ref=s=>typeof s==='string'&&s.trim().length>0&&s.length<=128;
const revision=n=>Number.isSafeInteger(n)&&n>0;
const validGoal=c=>c?.contractVersion===1&&c.scope==='PRIVATE_LOCAL_GOAL_FUNDING_ONLY'&&c.currency==='KRW'&&['CALCULATED','PARTIAL'].includes(c.status);
const ordered=(rows,key)=>[...rows].sort((a,b)=>a[key]<b[key]?-1:a[key]>b[key]?1:0);
function material(p,c){
 // Financial validity belongs to the recorded/current goal calculator, not a replay with today's clock.
 if(c!==undefined&&!validGoal(c)||p?.schemaVersion!==1||p.currency!=='KRW'||!revision(p.revision)||!ref(p.sourceRef)||p.coverageComplete!==true||
  !Array.isArray(p.accounts)||p.accounts.length>32||!Array.isArray(p.goals)||p.goals.length>64||
  !Array.isArray(p.allocations)||p.allocations.length>256||c!==undefined&&(c.totals?.planRevision!==p.revision||c.totals?.goalCount!==p.goals.length||
  !Array.isArray(c.goals)||c.goals.length!==p.goals.length))throw Error('HISTORY_GOAL_CONTRACT');
 const ids=new Set(),goals=new Map();
 for(const g of p.goals){
  if(!ref(g?.goalRef)||!revision(g.revision)||ids.has(g.goalRef))throw Error('HISTORY_GOAL_IDENTITY');ids.add(g.goalRef);
  if(c!==undefined){const saved=c.goals.find(x=>x.goalRef===g.goalRef);
   if(!saved||['revision','purpose','amountAsOfMs','dueAtMs','essential','priority','deferrable'].some(k=>saved[k]!==g[k])||
    saved.requiredKrw!==g.amountKrw)throw Error('HISTORY_GOAL_CONTENT');}
  goals.set(g.goalRef,{revision:g.revision,definition:canonicalJson(g,16384)});
 }
 // Observation/verification refresh and array order do not create a new goal definition.
 const plan=canonicalJson({schemaVersion:p.schemaVersion,currency:p.currency,sourceRef:p.sourceRef,coverageComplete:p.coverageComplete,
  accounts:ordered(p.accounts,'accountRef'),goals:ordered(p.goals,'goalRef'),allocations:ordered(p.allocations,'allocationRef')},131072);
 return {revision:p.revision,plan,goals};
}
function registry(){return {plans:new Map(),goals:new Map(),active:new Set(),lastPlanRevision:0};}
function conflict(state,m){
 if(m.revision<state.lastPlanRevision)return 'GOAL_PLAN_REVISION_REGRESSION';
 if(state.plans.has(m.revision)&&state.plans.get(m.revision)!==m.plan)return 'GOAL_PLAN_REVISION_CONTENT_CONFLICT';
 for(const[id,g]of m.goals){const old=state.goals.get(id);if(!old)continue;
  if(g.revision<old.highest)return 'GOAL_REVISION_REGRESSION';
  if(!state.active.has(id)&&g.revision<=old.highest)return 'GOAL_REAPPEARANCE_REQUIRES_NEW_REVISION';
  if(old.versions.has(g.revision)&&old.versions.get(g.revision)!==g.definition)return 'GOAL_REVISION_CONTENT_CONFLICT';
 }
 return null;
}
function accept(state,m){
 state.plans.set(m.revision,m.plan);state.lastPlanRevision=m.revision;state.active=new Set(m.goals.keys());
 for(const[id,g]of m.goals){const old=state.goals.get(id)??{highest:0,versions:new Map()};
  old.highest=Math.max(old.highest,g.revision);old.versions.set(g.revision,g.definition);state.goals.set(id,old);}
}
const decision=(head,status,planDecision,code=null)=>({contractVersion:1,historyThroughRevision:head.revision,status,planDecision,code});
const conflicts=['GOAL_PLAN_REVISION_REGRESSION','GOAL_PLAN_REVISION_CONTENT_CONFLICT','GOAL_REVISION_REGRESSION','GOAL_REAPPEARANCE_REQUIRES_NEW_REVISION','GOAL_REVISION_CONTENT_CONFLICT','EXPLICIT_GOAL_PLAN_REQUIRED'];
const unavailableCodes=['GOAL_HISTORY_VERSION_LIMIT','GOAL_HISTORY_RESOLVER_UNAVAILABLE','GOAL_HISTORY_BYTE_LIMIT','GOAL_HISTORY_UNAVAILABLE'];
function markerValid(m,v){return m&&Object.keys(m).sort().join(',')==='code,contractVersion,historyThroughRevision,planDecision,status'&&
 m.contractVersion===1&&m.historyThroughRevision===v.revision-1&&['CHECKED','CONFLICT','UNAVAILABLE'].includes(m.status)&&
 ['ACCEPTED','REJECTED','NOT_REQUESTED'].includes(m.planDecision)&&
 (m.planDecision!=='REJECTED'?m.status==='CHECKED'&&m.code===null:
  m.status==='CHECKED'?m.code==='GOAL_INPUT_BLOCKED':m.status==='CONFLICT'?conflicts.includes(m.code):unavailableCodes.includes(m.code));}
function historical(state,input,workflow,v){
 if(workflow?.contractVersion!==1||workflow.status!=='PARTIAL'||workflow.scope!=='PRIVATE_LOCAL_WORKFLOW_ONLY'||
  workflow.generatedAtMs!==v.generatedAtMs||workflow.inputCutoffMs!==v.inputCutoffMs||input?.ledger?.asOfMs!==v.inputCutoffMs||
  workflow.summary?.contractVersion!==1||workflow.summary.status!=='PARTIAL'||workflow.summary.scope!=='PRIVATE_LOCAL_RISK_SUMMARY_ONLY'||
  workflow.summary.generatedAtMs!==v.generatedAtMs||workflow.summary.inputCutoffMs!==v.inputCutoffMs)throw Error('HISTORY_WORKFLOW_LINK');
 const p=input.goalPlan,c=workflow?.summary?.components?.goalFunding,m=workflow?.goalVersionHistory;
 if(m!==undefined){
  if(!markerValid(m,v))throw Error('HISTORY_MARKER');
  privateGoalHistoryProjection(workflow,v);
  if(m.planDecision==='NOT_REQUESTED'){
   if(m.status!=='CHECKED'||m.code!==null||p!==undefined||state.lastPlanRevision!==0||c!==undefined)throw Error('HISTORY_NOT_REQUESTED');return;
  }
  if(m.planDecision==='REJECTED'){
   if(!m.code||c?.status!=='BLOCKED'||workflow.capabilities?.goalFunding!=='UNAVAILABLE'||workflow.capabilities?.investableCash!=='UNAVAILABLE'||
    workflow.summary?.components?.valuation?.totals?.investableCashKrw!==null&&workflow.summary?.components?.valuation?.totals)throw Error('HISTORY_REJECTION');
   if(m.status==='CHECKED'&&p===undefined)throw Error('HISTORY_REJECTED_INPUT_MISSING');
   if(m.status==='CONFLICT'){
    const actual=p===undefined?(state.lastPlanRevision>0?'EXPLICIT_GOAL_PLAN_REQUIRED':null):conflict(state,material(p));
    if(actual!==m.code)throw Error('HISTORY_REJECTED_CONFLICT_MISMATCH');
   }
   return; // Authenticated rejected attempts never become accepted version bindings.
  }
  if(m.status!=='CHECKED'||m.code!==null||p===undefined)throw Error('HISTORY_ACCEPTANCE');
 }
 if(p===undefined){if(c!==undefined)throw Error('HISTORY_UNEXPECTED_GOAL');return;}
 if(!validGoal(c)){
  if(m!==undefined||c?.status!=='BLOCKED')throw Error('HISTORY_UNKNOWN_GOAL');return;
 }
 if(c.generatedAtMs!==v.generatedAtMs||c.inputCutoffMs!==v.inputCutoffMs||p.ledgerAsOfMs!==v.inputCutoffMs)throw Error('HISTORY_GOAL_TIME');
 const parsed=material(p,c),code=conflict(state,parsed);if(code)throw Error('HISTORY_DECLARED_VERSION_CONFLICT');accept(state,parsed);
}
export async function checkPrivateGoalVersionHistory({store,scope,head,crypto,inputs,workflow,checkAccess=()=>{}}){
 const unavailable=code=>decision(head,'UNAVAILABLE','REJECTED',code);
 if(!Number.isSafeInteger(head?.revision)||head.revision<0||head.revision>GOAL_HISTORY_MAX_VERSIONS)return unavailable('GOAL_HISTORY_VERSION_LIMIT');
 try{
  if(typeof store?.readInputHistoryPage!=='function')return unavailable('GOAL_HISTORY_RESOLVER_UNAVAILABLE');
  const state=registry();let after=0,bytes=0,lastGenerated=0,lastCutoff=0;
  for(;;){
   checkAccess();const page=store.readInputHistoryPage(scope,head,after);
   if(!page||!Array.isArray(page.versions)||page.versions.length>4||!Number.isSafeInteger(page.bytes)||page.bytes<0||
    typeof page.complete!=='boolean'||!page.complete&&page.versions.length===0)throw Error('HISTORY_PAGE');
   bytes+=page.bytes;if(bytes>GOAL_HISTORY_MAX_BYTES)return unavailable('GOAL_HISTORY_BYTE_LIMIT');
   for(const v of page.versions){
    if(v.revision!==after+1||v.revision>head.revision||v.generatedAtMs<lastGenerated||v.inputCutoffMs<lastCutoff)throw Error('HISTORY_SEQUENCE');
    checkAccess();const input=await crypto.open(v.sealedInput,context(scope,'INPUT',String(v.revision)));
    checkAccess();const envelope=await crypto.open(v.sealedAnalysis,context(scope,'ANALYSIS',String(v.revision)));
    await openPrivateAnalysis(crypto,envelope,v,scope);
    const p=envelope.provenance,tag=await crypto.tag(canonicalJson({schemaVersion:1,requestId:p.requestId,expectedRevision:v.revision-1,inputs:input}),
     context(scope,'REQUEST_TAG',p.requestId));
    if(tag!==p.inputTag)throw Error('HISTORY_INPUT_LINK');
    historical(state,input,envelope.workflow,v);after=v.revision;lastGenerated=v.generatedAtMs;lastCutoff=v.inputCutoffMs;
   }
   if(page.complete){if(after!==head.revision)throw Error('HISTORY_COVERAGE');break;}
   if(after>=head.revision)throw Error('HISTORY_COVERAGE');
  }
  checkAccess();
  if(inputs.goalPlan===undefined)return state.lastPlanRevision===0?decision(head,'CHECKED','NOT_REQUESTED'):
   decision(head,'CONFLICT','REJECTED','EXPLICIT_GOAL_PLAN_REQUIRED');
  const c=workflow?.summary?.components?.goalFunding;
  if(!validGoal(c))return decision(head,'CHECKED','REJECTED','GOAL_INPUT_BLOCKED');
  const m=material(inputs.goalPlan,c),code=conflict(state,m);
  return code?decision(head,'CONFLICT','REJECTED',code):decision(head,'CHECKED','ACCEPTED');
 }catch(error){
  if(error instanceof PrivateStorageError&&error.code==='UNAUTHORIZED')throw error;
  return unavailable('GOAL_HISTORY_UNAVAILABLE');
 }
}
export function applyPrivateGoalHistory(workflow,history){
 const result={...workflow,goalVersionHistory:history};
 if(history.planDecision==='NOT_REQUESTED')return result;
 const s=workflow.summary,c=s.components;
 if(history.planDecision==='ACCEPTED'){
  return {...result,summary:{...s,components:{...c,goalFunding:{...c.goalFunding,goalRevisionEvidence:GOAL_CHECKED_REVISION}}}};
 }
 const goalFunding={contractVersion:1,status:'BLOCKED',scope:'PRIVATE_LOCAL_GOAL_FUNDING_ONLY',
  goalRevisionEvidence:GOAL_DECLARED_REVISION,totals:{planRevision:null,goalCount:null,requiredKrw:null,allocatedKrw:null,shortfallKrw:null,unallocatedCashKrw:null,earliestUnfundedDueAtMs:null},
  goals:[],accounts:[],issues:[{code:history.code}]};
 const valuation=c.valuation?.totals?{...c.valuation,totals:{...c.valuation.totals,investableCashKrw:null},
  limitations:[...(c.valuation.limitations??[]),'GOAL_HISTORY_NOT_CLEARED_FOR_INVESTABLE_CASH']}:c.valuation;
 const caps={...s.capabilities,goalFunding:'UNAVAILABLE',investableCash:'UNAVAILABLE'};
 return {...result,capabilities:{...workflow.capabilities,goalFunding:'UNAVAILABLE',investableCash:'UNAVAILABLE'},
  summary:{...s,capabilities:caps,components:{...c,valuation,goalFunding}}};
}
export function privateGoalHistoryProjection(workflow,head){
 const m=workflow.goalVersionHistory,c=workflow.summary?.components?.goalFunding;
 const declared={goalRevisionEvidence:GOAL_DECLARED_REVISION,goalHistoryThroughRevision:null};
 if(m===undefined){if(c?.goalRevisionEvidence===GOAL_CHECKED_REVISION)throw Error('HISTORY_PROOF_MISSING');return declared;}
 if(!markerValid(m,head))throw Error('HISTORY_VIEW_MARKER');
 if(m.planDecision==='NOT_REQUESTED'){
  if(m.status!=='CHECKED'||m.code!==null||c!==undefined||Object.hasOwn(workflow.capabilities??{},'goalFunding'))throw Error('HISTORY_VIEW_NOT_REQUESTED');return declared;
 }
 if(m.planDecision==='ACCEPTED'){
  const capability=c?.status==='CALCULATED'?'AVAILABLE':'UNAVAILABLE';
  if(m.status!=='CHECKED'||m.code!==null||!validGoal(c)||c.goalRevisionEvidence!==GOAL_CHECKED_REVISION||
   workflow.capabilities?.goalFunding!==capability||workflow.capabilities?.investableCash!=='UNAVAILABLE'||
   workflow.summary.capabilities?.goalFunding!==capability||workflow.summary.capabilities?.investableCash!=='UNAVAILABLE')throw Error('HISTORY_VIEW_ACCEPTANCE');
  return {goalRevisionEvidence:GOAL_CHECKED_REVISION,goalHistoryThroughRevision:m.historyThroughRevision};
 }
 if(!m.code||c?.status!=='BLOCKED'||workflow.capabilities?.goalFunding!=='UNAVAILABLE'||workflow.capabilities?.investableCash!=='UNAVAILABLE')throw Error('HISTORY_VIEW_REJECTION');
 return declared;
}
