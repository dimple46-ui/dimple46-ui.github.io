// Local research/market composition only. No private ledger evaluator, scheduling, notification or action execution.
import {selectConsumerData} from '../cloudflare/consumer-fallback.mjs';
import {buildPublicConsumerSummary} from '../cloudflare/public-consumer-summary.mjs';
import {generateDescriptiveSignals,SIGNAL_VERSION} from '../cloudflare/signal-engine.mjs';
import {researchHash} from './research-handoff.mjs';
const levels=['NONE','LOW','MEDIUM','HIGH'];
const qualities=['VERIFIED','RECENT_FETCH','UNVERIFIED_TIME','UNKNOWN','STALE_INPUT','MISSING_INPUT','UNUSABLE_INPUT'];
const adverse=new Set(['FOREIGN_SELLING_ACCELERATING','INSTITUTION_SELLING_ACCELERATING','PROGRAM_SELLING_ACCELERATING','FUTURES_RISK_OFF','RELATIVE_STRENGTH_WEAKENING']);
const supportive=new Set(['FOREIGN_BUYING_ACCELERATING','INSTITUTION_BUYING_ACCELERATING','PROGRAM_BUYING_ACCELERATING','FUTURES_RISK_ON','RELATIVE_STRENGTH_IMPROVING']);
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
export function verifyResearchMonitoringSummary(record){
 try{const {decision_id,...body}=record;return decision_id==='local-research:'+researchHash(body);}catch{return false;}
}
export function buildResearchMonitoringSummary({session,packageId,marketInputs,featureReplay,privateRiskContext=null,previousEventChanges={}},policy){
 if(typeof session?.select!=='function'||!Number.isSafeInteger(policy?.maxFeatureObservationSkewMs)||policy.maxFeatureObservationSkewMs<0||
  !/^[0-9a-f]{40}$/.test(policy.signalEngineGitSha??''))throw Error('INVALID_RESEARCH_SUMMARY_POLICY');
 const now=policy.nowMs,market=buildPublicConsumerSummary(marketInputs,policy),selected=selectConsumerData(marketInputs,policy);
 const research=session.select({package_id:packageId,asOfMs:now}),p=research.research?.package;
 let shortTerm={status:'UNAVAILABLE',state:null,reason:'NO_CURRENT_FEATURE_REPLAY',horizon:null,signals:[]};
 if(selected.features.status==='AVAILABLE'&&selected.observation.status==='AVAILABLE'&&p&&featureReplay){
  const f=selected.features,observation=selected.observation;
  if(Math.abs(observation.observedAtMs-f.inputCutoffMs)>policy.maxFeatureObservationSkewMs||f.inputCutoffMs>observation.inputCutoffMs)
   shortTerm.reason='FEATURE_OBSERVATION_TIME_MISMATCH';
  else if(featureReplay.version!==2||Date.parse(featureReplay.inputCutoff)!==f.inputCutoffMs)shortTerm.reason='FEATURE_REPLAY_VERSION_OR_CUTOFF_MISMATCH';
  else try{
   const ceiling=f.quality==='VERIFIED'?'HIGH':'MEDIUM';
   const signals=generateDescriptiveSignals(featureReplay,{generatedAt:new Date(now).toISOString(),engineGitSha:policy.signalEngineGitSha})
    // Retain market-wide futures context without relabelling it as an individual stock signal.
    .filter(s=>s.ticker===p.target.ticker||s.ticker==='MARKET'||s.ticker==='KOSPI200_FUTURES'||s.ticker==='005930/000660').map(s=>({signal_id:s.signal_id,signal_type:s.signal_type,ticker:s.ticker,horizon:s.horizon,
     feature_version:s.feature_version,signal_version:s.signal_version,
     source_metric_quality_ceiling:s.data_quality.ceiling,feature_quality_ceiling:f.quality,
     quality_ceiling:qualities[Math.max(qualities.indexOf(s.data_quality.ceiling),qualities.indexOf(f.quality))],
     confidence:levels[Math.min(levels.indexOf(s.confidence.level),levels.indexOf(ceiling))],
     confidence_meaning:'DESCRIPTIVE_NOT_PREDICTIVE_PROBABILITY'}));
   // Pair relative strength is retained as pair evidence, never assigned the same direction to both stocks.
   const directional=signals.filter(s=>s.ticker!=='005930/000660');
   const neg=directional.some(s=>adverse.has(s.signal_type)),pos=directional.some(s=>supportive.has(s.signal_type));
   shortTerm={status:'LOCAL_REPLAY_ONLY',state:neg&&pos?'MIXED_DESCRIPTIVE_SIGNALS':neg?'ADVERSE_DESCRIPTIVE_SIGNALS':pos?'SUPPORTIVE_DESCRIPTIVE_SIGNALS':'NO_ACTIVE_DESCRIPTIVE_SIGNALS',
    reason:null,horizon:'BUCKET_AND_5_10_30M_AS_PRESENT',signals};
  }catch{shortTerm.reason='FEATURE_REPLAY_REJECTED';}
 }
 const versions={market:{observation_cutoff_ms:market.observation.inputCutoffMs,feature_cutoff_ms:market.features.inputCutoffMs,
  feature_version:market.features.featureVersion,signal_version:shortTerm.status==='LOCAL_REPLAY_ONLY'?SIGNAL_VERSION:null,
  signal_engine_reference_sha:shortTerm.status==='LOCAL_REPLAY_ONLY'?policy.signalEngineGitSha:null},
  research:p?{package_id:p.package_id,revision:p.revision,content_sha256:p.content_sha256,approval_decision_id:research.approval.decision_id,
   report_judgment_sha256:research.research.reportJudgment.contentSha256}:null,
  private_ledger:null};
 const longTerm=p?{status:'APPROVED_FOR_LOCAL_COMPOSITION',state:p.thesis.state,horizon:p.horizon,
  supporting_claim_refs:p.thesis.supporting_claim_refs,contrary_claim_refs:p.thesis.contrary_claim_refs,invalidation:p.thesis.invalidation}:null;
 const events=(p?.monitoring??[]).map(rule=>{
  const event_id='research:'+p.package_id+':'+p.target.ticker+':'+rule.rule_id;
  const changeHash=researchHash({package_sha:p.content_sha256,rule_id:rule.rule_id,status:rule.status,long_term:longTerm.state,short_term:shortTerm.state,
   feature_quality:market.features.quality,pipeline_status:market.observation.pipelineStatus,source_quality:market.sourceQuality.reasonCodes,
   signal_quality:shortTerm.signals.map(s=>({type:s.signal_type,ticker:s.ticker,quality:s.quality_ceiling,confidence:s.confidence}))});
  return {event_id,severity:rule.severity,state:'MANUAL_REVIEW_REQUIRED',change_hash:changeHash,
   change:previousEventChanges[event_id]===changeHash?'UNCHANGED':'NEW_OR_CHANGED',notification_status:'NOT_SENT',automatic_notification:false};
 });
 const cutoffs=[market.observation.inputCutoffMs,p?.analysis_cutoff_ms,shortTerm.status==='LOCAL_REPLAY_ONLY'?market.features.inputCutoffMs:null].filter(Number.isSafeInteger);
 const body={contract_version:1,status:'LOCAL_COMPOSITION_ONLY',generated_at_ms:now,input_cutoff_ms:cutoffs.length?Math.min(...cutoffs):null,
  knowledge_as_of_ms:now,input_versions:versions,market,research_status:research.status,research_unavailable_reason:research.reason??null,
  changed_facts:p?research.research.reportJudgment.changes:[],long_term:longTerm,short_term:shortTerm,
  cross_horizon_state:longTerm?.state==='SUPPORTIVE'&&shortTerm.state==='ADVERSE_DESCRIPTIVE_SIGNALS'?'LONG_TERM_SUPPORT_WITH_SHORT_TERM_ADVERSE':
   !longTerm||shortTerm.status==='UNAVAILABLE'?'INCOMPLETE_CONTEXT':'SEPARATE_HORIZONS_NO_COMPOSITE_SCORE',
  private_risk:{status:'UNAVAILABLE',reason:privateRiskContext===null?'NO_PRIVATE_LEDGER':'PRIVATE_CONTEXT_ADAPTER_NOT_IMPLEMENTED',
   confirmed_private_risks:[],valuation:null,trade_quantities:null,collateral_clearance:null},
  alternatives:p?p.alternatives.map(a=>({type:a.type,status:'REVIEW_ONLY_PRIVATE_DATA_REQUIRED',claim_refs:a.claim_refs,execution_allowed:false})):[],
  unavailable:['PERSONAL_SUITABILITY','TRADE_SIZING','CANDIDATE_RANKING','PROBABILITY','TAX_LEGAL_DETERMINATION','BROKER_CASH_CLEARANCE','LIVE_SIGNAL_DEPLOYMENT_VALIDATION'],
  monitoring:{events,scheduler_access:'NOT_CONNECTED_OR_VALIDATED',delivery:'NOT_SENT',rules_executed:false},
  research_approval_scope:'RESEARCH_VERSION_ONLY_NOT_PRODUCTION_TRADE_OR_LIMIT_AUTHORIZATION',
  content_handling:'RESEARCH_IS_UNTRUSTED_DATA_NO_INSTRUCTIONS_URL_CODE_OR_RULE_EXECUTION',
  operational_status:'NOT_DEPLOYED_NOT_WATCH_READY',actual_user_action:'NOT_RECORDED'};
 return freeze({decision_id:'local-research:'+researchHash(body),...body});
}
