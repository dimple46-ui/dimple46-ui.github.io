// Local review only. Not a v1 package, receiver, approval, source attestation or consumer adapter.
import {createHash} from 'node:crypto';
import schema from '../schemas/research-general-draft.schema.json' with {type:'json'};
import {canonicalJson} from '../private/storage-contract.mjs';
import {parseResearchDecimal,compareResearchDecimals as compareExact} from './research-decimal.mjs';
const fail=code=>{throw new Error(code);};
const time=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
function shape(v,s){
 if(s.$ref)s=schema.$defs[s.$ref.slice(8)];
 if(Object.hasOwn(s,'const')&&v!==s.const||s.enum&&!s.enum.includes(v))fail('GENERAL_DRAFT_SCHEMA_REJECTED');
 const types=s.type?[s.type].flat():[];
 const matches=t=>t==='null'?v===null:t==='array'?Array.isArray(v):t==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):t==='integer'?Number.isSafeInteger(v):typeof v===t;
 if(types.length&&!types.some(matches))fail('GENERAL_DRAFT_SCHEMA_REJECTED');
 if(v===null)return;
 if(typeof v==='string'){
  const length=[...v].length;
  if(length<(s.minLength??0)||length>(s.maxLength??Infinity)||s.pattern&&!new RegExp(s.pattern).test(v))fail('GENERAL_DRAFT_SCHEMA_REJECTED');
 }
 if(typeof v==='number'&&(v<(s.minimum??-Infinity)||v>(s.maximum??Infinity)))fail('GENERAL_DRAFT_SCHEMA_REJECTED');
 if(Array.isArray(v)){
  if(v.length<(s.minItems??0)||v.length>(s.maxItems??1024)||s.uniqueItems&&new Set(v.map(x=>canonicalJson(x))).size!==v.length)fail('GENERAL_DRAFT_SCHEMA_REJECTED');
  v.forEach(x=>shape(x,s.items));
 }else if(typeof v==='object'){
  if((s.required??[]).some(k=>!Object.hasOwn(v,k))||s.additionalProperties===false&&Object.keys(v).some(k=>!Object.hasOwn(s.properties??{},k)))fail('GENERAL_DRAFT_SCHEMA_REJECTED');
  for(const k of Object.keys(v))if(s.properties?.[k])shape(v[k],s.properties[k]);
 }
}
function dateMs(s,offset='Z'){
 const at=Date.parse(s+'T00:00:00'+offset);
 // Calendar validation is independent of the chosen offset.
 if(!Number.isFinite(at)||new Date(Date.parse(s+'T00:00:00Z')).toISOString().slice(0,10)!==s)fail('INVALID_GENERAL_RESEARCH_DATE');
 return at;
}
const kstDay=ms=>Math.floor((ms+9*3600000)/86400000);
const calendarDay=date=>Math.floor(dateMs(date)/86400000);
function lifecycle(d,nowMs){
 const result={};
 for(const [name,timeKey,conditionKey]of [['review','review_at_ms','review_condition'],['expiry','expires_at_ms','expiry_condition']]){
  const at=d[timeKey],c=d[conditionKey];
  if(at!==null){
   if(!time(at)||at<=d.generated_at_ms||c!==undefined)fail('INVALID_GENERAL_LIFECYCLE');
   result[name]={status:nowMs>=at?'DUE':'NOT_DUE',basis:'DECLARED_INSTANT',at_ms:at};continue;
  }
  if(!c)fail('GENERAL_LIFECYCLE_CONDITION_REQUIRED');
  if(c.kind==='DATE_ONLY'){
   if(c.date===null||c.timezone!=='Asia/Seoul'||c.event_id!==null||c.description!==null)fail('INVALID_GENERAL_LIFECYCLE');
   dateMs(c.date,'+09:00');
   result[name]={status:kstDay(nowMs)>=calendarDay(c.date)?'DATE_REQUIRES_REVIEW':'NOT_DUE',basis:'DATE_ONLY_NO_EXACT_INSTANT',date:c.date,timezone:c.timezone,at_ms:null};
  }else if(c.kind==='EVENT'){
   if(c.date!==null||c.timezone!==null||c.event_id===null||c.description===null)fail('INVALID_GENERAL_LIFECYCLE');
   result[name]={status:'MANUAL_EVENT_REVIEW_REQUIRED',basis:'EVENT_NOT_EVALUATED',event_id:c.event_id,at_ms:null};
  }else{
   if(c.date!==null||c.timezone!==null||c.event_id!==null||c.description!==null)fail('INVALID_GENERAL_LIFECYCLE');
   result[name]={status:'UNSPECIFIED',basis:'UNKNOWN',at_ms:null};
  }
 }
 if(d.review_at_ms!==null&&d.expires_at_ms!==null&&d.expires_at_ms<d.review_at_ms)fail('INVALID_GENERAL_LIFECYCLE');
 const r=result.review,e=result.expiry;
 const rd=r.basis==='DECLARED_INSTANT'?kstDay(r.at_ms):r.date===undefined?undefined:calendarDay(r.date),
  ed=e.basis==='DECLARED_INSTANT'?kstDay(e.at_ms):e.date===undefined?undefined:calendarDay(e.date);
 if(rd!==undefined&&ed!==undefined&&ed<rd)fail('INVALID_GENERAL_LIFECYCLE');
 return {conditions:result,status:e.status==='DUE'?'EXPIRED':r.status==='DUE'?'REVIEW_DUE':
  [r,e].some(x=>x.status==='DATE_REQUIRES_REVIEW')?'DATE_REQUIRES_MANUAL_REVIEW':
  [r,e].some(x=>x.status==='MANUAL_EVENT_REVIEW_REQUIRED')?'MANUAL_EVENT_REVIEW_REQUIRED':
  [r,e].some(x=>x.status==='UNSPECIFIED')?'LIFECYCLE_UNSPECIFIED':'WITHIN_DECLARED_REVIEW_WINDOW'};
}
export function prepareGeneralResearchDraft(input,{nowMs}={}){
 if(!time(nowMs))fail('INVALID_REFERENCE_TIME');
 let text,d;
 try{text=canonicalJson(input,65536);d=JSON.parse(text);shape(d,schema);}catch{fail('GENERAL_DRAFT_SCHEMA_REJECTED');}
 if(![d.analysis_cutoff_ms,d.generated_at_ms].every(time)||d.analysis_cutoff_ms>d.generated_at_ms||d.generated_at_ms>nowMs)fail('INVALID_GENERAL_RESEARCH_TIME');
 const life=lifecycle(d,nowMs);
 if(d.original_research){
  const o=d.original_research;dateMs(o.declared_analysis_date);dateMs(o.declared_created_date);
  if(calendarDay(o.declared_analysis_date)>kstDay(d.analysis_cutoff_ms)||calendarDay(o.declared_created_date)>kstDay(d.generated_at_ms))fail('FUTURE_ORIGINAL_RESEARCH');
 }
 const sources=new Map(),quantities=new Map();let historicalKnowledge=true;
 for(const s of d.sources){
  if(sources.has(s.source_id))fail('DUPLICATE_GENERAL_SOURCE');sources.set(s.source_id,s);
  let u;try{u=new URL(s.url);}catch{fail('INVALID_GENERAL_SOURCE_URL');}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)fail('INVALID_GENERAL_SOURCE_URL');
  const published=dateMs(s.published_date);
  if(published>d.analysis_cutoff_ms)fail('FUTURE_GENERAL_SOURCE');
  const a=s.acquired;
  if(a.precision==='INSTANT'){
   if(a.date!==null||a.timezone!==null||!time(a.at_ms)||a.at_ms<published||a.at_ms>d.analysis_cutoff_ms)fail('INVALID_GENERAL_ACQUISITION');
  }else if(a.precision==='DATE_ONLY'){
   if(a.at_ms!==null||a.timezone!=='Asia/Seoul'||a.date===null)fail('INVALID_GENERAL_ACQUISITION');
   const start=dateMs(a.date,'+09:00');
   if(start>d.analysis_cutoff_ms||start+86400000<=published)fail('INVALID_GENERAL_ACQUISITION');
   historicalKnowledge=false;
  }else{
   if(a.at_ms!==null||a.date!==null||a.timezone!==null)fail('INVALID_GENERAL_ACQUISITION');
   historicalKnowledge=false;
  }
  for(const q of s.quantities){
   if(quantities.has(q.quantity_id))fail('DUPLICATE_GENERAL_QUANTITY');
   try{parseResearchDecimal(q.value);}catch{fail('INVALID_GENERAL_QUANTITY');}
   quantities.set(q.quantity_id,{quantity:q,source:s});
  }
 }
 const claims=new Map();
 for(const c of d.claims){
  if(claims.has(c.claim_id)||c.source_refs.some(r=>!sources.has(r)))fail('INVALID_GENERAL_EVIDENCE');
  claims.set(c.claim_id,c);
  if(c.quantity_ref!==null){const q=quantities.get(c.quantity_ref);
   if(!q||!c.source_refs.includes(q.source.source_id)||c.kind==='HYPOTHESIS'||q.quantity.figure_status==='PRELIMINARY_ESTIMATE'&&c.kind!=='ESTIMATE')fail('INVALID_GENERAL_QUANTITY_LINK');
  }
 }
 for(const refs of [d.thesis.supporting_claim_refs,d.thesis.contrary_claim_refs])if(refs.some(r=>!claims.has(r)))fail('INVALID_GENERAL_THESIS_LINK');
 let comparison={status:'UNAVAILABLE',reason:'NOT_PROVIDED'};
 if(d.report_comparison!==null){
  const a=quantities.get(d.report_comparison.baseline_quantity_id),b=quantities.get(d.report_comparison.current_quantity_id);
  if(!a||!b||a.source.access!=='DECLARED_ORIGINAL_READ'||b.source.access!=='DECLARED_ORIGINAL_READ'||a.source.source_id===b.source.source_id||a.source.issuer_id!==b.source.issuer_id||a.source.published_date>=b.source.published_date||a.quantity.figure_status!=='PRELIMINARY_ESTIMATE'||b.quantity.figure_status!=='COMPANY_REPORTED'||['metric','unit','currency','fiscal_period','scope'].some(k=>a.quantity[k]!==b.quantity[k]))fail('INCOMPARABLE_GENERAL_REPORTS');
  comparison={status:'LOCAL_COMPARISON_ONLY',ordering:compareExact(a.quantity.value,b.quantity.value),baseline_quantity_id:a.quantity.quantity_id,current_quantity_id:b.quantity.quantity_id};
 }
 return freeze({schema_version:2,status:'REVIEW_REQUIRED',draft:d,content_sha256:createHash('sha256').update(text).digest('hex'),
  checked_at_ms:nowMs,input_cutoff_ms:d.analysis_cutoff_ms,
  temporal_status:life.status,lifecycle:life.conditions,
  classification_pending:d.horizon==='UNSPECIFIED'||d.thesis.state==='UNCLASSIFIED',
  historical_availability:historicalKnowledge?'DECLARED_INSTANTS_NOT_INDEPENDENTLY_VERIFIED':'INSUFFICIENT_ACQUISITION_PRECISION',
  historical_replay_allowed:false,source_verification:'DECLARED_METADATA_NOT_INDEPENDENT_SOURCE_VERIFICATION',
  report_comparison:comparison,approval:'NOT_RECORDED',receipt:'NOT_RECORDED',consumer_status:'UNSUPPORTED_BY_LEGACY_CONSUMER',
  operations:'LOCAL_ONLY_NOT_DEPLOYED_NOT_WATCH_READY',private_valuation:null,trade_quantities:null});
}
