// Local preparation only: no receipt intake, approval, storage, network or execution.
import {sealResearchPackage,validateResearchPackage} from './research-handoff.mjs';
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
export function prepareResearchDraft(draft,{nowMs}={}){
 // A supplied digest must validate unchanged; never repair a conflicting sealed package.
 const supplied=!!draft&&Object.hasOwn(draft,'content_sha256');
 const v=validateResearchPackage(supplied?draft:sealResearchPackage(draft),{nowMs}),p=v.package;
 return freeze({status:'REVIEW_REQUIRED',sealedPackage:p,review:{
  identity:{package_id:p.package_id,revision:p.revision,content_sha256:v.contentSha256},
  integrity:supplied?'EXISTING_HASH_VERIFIED':'MISSING_HASH_COMPUTED',
  reference_time_ms:nowMs,input_cutoff_ms:p.analysis_cutoff_ms,
  temporal_status:nowMs>=p.expires_at_ms?'EXPIRED':nowMs>=p.review_at_ms?'REVIEW_DUE':'WITHIN_DECLARED_REVIEW_WINDOW',
  evidence_verification:v.evidenceVerification,privacy_verification:v.privacyVerification,
  source_ids:p.sources.map(s=>s.documentId),
  claims:p.claims.map(c=>({claim_id:c.claim_id,kind:c.kind,source_refs:c.source_refs,quantity:c.quantity})),
  manual_checks:['ORIGINAL_SOURCE_AND_ACCESS','FREE_TEXT_PRIVACY_AND_RIGHTS','MATERIAL_CONTRARY_EVIDENCE','THESIS_AND_VALUATION_ASSUMPTIONS'],
  approval:'NOT_RECORDED',received:'NOT_RECORDED',operational:'NOT_DEPLOYED_NOT_WATCH_READY'
 }});
}
