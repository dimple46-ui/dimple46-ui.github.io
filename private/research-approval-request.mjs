// Pure offline input boundary. Authentication must happen before this parser in any future transport.
// No trusted identity/proof/store is accepted from the request, and a payload digest is not authority.
import {canonicalJson,opaqueId,timestamp} from './storage-contract.mjs';
import {researchHash,validateResearchPackage} from '../domain/research-handoff.mjs';
const fail=()=>{const error=new Error('INVALID_RESEARCH_APPROVAL_REQUEST');error.code=error.message;throw error;};
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const closed=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join()===keys.split(' ').sort().join();
export function parseResearchApprovalImportRequest(value,{nowMs}={}){
 try{
  if(!timestamp(nowMs))fail();
  const canonical=canonicalJson(value),r=JSON.parse(canonical);
  if(!closed(r,'schema_version request_id expected_revision approval_request package')||r.schema_version!==1||!opaqueId(r.request_id)||
   !Number.isSafeInteger(r.expected_revision)||r.expected_revision<0||r.expected_revision>=Number.MAX_SAFE_INTEGER)fail();
  const a=r.approval_request;
  if(!closed(a,'schema_version receipt_ref package_id revision content_sha256 decision')||a.schema_version!==1||
   !opaqueId(a.receipt_ref)||!opaqueId(a.package_id)||!Number.isSafeInteger(a.revision)||a.revision<1||
   typeof a.content_sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.content_sha256)||!['APPROVE','WITHDRAW'].includes(a.decision))fail();
  const p=validateResearchPackage(r.package,{nowMs}).package;
  if(!['package_id','revision','content_sha256'].every(k=>a[k]===p[k]))fail();
  return freeze({request:r,canonical,payload_sha256:researchHash(r),trust:'UNAUTHENTICATED_INPUT_ONLY',engine_approval:'NOT_GRANTED'});
 }catch{fail();}
}
