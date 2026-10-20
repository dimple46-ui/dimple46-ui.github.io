// Fixed SQL + synchronous transaction contract. Tested on local memory SQLite only.
// No live migration, D1 binding, owner creation, restore, epoch transition or dispatch API.
import {fail,sameScope,envelopeValid,opaqueId,intentId,timestamp} from './storage-contract.mjs';
export const PRIVATE_STORAGE_SCHEMA_V1=`
CREATE TABLE private_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_version INTEGER NOT NULL,
 owner_ref TEXT NOT NULL,authorization_epoch TEXT NOT NULL,policy_epoch TEXT NOT NULL,restore_epoch TEXT NOT NULL,
 mode TEXT NOT NULL,revision INTEGER NOT NULL,generated_at_ms INTEGER NOT NULL,input_cutoff_ms INTEGER NOT NULL,sealed_state TEXT NOT NULL);
CREATE TABLE private_versions(revision INTEGER PRIMARY KEY,policy_epoch TEXT NOT NULL,restore_epoch TEXT NOT NULL,
 generated_at_ms INTEGER NOT NULL,input_cutoff_ms INTEGER NOT NULL,sealed_input TEXT NOT NULL,sealed_analysis TEXT NOT NULL);
CREATE TABLE private_requests(policy_epoch TEXT NOT NULL,restore_epoch TEXT NOT NULL,request_id TEXT NOT NULL,
 payload_tag TEXT NOT NULL,revision INTEGER NOT NULL,generated_at_ms INTEGER NOT NULL,input_cutoff_ms INTEGER NOT NULL,
 PRIMARY KEY(policy_epoch,restore_epoch,request_id));
CREATE TABLE private_outbox(policy_epoch TEXT NOT NULL,restore_epoch TEXT NOT NULL,intent_id TEXT NOT NULL,
 revision INTEGER NOT NULL,status TEXT NOT NULL CHECK(status='PENDING_REVIEW'),sealed_payload TEXT NOT NULL,
 PRIMARY KEY(policy_epoch,restore_epoch,intent_id));`;
const headRow=r=>r&&({schemaVersion:r.schema_version,ownerRef:r.owner_ref,authorizationEpoch:r.authorization_epoch,
 policyEpoch:r.policy_epoch,restoreEpoch:r.restore_epoch,mode:r.mode,revision:r.revision,
 generatedAtMs:r.generated_at_ms,inputCutoffMs:r.input_cutoff_ms,sealedState:r.sealed_state});
const receipt=r=>r&&({payloadTag:r.payload_tag,revision:r.revision,generatedAtMs:r.generated_at_ms,inputCutoffMs:r.input_cutoff_ms});
export const PRIVATE_INPUT_HISTORY_PAGE_SIZE=4;
export const PRIVATE_INPUT_HISTORY_PAGE_BYTES=2097152;
export function createPrivateTransactionStore({sql,transactionSync}){
 if(typeof sql?.exec!=='function'||typeof transactionSync!=='function')throw new TypeError('PRIVATE_STORAGE_DEPENDENCY_REQUIRED');
 const rows=(query,...args)=>Array.from(sql.exec(query,...args));
 function readHead(){return headRow(rows('SELECT * FROM private_head WHERE singleton=1')[0]);}
 function checkHead(scope){const h=readHead();
  if(!h||!sameScope(h,scope)||h.mode!=='ACTIVE'||!Number.isSafeInteger(h.revision)||h.revision<0||!envelopeValid(h.sealedState)||
   (h.revision>0&&(!timestamp(h.generatedAtMs)||!timestamp(h.inputCutoffMs)||h.inputCutoffMs>h.generatedAtMs)))fail('STORE_FROZEN_OR_SCOPE_MISMATCH');return h;
 }
 function findReceipt(scope,requestId,head){const r=receipt(rows('SELECT payload_tag,revision,generated_at_ms,input_cutoff_ms FROM private_requests WHERE policy_epoch=? AND restore_epoch=? AND request_id=?',scope.policyEpoch,scope.restoreEpoch,requestId)[0]);
  if(r&&(!opaqueId(r.payloadTag)||!Number.isSafeInteger(r.revision)||r.revision<1||r.revision>head.revision||
   !timestamp(r.generatedAtMs)||!timestamp(r.inputCutoffMs)||r.inputCutoffMs>r.generatedAtMs||r.generatedAtMs>head.generatedAtMs||r.inputCutoffMs>head.inputCutoffMs))fail('STORE_FROZEN_OR_SCOPE_MISMATCH');return r;
 }
 function readReceipt(scope,requestId){return findReceipt(scope,requestId,checkHead(scope));}
 function readInputHistoryPage(scope,expectedHead,afterRevision){
  const unavailable=()=>fail('PRIVATE_INPUT_HISTORY_UNAVAILABLE');
  if(!Number.isSafeInteger(afterRevision)||afterRevision<0||afterRevision>expectedHead?.revision)unavailable();
  const page=transactionSync(()=>{
   const h=checkHead(scope);
   if(!sameScope(h,expectedHead)||h.revision!==expectedHead.revision||h.generatedAtMs!==expectedHead.generatedAtMs||
    h.inputCutoffMs!==expectedHead.inputCutoffMs)unavailable();
   if(afterRevision===0&&rows('SELECT revision FROM private_versions WHERE revision<1 OR revision>? LIMIT 1',h.revision).length)unavailable();
   const records=rows('SELECT revision,policy_epoch,restore_epoch,generated_at_ms,input_cutoff_ms,sealed_input,sealed_analysis FROM private_versions WHERE revision>? AND revision<=? ORDER BY revision ASC LIMIT 4',afterRevision,h.revision);
   if(records.length>PRIVATE_INPUT_HISTORY_PAGE_SIZE||afterRevision<h.revision&&records.length===0)unavailable();
   let bytes=0;
   const versions=records.map((r,i)=>{
    if(r.revision!==afterRevision+i+1||r.policy_epoch!==h.policyEpoch||r.restore_epoch!==h.restoreEpoch||
     !timestamp(r.generated_at_ms)||!timestamp(r.input_cutoff_ms)||r.input_cutoff_ms>r.generated_at_ms||
     r.generated_at_ms>h.generatedAtMs||r.input_cutoff_ms>h.inputCutoffMs||!envelopeValid(r.sealed_input)||!envelopeValid(r.sealed_analysis))unavailable();
    bytes+=new TextEncoder().encode(r.sealed_input).byteLength+new TextEncoder().encode(r.sealed_analysis).byteLength;
    if(bytes>PRIVATE_INPUT_HISTORY_PAGE_BYTES)unavailable();
    if(r.revision===h.revision&&(r.generated_at_ms!==h.generatedAtMs||r.input_cutoff_ms!==h.inputCutoffMs))unavailable();
    return {revision:r.revision,generatedAtMs:r.generated_at_ms,inputCutoffMs:r.input_cutoff_ms,sealedInput:r.sealed_input,sealedAnalysis:r.sealed_analysis};
   });
   return {versions,bytes,complete:afterRevision+versions.length===h.revision};
  });
  if(!page||typeof page.then==='function')unavailable();return page;
 }
 function readAnalysisSnapshot(scope){
  const snapshot=transactionSync(()=>{
   const h=checkHead(scope);if(h.revision===0)return {head:h,version:null};
   const records=rows('SELECT revision,policy_epoch,restore_epoch,generated_at_ms,input_cutoff_ms,sealed_analysis FROM private_versions WHERE revision=?',h.revision);
   const r=records[0];if(records.length!==1||r.policy_epoch!==h.policyEpoch||r.restore_epoch!==h.restoreEpoch||
    r.generated_at_ms!==h.generatedAtMs||r.input_cutoff_ms!==h.inputCutoffMs||!envelopeValid(r.sealed_analysis))fail('PRIVATE_READ_UNAVAILABLE');
   return {head:h,version:{revision:r.revision,sealedAnalysis:r.sealed_analysis}};
  });
  if(!snapshot||typeof snapshot.then==='function')fail('PRIVATE_READ_UNAVAILABLE');return snapshot;
 }
 function commit(p){
  if(!opaqueId(p?.requestId)||!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<0||!opaqueId(p.payloadTag)||
    p.resultStatus!=='REDUCED'||![p.sealedInput,p.sealedAnalysis,p.sealedState].every(envelopeValid)||
    !timestamp(p.generatedAtMs)||!timestamp(p.inputCutoffMs)||p.inputCutoffMs>p.generatedAtMs||
    !Array.isArray(p.outbox)||p.outbox.length>64||new Set(p.outbox.map(x=>x?.intentId)).size!==p.outbox.length||
    p.outbox.some(x=>!intentId(x?.intentId)||!envelopeValid(x.sealedPayload)))fail('PREPARED_STATE_NOT_COMMITTABLE');
  return transactionSync(()=>{
   const h=checkHead(p.scope),prior=findReceipt(p.scope,p.requestId,h);
   if(prior){if(prior.payloadTag!==p.payloadTag)fail('IDEMPOTENCY_CONFLICT');return {...prior,replayed:true};}
   if(h.revision!==p.expectedRevision)fail('REVISION_CONFLICT');
   if(h.revision>=Number.MAX_SAFE_INTEGER)fail('REVISION_EXHAUSTED');
   if(p.generatedAtMs<h.generatedAtMs||p.inputCutoffMs<h.inputCutoffMs)fail('TIME_REGRESSION');
   const revision=h.revision+1;
   sql.exec('INSERT INTO private_versions VALUES(?,?,?,?,?,?,?)',revision,p.scope.policyEpoch,p.scope.restoreEpoch,p.generatedAtMs,p.inputCutoffMs,p.sealedInput,p.sealedAnalysis);
   sql.exec('UPDATE private_head SET revision=?,generated_at_ms=?,input_cutoff_ms=?,sealed_state=? WHERE singleton=1',revision,p.generatedAtMs,p.inputCutoffMs,p.sealedState);
   for(const item of p.outbox)sql.exec('INSERT INTO private_outbox VALUES(?,?,?,?,?,?)',p.scope.policyEpoch,p.scope.restoreEpoch,item.intentId,revision,'PENDING_REVIEW',item.sealedPayload);
   sql.exec('INSERT INTO private_requests VALUES(?,?,?,?,?,?,?)',p.scope.policyEpoch,p.scope.restoreEpoch,p.requestId,p.payloadTag,revision,p.generatedAtMs,p.inputCutoffMs);
   return {revision,generatedAtMs:p.generatedAtMs,inputCutoffMs:p.inputCutoffMs,replayed:false};
  });
 }
 return {readHead,readReceipt,readAnalysisSnapshot,readInputHistoryPage,commit};
}
