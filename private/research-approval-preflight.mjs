// Offline factory only. No configured authority, HTTP handler, receipt persistence or engine activation.
import {scopeValid,timestamp} from './storage-contract.mjs';
import {parseResearchApprovalImportRequest} from './research-approval-request.mjs';
import {createResearchApprovalImportPlanner} from '../domain/research-approval-import.mjs';
const permitted=new Set(['INVALID_RESEARCH_APPROVAL_REQUEST','TRUSTED_DECISION_NOT_VERIFIED','IMPORT_PACKAGE_BINDING_MISMATCH',
 'RESEARCH_REVIEW_OR_EXPIRY_DUE','INVALID_SOURCE_DECISION_TIME','IMPORT_CLOCK_REGRESSION','INVALID_IMPORT_TIME','IMPORT_CLOCK_FAILED']);
export function createResearchApprovalPreflight({authorize,resolveDecision,clock}={}){
 if(![authorize,resolveDecision,clock].every(f=>typeof f==='function'))throw new TypeError('TRUSTED_PREFLIGHT_DEPENDENCIES_REQUIRED');
 const planner=createResearchApprovalImportPlanner({clock,resolveDecision});
 return Object.freeze({async prepare({credential,request}={}){
  try{
   // Trusted authorize maps credential to server-owned scope/role. Never inspect the body before authorization.
   const p=await authorize(credential,'RESEARCH_APPROVAL_IMPORT');
   const now=clock();
   if(p?.verified!==true||!scopeValid(p)||!Array.isArray(p.roles)||!p.roles.includes('RESEARCH_APPROVAL_IMPORT')||
    !timestamp(now)||!timestamp(p.expiresAtMs)||now>=p.expiresAtMs)return denied('UNAUTHORIZED');
   const scope=Object.freeze(Object.fromEntries(['schemaVersion','ownerRef','authorizationEpoch','policyEpoch','restoreEpoch'].map(k=>[k,p[k]])));
   const expiresAt=p.expiresAtMs;
   const parsed=parseResearchApprovalImportRequest(request,{nowMs:now});
   const plan=await planner.prepare({request:parsed.request.approval_request,package:parsed.request.package,expectedScope:scope,notBeforeMs:now});
   const end=clock();if(!timestamp(end)||end<now||plan.imported_at_ms<now||end<plan.imported_at_ms)return denied('IMPORT_CLOCK_REGRESSION');
   if(end>=expiresAt)return denied('UNAUTHORIZED');
   if(plan.request.decision==='APPROVE'&&(end>=parsed.request.package.review_at_ms||end>=parsed.request.package.expires_at_ms))return denied('RESEARCH_REVIEW_OR_EXPIRY_DUE');
   return Object.freeze({status:'STAGING_PREPARED_NOT_COMMITTED',plan,request_id:parsed.request.request_id,
    expected_revision:parsed.request.expected_revision,payload_sha256:parsed.payload_sha256,engine_approval:'NOT_GRANTED'});
  }catch(e){return denied(permitted.has(e?.code)?e.code:'RESEARCH_APPROVAL_PREFLIGHT_UNAVAILABLE');}
 }});
}
function denied(code){return Object.freeze({status:'REJECTED',code,write_outcome:'NOT_ATTEMPTED',engine_approval:'NOT_GRANTED'});}
