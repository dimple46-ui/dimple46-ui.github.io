// Offline private provenance. Configured source reference is NOT runtime/code attestation.
// The full policy/input linkage stays inside AEAD; no schema migration or legacy-row rewrite.
import {canonicalJson,context,fail,opaqueId,timestamp} from './storage-contract.mjs';
const sha=x=>typeof x==='string'&&/^[0-9a-f]{40}$/.test(x)&&x!=='0'.repeat(40);
const tag=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const age=x=>Number.isSafeInteger(x)&&x>=0;
const keys=(value,allowed,required=allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(value,k));
const reject=()=>fail('INVALID_ANALYSIS_PROVENANCE');
export function privateReleaseIdentity(value){
 if(!keys(value,['engineGitSha','workflowVersion'])||!sha(value.engineGitSha)||value.workflowVersion!==1)
  throw new TypeError('PRIVATE_RELEASE_IDENTITY_REQUIRED');
 return Object.freeze({engineGitSha:value.engineGitSha,workflowVersion:1});
}
export function privatePolicySnapshot(value,nowMs){
 const p=JSON.parse(canonicalJson(value,16384)),a=p.analysisPolicy,e=p.eventPolicy;
 if(!keys(p,['analysisPolicy','eventPolicy'])||!keys(a,['nowMs','maxLedgerAgeMs','maxPriceAgeMs','horizonAtMs','reserveKrw',
  'concentrationDenominator','maxCollateralInputAgeMs','maxCollateralQuoteAgeMs'],['nowMs','maxLedgerAgeMs','maxPriceAgeMs','horizonAtMs'])||
  !keys(e,['nowMs','maxCaptureAgeMs','maxInputAgeMs'])||!timestamp(nowMs)||a.nowMs!==nowMs||e.nowMs!==nowMs||
  !timestamp(a.horizonAtMs)||!age(a.maxLedgerAgeMs)||!age(a.maxPriceAgeMs)||!age(e.maxCaptureAgeMs)||!age(e.maxInputAgeMs)||
  ['reserveKrw','maxCollateralInputAgeMs','maxCollateralQuoteAgeMs'].some(k=>Object.hasOwn(a,k)&&!age(a[k]))||
  Object.hasOwn(a,'concentrationDenominator')&&!['DECLARED_SECURITIES_VALUE','DECLARED_GROSS_ASSETS'].includes(a.concentrationDenominator))
  fail('INVALID_SERVER_POLICY');
 Object.freeze(a);Object.freeze(e);return Object.freeze(p);
}
export async function privatePolicyTag(crypto,scope,policySnapshot){
 // Stable HMAC key + separate purpose/context; snapshot includes invocation time, NOT a config-change detector.
 const result=await crypto.tag(canonicalJson({purpose:'PRIVATE_POLICY_SNAPSHOT_V1',policySnapshot},16384),
  context(scope,'REQUEST_TAG','policy:'+scope.policyEpoch));
 if(!tag(result))reject();return result;
}
export function privateProvenanceView(p,head){
 if(!sha(p?.engineGitSha)||p.workflowVersion!==1||p.inputSchemaVersion!==1||p.analysisEnvelopeVersion!==2||
  !Number.isSafeInteger(p.analysisRevision)||p.analysisRevision<1||p.analysisRevision!==head.revision||
  p.previousRevision!==p.analysisRevision-1||!opaqueId(p.policyVersion)||!tag(p.policyTag))reject();
 return {analysisEnvelopeVersion:2,engineGitSha:p.engineGitSha,workflowVersion:1,inputSchemaVersion:1,
  analysisRevision:p.analysisRevision,previousRevision:p.previousRevision,policyVersion:p.policyVersion,policyTag:p.policyTag,
  releaseEvidence:'CONFIGURED_REFERENCE_NOT_ATTESTATION'};
}
export async function openPrivateAnalysis(crypto,envelope,head,scope){
 if(!keys(envelope,['analysisEnvelopeVersion','provenance','policySnapshot','workflow'])||envelope.analysisEnvelopeVersion!==2)reject();
 const p=envelope.provenance;
 if(!keys(p,['analysisEnvelopeVersion','engineGitSha','workflowVersion','inputSchemaVersion','analysisRevision','previousRevision',
  'generatedAtMs','inputCutoffMs','policyVersion','restoreEpoch','requestId','inputTag','policyTag'])||
  p.policyVersion!==scope.policyEpoch||p.restoreEpoch!==scope.restoreEpoch||!opaqueId(p.requestId)||!tag(p.inputTag)||
  p.generatedAtMs!==head.generatedAtMs||p.inputCutoffMs!==head.inputCutoffMs)reject();
 const provenance=privateProvenanceView(p,head),policySnapshot=privatePolicySnapshot(envelope.policySnapshot,head.generatedAtMs);
 if(await privatePolicyTag(crypto,scope,policySnapshot)!==p.policyTag)reject();
 return {workflow:envelope.workflow,provenance};
}
