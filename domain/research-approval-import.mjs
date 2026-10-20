// Offline staging contract only. No actual identity provider, database, engine grant or Watch integration.
import {canonicalJson,opaqueId,timestamp,scopeValid,sameScope} from '../private/storage-contract.mjs';
import {researchHash,validateResearchPackage} from './research-handoff.mjs';
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const copy=x=>JSON.parse(canonicalJson(x));
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const closed=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join()===keys.split(' ').sort().join();
const scopeOk=s=>scopeValid(s)&&closed(s,'schemaVersion ownerRef authorizationEpoch policyEpoch restoreEpoch');
const requestOk=r=>closed(r,'schema_version receipt_ref package_id revision content_sha256 decision')&&r.schema_version===1&&
 opaqueId(r.receipt_ref)&&opaqueId(r.package_id)&&Number.isSafeInteger(r.revision)&&r.revision>0&&hash(r.content_sha256)&&['APPROVE','WITHDRAW'].includes(r.decision);
const sameBinding=(a,b)=>['receipt_ref','package_id','revision','content_sha256','decision'].every(k=>a[k]===b[k]);
const genesis=()=>({sequence:0,event_hash:'0'.repeat(64)});
export const approvalImportGenesis=()=>freeze(genesis());

// resolveDecision is a trusted application dependency. It must not simply echo the submitted request.
export function createResearchApprovalImportPlanner({clock,resolveDecision}={}){
 if(typeof clock!=='function'||typeof resolveDecision!=='function')fail('TRUSTED_IMPORT_DEPENDENCIES_REQUIRED');
 const readClock=()=>{let n;try{n=clock();}catch{fail('IMPORT_CLOCK_FAILED');}if(!timestamp(n))fail('INVALID_IMPORT_TIME');return n;};
 return Object.freeze({async prepare({request,package:input,expectedScope,notBeforeMs}={}){
  let r,scope;try{r=copy(request);scope=copy(expectedScope);}catch{fail('INVALID_IMPORT_REQUEST');}
  if(!requestOk(r)||!scopeOk(scope))fail('INVALID_IMPORT_REQUEST');
  const started=readClock();
  if(notBeforeMs!==undefined){
   if(!timestamp(notBeforeMs))fail('INVALID_IMPORT_TIME');
   if(started<notBeforeMs)fail('IMPORT_CLOCK_REGRESSION');
  }
  const p=validateResearchPackage(input,{nowMs:started}).package;
  if(!['package_id','revision','content_sha256'].every(k=>r[k]===p[k]))fail('IMPORT_PACKAGE_BINDING_MISMATCH');
  if(r.decision==='APPROVE'&&(p.review_at_ms<=started||p.expires_at_ms<=started))fail('RESEARCH_REVIEW_OR_EXPIRY_DUE');
  let proof;try{proof=copy(await resolveDecision(freeze({request:r,expectedScope:scope})));}catch{fail('TRUSTED_DECISION_LOOKUP_FAILED');}
  const at=readClock();if(at<started)fail('IMPORT_CLOCK_REGRESSION');
  if(!closed(proof,'schema_version receipt_ref package_id revision content_sha256 decision verified role source_kind scope decided_at_ms source_recorded_at_ms')||
   proof.schema_version!==1||proof.verified!==true||proof.role!=='USER_APPROVER'||proof.source_kind!=='AUTHENTICATED_USER_DECISION'||!sameBinding(proof,r)||
   !scopeOk(proof.scope)||!sameScope(proof.scope,scope))fail('TRUSTED_DECISION_NOT_VERIFIED');
  if(!timestamp(proof.decided_at_ms)||!timestamp(proof.source_recorded_at_ms)||proof.decided_at_ms<p.generated_at_ms||
   proof.source_recorded_at_ms<proof.decided_at_ms||proof.source_recorded_at_ms>at)fail('INVALID_SOURCE_DECISION_TIME');
  if(r.decision==='APPROVE'&&(p.review_at_ms<=at||p.expires_at_ms<=at))fail('RESEARCH_REVIEW_OR_EXPIRY_DUE');
  const body={schema_version:1,request:r,scope,source_decided_at_ms:proof.decided_at_ms,source_recorded_at_ms:proof.source_recorded_at_ms,
   imported_at_ms:at,source_attestation_hash:researchHash(proof),effect:'STAGING_ONLY_NOT_ENGINE_APPROVAL'};
  return freeze({...body,plan_hash:researchHash(body)});
 }});
}
function planOk(p){
 if(!closed(p,'schema_version request scope source_decided_at_ms source_recorded_at_ms imported_at_ms source_attestation_hash effect plan_hash')||
  p.schema_version!==1||!requestOk(p.request)||!scopeOk(p.scope)||p.effect!=='STAGING_ONLY_NOT_ENGINE_APPROVAL'||!hash(p.source_attestation_hash)||
  ![p.source_decided_at_ms,p.source_recorded_at_ms,p.imported_at_ms].every(timestamp)||p.source_decided_at_ms>p.source_recorded_at_ms||
  p.source_recorded_at_ms>p.imported_at_ms)fail('INVALID_IMPORT_PLAN');
 const {plan_hash,...body}=p;if(!hash(plan_hash)||plan_hash!==researchHash(body))fail('IMPORT_PLAN_HASH_MISMATCH');
}
// Integrity checking is not identity verification. expectedHead must come from trusted storage outside the journal bytes.
export function inspectApprovalImportJournal({entries,expectedHead,expectedScope,asOfMs,nowMs}={}){
 let list,anchor,scope;try{list=copy(entries);anchor=copy(expectedHead);scope=copy(expectedScope);}catch{fail('INVALID_JOURNAL_INPUT');}
 if(!Array.isArray(list)||list.length>128||!closed(anchor,'sequence event_hash')||!Number.isSafeInteger(anchor.sequence)||anchor.sequence<0||
  !hash(anchor.event_hash)||!scopeOk(scope)||!timestamp(asOfMs)||!timestamp(nowMs)||asOfMs>nowMs)fail('INVALID_JOURNAL_INPUT');
 let head=genesis(),previousTime=0;const seen=new Map(),versions=new Map(),withdrawn=new Set(),visible=[];
 for(const e of list){
  if(!closed(e,'sequence previous_hash plan event_hash')||e.sequence!==head.sequence+1||e.previous_hash!==head.event_hash)fail('JOURNAL_CHAIN_INVALID');
  planOk(e.plan);const {event_hash,...body}=e;if(!hash(event_hash)||event_hash!==researchHash(body))fail('JOURNAL_HASH_MISMATCH');
  const p=e.plan,r=p.request,key=r.package_id+':'+r.revision;
  if(!sameScope(p.scope,scope))fail('JOURNAL_SCOPE_MISMATCH');
  if(p.imported_at_ms<previousTime||p.imported_at_ms>nowMs)fail('JOURNAL_TIME_INVALID');
  if(seen.has(r.receipt_ref))fail('JOURNAL_DUPLICATE_RECEIPT');
  const prior=versions.get(key);
  if(prior&&prior.request.content_sha256!==r.content_sha256)fail('JOURNAL_VERSION_CONFLICT');
  if(prior&&p.source_recorded_at_ms<prior.source_recorded_at_ms)fail('SOURCE_DECISION_OUT_OF_ORDER');
  if(r.decision==='APPROVE'&&withdrawn.has(key))fail('WITHDRAWAL_REQUIRES_NEW_REVISION');
  if(r.decision==='WITHDRAW')withdrawn.add(key);
  seen.set(r.receipt_ref,p);versions.set(key,p);previousTime=p.imported_at_ms;
  head={sequence:e.sequence,event_hash:e.event_hash};if(p.imported_at_ms<=asOfMs)visible.push(e);
 }
 if(anchor.sequence!==head.sequence||anchor.event_hash!==head.event_hash)fail('TRUSTED_JOURNAL_HEAD_MISMATCH');
 return freeze({status:'INTEGRITY_CHECKED_ONLY',head,entries:list,visible_entries:visible,
  authentication:'NOT_PROVEN_BY_HASH_CHAIN',persistence:'CALLER_STORAGE_NOT_IMPLEMENTED',engine_approval:'NOT_GRANTED'});
}
// A proposal is not a commit: caller must atomically compare the head and append with the new trusted anchor.
export function proposeApprovalImportAppend({plan,entries,expectedHead,expectedScope,nowMs}={}){
 const journal=inspectApprovalImportJournal({entries,expectedHead,expectedScope,asOfMs:nowMs,nowMs});
 const p=copy(plan);planOk(p);if(!sameScope(p.scope,expectedScope)||p.imported_at_ms>nowMs)fail('INVALID_IMPORT_PLAN');
 const prior=journal.entries.find(e=>e.plan.request.receipt_ref===p.request.receipt_ref);
 if(prior){if(prior.plan.source_attestation_hash!==p.source_attestation_hash||!sameBinding(prior.plan.request,p.request))fail('IMPORT_RECEIPT_CONFLICT');
  return freeze({status:'DUPLICATE_NO_APPEND',entries:journal.entries,head:journal.head,engine_approval:'NOT_GRANTED'});}
 if(journal.entries.length>=128)fail('IMPORT_JOURNAL_CAPACITY');
 const body={sequence:journal.head.sequence+1,previous_hash:journal.head.event_hash,plan:p},event={...body,event_hash:researchHash(body)};
 const proposed=inspectApprovalImportJournal({entries:[...journal.entries,event],expectedHead:{sequence:event.sequence,event_hash:event.event_hash},
  expectedScope,asOfMs:nowMs,nowMs});
 return freeze({status:'APPEND_PROPOSED_NOT_COMMITTED',entries:proposed.entries,head:proposed.head,engine_approval:'NOT_GRANTED'});
}
