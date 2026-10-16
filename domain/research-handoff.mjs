// LOCAL ONLY. No network, credentials, project scraping, persistent store, scheduler, rule execution or orders.
import {createHash} from 'node:crypto';
import schema from '../schemas/research-package.schema.json' with {type:'json'};
import {canonicalJson} from '../private/storage-contract.mjs';
import {createReportJudgment} from './report-judgment.mjs';
class ResearchHandoffError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new ResearchHandoffError(code);};
const time=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(s);
export const researchHash=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
// Validates exactly the JSON Schema subset used by the bundled closed contract, with no external $ref loading.
function shape(value,s){
 if(s.$ref){if(!s.$ref.startsWith('#/$defs/'))fail('SCHEMA_REJECTED');s=schema.$defs[s.$ref.slice(8)];}
 if(!s)fail('SCHEMA_REJECTED');
 if(Object.hasOwn(s,'const')&&value!==s.const||s.enum&&!s.enum.includes(value))fail('SCHEMA_REJECTED');
 const types=s.type?[s.type].flat():[];
 const matches=t=>t==='null'?value===null:t==='array'?Array.isArray(value):t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):
  t==='integer'?Number.isSafeInteger(value):typeof value===t;
 if(types.length&&!types.some(matches))fail('SCHEMA_REJECTED');if(value===null)return;
 if(typeof value==='string'&&(s.minLength!==undefined&&[...value].length<s.minLength||s.maxLength!==undefined&&[...value].length>s.maxLength||s.pattern&&!new RegExp(s.pattern).test(value)))fail('SCHEMA_REJECTED');
 if(typeof value==='number'&&(!Number.isFinite(value)||s.minimum!==undefined&&value<s.minimum||s.maximum!==undefined&&value>s.maximum))fail('SCHEMA_REJECTED');
 if(Array.isArray(value)){
  if(value.length<(s.minItems??0)||value.length>(s.maxItems??1024)||s.uniqueItems&&new Set(value.map(v=>canonicalJson(v))).size!==value.length)fail('SCHEMA_REJECTED');
  for(const item of value)shape(item,s.items);return;
 }
 if(typeof value==='object'){
  const keys=Object.keys(value);if(keys.length<(s.minProperties??0)||(s.required??[]).some(k=>!Object.hasOwn(value,k))||
   s.additionalProperties===false&&keys.some(k=>!Object.hasOwn(s.properties??{},k)))fail('SCHEMA_REJECTED');
  for(const k of keys)if(s.properties?.[k])shape(value[k],s.properties[k]);
 }
}
export function sealResearchPackage(body){
 const copy=JSON.parse(canonicalJson(body));if(Object.hasOwn(copy,'content_sha256'))fail('HASH_ALREADY_PRESENT');
 return freeze({...copy,content_sha256:researchHash(copy)});
}
export function validateResearchPackage(value,{nowMs}={}){
 if(!time(nowMs))fail('INVALID_REFERENCE_TIME');
 let p;try{p=JSON.parse(canonicalJson(value));shape(p,schema);}catch{fail('SCHEMA_REJECTED');}
 const {content_sha256,...body}=p;if(researchHash(body)!==content_sha256)fail('CONTENT_HASH_MISMATCH');
 if(![p.analysis_cutoff_ms,p.first_acquired_at_ms,p.generated_at_ms,p.review_at_ms,p.expires_at_ms].every(time)||
  p.first_acquired_at_ms>p.analysis_cutoff_ms||p.analysis_cutoff_ms>p.generated_at_ms||p.generated_at_ms>nowMs||
  p.review_at_ms<=p.generated_at_ms||p.review_at_ms>p.expires_at_ms)fail('INVALID_RESEARCH_TIME');
 const sources=new Map(),claims=new Map();
 for(const d of p.sources){
  if(sources.has(d.documentId)||d.ticker!==p.target.ticker||d.firstSeenAtMs>p.analysis_cutoff_ms||d.firstSeenAtMs<p.first_acquired_at_ms||!time(d.firstSeenAtMs))fail('INVALID_SOURCE_LINK_OR_TIME');
  let url;try{url=new URL(d.url);}catch{fail('INVALID_SOURCE_URL');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)fail('INVALID_SOURCE_URL');
  sources.set(d.documentId,d);
 }
 if(Math.min(...p.sources.map(s=>s.firstSeenAtMs))!==p.first_acquired_at_ms)fail('FIRST_ACQUIRED_TIME_MISMATCH');
 const baseline=sources.get(p.report_comparison.baseline_document_id),current=sources.get(p.report_comparison.current_document_id);
 // Existing same-period, same-unit, original-read, known-before-cutoff report correctness contract is reused.
 let report;try{report=createReportJudgment({judgmentId:p.package_id+':r'+p.revision,generatedAtMs:p.generated_at_ms,inputCutoffMs:p.analysis_cutoff_ms,
  baseline,current,thesis:{interpretation:p.thesis.state,contraryEvidence:'PACKAGE_CLAIM_REFERENCES',invalidation:'PACKAGE_INVALIDATION_REFERENCES'}});}catch{fail('INCOMPARABLE_OR_UNREAD_REPORTS');}
 for(const d of p.sources){const published=Date.parse(d.publishedDate+'T00:00:00Z');
  if(!Number.isFinite(published)||new Date(published).toISOString().slice(0,10)!==d.publishedDate||published>d.firstSeenAtMs)fail('INVALID_SOURCE_DATE');}
 for(const c of p.claims){
  if(claims.has(c.claim_id)||c.source_refs.some(ref=>!sources.has(ref)))fail('MISSING_OR_DUPLICATE_CLAIM_EVIDENCE');
  if(c.kind==='HYPOTHESIS'){if(c.quantity!==null)fail('HYPOTHESIS_IS_NOT_VERIFIED_NUMERIC_FACT');}
  else {
   if(!c.quantity)fail('NUMERIC_CLAIM_BASIS_REQUIRED');
   for(const ref of c.source_refs){const d=sources.get(ref),q=c.quantity;
    if(!['unit','currency','fiscalPeriod','scope'].every(k=>d[k]===q[k])||d.metrics[q.metric]!==q.value||
     d.figureStatus!==(c.kind==='FACT'?'COMPANY_REPORTED':'PRELIMINARY_ESTIMATE'))fail('CLAIM_VALUE_UNIT_PERIOD_OR_FACT_STATUS_MISMATCH');
   }
  }claims.set(c.claim_id,c);
 }
 const linked=refs=>refs.every(r=>claims.has(r));
 const t=p.thesis,all=[t.assumptions,t.supporting_claim_refs,t.contrary_claim_refs,
  ...['catalysts','invalidation','scenario_assumptions','valuation_assumptions'].flatMap(k=>t[k].map(n=>n.claim_refs)),
  ...p.alternatives.map(a=>a.claim_refs),...p.monitoring.map(m=>m.claim_refs)];
 if(all.some(refs=>!linked(refs))||t.supporting_claim_refs.some(r=>t.contrary_claim_refs.includes(r)))fail('THESIS_OR_ALTERNATIVE_EVIDENCE_REQUIRED');
 if(new Set(p.alternatives.map(a=>a.type)).size!==p.alternatives.length||new Set(p.monitoring.map(m=>m.rule_id)).size!==p.monitoring.length)fail('DUPLICATE_ALTERNATIVE_OR_RULE');
 const requirements={revenue:['KRW_BILLION','QUARTER'],operatingProfit:['KRW_BILLION','QUARTER'],price:['KRW',null],foreignFlow:['SHARES','BUCKET'],
  'program.totalNet':['KRW',null],'futures.openInterest':['CONTRACTS',null],'futures.basis':['POINTS',null]};
 for(const m of p.monitoring){const req=requirements[m.data_requirement.metric];
  if(m.data_requirement.unit!==req[0]||req[1]&&m.data_requirement.horizon!==req[1]||!req[1]&&!['5m','10m','30m'].includes(m.data_requirement.horizon))fail('MONITOR_UNIT_OR_HORIZON_MISMATCH');}
 return freeze({status:'REVIEW_REQUIRED',package:p,reportJudgment:report,contentSha256:content_sha256,
  evidenceVerification:'DECLARED_ORIGINAL_READ_AND_NUMERIC_CONSISTENCY_NOT_INDEPENDENT_TRUTH',privacyVerification:'CLOSED_FIELDS_NOT_FREE_TEXT_PII_CERTIFICATION'});
}
export function createResearchHandoffSession({clock,verifyUserDecision}={}){
 if(typeof clock!=='function'||typeof verifyUserDecision!=='function')throw new TypeError('TRUSTED_RESEARCH_DEPENDENCIES_REQUIRED');
 const records=[],decisions=[];let deciding=false;
 const now=()=>{const n=clock();if(!time(n))fail('INVALID_REFERENCE_TIME');return n;};
 const receipt=r=>({package_id:r.value.package.package_id,revision:r.value.package.revision,content_sha256:r.value.contentSha256,received_at_ms:r.receivedAtMs,status:'REVIEW_REQUIRED'});
 function receive(value){
  const at=now(),v=validateResearchPackage(value,{nowMs:at}),p=v.package;
  const same=records.find(r=>r.value.package.package_id===p.package_id&&r.value.package.revision===p.revision);
  if(same){if(same.value.contentSha256!==v.contentSha256)fail('PACKAGE_VERSION_CONFLICT');return freeze({...receipt(same),status:'DUPLICATE'});}
  if(records.length>=64)fail('LOCAL_SESSION_CAPACITY');
  const versions=records.filter(r=>r.value.package.package_id===p.package_id),latest=versions.at(-1)?.value.package;
  if(latest?(p.revision!==latest.revision+1||p.supersedes?.revision!==latest.revision||p.supersedes.content_sha256!==latest.content_sha256||p.generated_at_ms<latest.generated_at_ms):
   (p.revision!==1||p.supersedes!==null))fail('INVALID_SUPERSESSION_CHAIN');
  if(records.at(-1)?.receivedAtMs>at||decisions.at(-1)?.recordedAtMs>at)fail('SESSION_TIME_REGRESSION');
  const r=freeze({value:v,receivedAtMs:at});records.push(r);return freeze(receipt(r));
 }
 async function decide(request){
  if(deciding)fail('DECISION_IN_PROGRESS');deciding=true;
  try{
   const at=now(),r=JSON.parse(canonicalJson(request));
   if(Object.keys(r).sort().join()!=='content_sha256,decision,decision_id,package_id,revision'||!id(r.decision_id)||!['APPROVE','WITHDRAW'].includes(r.decision))fail('INVALID_DECISION_REQUEST');
   const record=records.find(x=>x.value.package.package_id===r.package_id&&x.value.package.revision===r.revision&&x.value.contentSha256===r.content_sha256);
   if(!record)fail('UNKNOWN_EXACT_PACKAGE_VERSION');
   const prior=decisions.find(d=>d.decision_id===r.decision_id);if(prior){if(prior.bindingHash!==researchHash(r))fail('DECISION_ID_CONFLICT');return freeze({...r,status:'DUPLICATE_DECISION'});}
   if(decisions.length>=128)fail('LOCAL_SESSION_CAPACITY');
   if(decisions.some(d=>d.package_id===r.package_id&&d.revision===r.revision&&d.decision==='WITHDRAW'))fail('WITHDRAWAL_REQUIRES_NEW_REVISION');
   const binding=freeze({...r});const proof=await verifyUserDecision(binding);
   const recordedAt=now();if(recordedAt<at||recordedAt<record.receivedAtMs||decisions.at(-1)?.recordedAtMs>recordedAt)fail('SESSION_TIME_REGRESSION');
   if(proof?.verified!==true||proof.role!=='USER_APPROVER'||!id(proof.receiptId)||proof.bindingHash!==researchHash(binding)||
    !time(proof.decidedAtMs)||proof.decidedAtMs<record.receivedAtMs||proof.decidedAtMs>recordedAt)fail('USER_APPROVAL_NOT_VERIFIED');
   if(decisions.some(d=>d.receiptId===proof.receiptId))fail('APPROVAL_RECEIPT_REUSED');
   decisions.push(freeze({...r,bindingHash:researchHash(binding),recordedAtMs:recordedAt,decidedAtMs:proof.decidedAtMs,receiptId:proof.receiptId}));
   return freeze({...r,status:r.decision==='APPROVE'?'USER_APPROVAL_RECORDED':'WITHDRAWAL_RECORDED',recorded_at_ms:recordedAt});
  }catch(error){if(error instanceof ResearchHandoffError)throw error;fail('USER_APPROVAL_DEPENDENCY_FAILED');}finally{deciding=false;}
 }
 function select({package_id,asOfMs}={}){
  if(!id(package_id)||!time(asOfMs)||asOfMs>now())fail('INVALID_AS_OF');
  const r=records.filter(r=>r.value.package.package_id===package_id&&r.receivedAtMs<=asOfMs).at(-1);
  if(!r)return freeze({status:'UNAVAILABLE',reason:'NO_KNOWN_PACKAGE',research:null});const p=r.value.package;
  const d=decisions.filter(d=>d.package_id===package_id&&d.revision===p.revision&&d.recordedAtMs<=asOfMs).at(-1);
  const reason=p.expires_at_ms<=asOfMs?'EXPIRED':p.review_at_ms<=asOfMs?'REVIEW_DUE':!d?'USER_APPROVAL_REQUIRED':d.decision==='WITHDRAW'?'WITHDRAWN':null;
  if(reason)return freeze({status:'UNAVAILABLE',reason,research:null});
  return freeze({status:'AVAILABLE',research:r.value,approval:{decision_id:d.decision_id,receipt_id:d.receiptId,recorded_at_ms:d.recordedAtMs},
   received_at_ms:r.receivedAtMs,scope:'LOCAL_SESSION_APPROVAL_NOT_DEPLOYMENT_OR_TRADE_AUTHORIZATION'});
 }
 return Object.freeze({receive,decide,select,audit:()=>freeze({receipts:records.map(receipt),decisions:decisions.map(d=>({...d})),
  persistence:'EPHEMERAL_LOCAL_SESSION_ONLY',notification:'NOT_SENT'})});
}
