import {bucketFlowKinematics} from './bucket-flow-kinematics.mjs';

export const STOCK_FLOW_SIGNAL_VERSION = 3;
const STOCKS={samsung:'005930',skHynix:'000660'};
const FLOWS={foreignFlow:'FOREIGN',institutionFlow:'INSTITUTION'};
function requireInput(condition, code) {if(!condition) throw new Error(code);}
function signalType(prefix, previousRate, currentRate, acceleration) {
  if(previousRate*currentRate<0) return `${prefix}_FLOW_REVERSAL`;
  if(currentRate>0 && acceleration>0) return `${prefix}_BUYING_ACCELERATING`;
  if(currentRate>0 && acceleration<0) return `${prefix}_BUYING_DECELERATING`;
  if(currentRate<0 && acceleration<0) return `${prefix}_SELLING_ACCELERATING`;
  if(currentRate<0 && acceleration>0) return `${prefix}_SELLING_DECELERATING`;
  return null;
}

// Explicit query-time opt-in; never called by the v2 engine or a Worker handler.
export function generateStockFlowSignalsV3(samplesByStock, {enabled=false,featureVersion,
  inputCutoffMs,generatedAtMs,engineGitSha}={}) {
  requireInput(typeof enabled==='boolean','INVALID_SIGNAL_V3_OPT_IN');
  if(!enabled) return {signalVersion:3,status:'DISABLED',signals:[],diagnostics:[]};
  requireInput(featureVersion===2,'FEATURE_VERSION_MISMATCH');
  requireInput(/^[0-9a-f]{7,64}$/i.test(String(engineGitSha??'')),'INVALID_SIGNAL_ENGINE_GIT_SHA');
  requireInput(Number.isSafeInteger(inputCutoffMs) && inputCutoffMs>0 &&
    Number.isFinite(new Date(inputCutoffMs).getTime()) && Number.isSafeInteger(generatedAtMs) &&
    Number.isFinite(new Date(generatedAtMs).getTime()) && generatedAtMs>=inputCutoffMs,'INVALID_SIGNAL_TIME');
  const signals=[],diagnostics=[];
  const cutoff=new Date(inputCutoffMs).toISOString(),generatedAt=new Date(generatedAtMs).toISOString();
  for(const [stock,ticker] of Object.entries(STOCKS)) for(const [flow,prefix] of Object.entries(FLOWS)) {
    const samples=samplesByStock?.[stock]?.[flow];
    const diagnostic=reason=>diagnostics.push({ticker,flow,status:'SUPPRESSED',reason});
    if(!Array.isArray(samples) || samples.length!==3) {diagnostic('INSUFFICIENT_TIME_BASIS');continue;}
    let kinematics;
    try {kinematics=bucketFlowKinematics(samples,{inputCutoffMs});}
    catch(error) {
      const code=/^[A-Z_]+$/.test(error?.message??'')?error.message:'INVALID_BUCKET_INPUT';
      diagnostic(code);continue;
    }
    if(kinematics.status!=='VALID') {diagnostic(kinematics.status);continue;}
    const [previousRate,currentRate]=kinematics.averageFlowSharesPerMinute;
    const type=signalType(prefix,previousRate,currentRate,kinematics.accelerationSharesPerMinuteSquared);
    if(!type) {diagnostic('NO_RATE_CHANGE_SIGNAL');continue;}
    const quality=kinematics.qualityInputs.includes('UNVERIFIED_TIME')?'UNVERIFIED_TIME':
      kinematics.qualityInputs.includes('RECENT_FETCH')?'RECENT_FETCH':'VERIFIED';
    const ratio=Math.abs(kinematics.rateChangeSharesPerMinute)/Math.max(Math.abs(currentRate),1);
    signals.push({signal_id:`s3:${cutoff}:${ticker}:BUCKET:${type}`,generated_at:generatedAt,input_cutoff:cutoff,
      ticker,horizon:'BUCKET',signal_type:type,state:'ACTIVE',
      strength:ratio>=1?'STRONG':ratio>=0.25?'MODERATE':'WEAK',
      confidence:{level:'MEDIUM',ceiling:quality==='VERIFIED'?'HIGH':'MEDIUM',
        meaning:'DESCRIPTIVE_EVIDENCE_CONFIDENCE_NOT_PREDICTIVE_PROBABILITY'},
      supporting_evidence:[
        {metric:`${stock}.${flow}.previousAverageFlow`,value:previousRate,unit:'shares/minute'},
        {metric:`${stock}.${flow}.currentAverageFlow`,value:currentRate,unit:'shares/minute'},
        {metric:`${stock}.${flow}.acceleration`,value:kinematics.accelerationSharesPerMinuteSquared,unit:'shares/minute_squared'},
        {metric:`${stock}.${flow}.legacyDeltaDifference`,value:kinematics.deltaDifferenceShares,unit:'shares'}],
      contrary_evidence:[],
      invalidation:['NEXT_SOURCE_BUCKET_CHANGES_RATE_STATE','INPUT_QUALITY_BECOMES_UNUSABLE'],
      data_quality:{ceiling:quality,feature_quality_inputs:[...kinematics.qualityInputs],
        limitations:['ESTIMATED_BUCKET_AVERAGES_NOT_CONTINUOUS_FLOW','CROSS_FLOW_CORROBORATION_NOT_EVALUATED']},
      feature_version:featureVersion,signal_version:3,engine_git_sha:engineGitSha,
      kinematics_version:kinematics.version,time_basis:kinematics.timeBasis,
      source_bucket_times_ms:[...kinematics.sourceBucketTimesMs],
      interval_minutes:[...kinematics.intervalMinutes],midpoint_distance_minutes:kinematics.midpointDistanceMinutes});
  }
  return {signalVersion:3,status:'CANDIDATE',signals,diagnostics};
}
