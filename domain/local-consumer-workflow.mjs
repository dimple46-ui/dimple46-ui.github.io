import {selectConsumerData} from '../cloudflare/consumer-fallback.mjs';
import {compareAlternatives} from './alternative-comparison.mjs';
const finiteAge=n=>Number.isSafeInteger(n)&&n>=0?n:null;
const safeTime=n=>Number.isSafeInteger(n)&&n>0?n:null;
const quality=q=>['VERIFIED','RECENT_FETCH','UNVERIFIED_TIME','STALE_INPUT','MISSING_INPUT'].includes(q)?q:'UNKNOWN';

// Whitelisted metadata only. Never spread input, raw quality, errors, descriptions or private results.
export function buildPublicConsumerSummary(marketInputs,policy){
 const selected=selectConsumerData(marketInputs,policy);
 const observation=selected.observation,features=selected.features;
 return {schemaVersion:1,generatedAtMs:policy.nowMs,status:selected.status,
  observation:{status:observation?.status==='AVAILABLE'?'AVAILABLE':'UNAVAILABLE',
   source:['CANDIDATE','GITHUB_FALLBACK'].includes(observation?.source)?observation.source:null,
   observedAtMs:safeTime(observation?.observedAtMs),inputCutoffMs:safeTime(observation?.inputCutoffMs),
   ageMs:finiteAge(observation?.ageMs),
   pipelineStatus:['OK','DEGRADED','CLOSED'].includes(observation?.pipelineStatus)?observation.pipelineStatus:'UNKNOWN'},
  features:{status:features.status==='AVAILABLE'?'AVAILABLE':'UNAVAILABLE',
   featureVersion:features.status==='AVAILABLE'?2:null,inputCutoffMs:safeTime(features.inputCutoffMs),
   ageMs:finiteAge(features.ageMs),quality:quality(features.quality)},
  capabilities:{observation:selected.capabilities.observation,features:selected.capabilities.features,
   signals:'UNAVAILABLE',portfolio:'UNAVAILABLE',thesis:'UNAVAILABLE',decision:'UNAVAILABLE'},
  integrationStatus:'LOCAL_ONLY_NOT_DEPLOYED_OR_SCHEDULED',
  limitations:['OBSERVATION_AGE_NOT_SOURCE_FRESHNESS','NO_PRIVATE_ASSET_OR_SCENARIO_OUTPUT']};
}

// This combined return is PRIVATE. Only publicResult may be considered for a future public consumer.
// Private prices are explicitly supplied; market fallback is never promoted into VERIFIED ledger quotes.
export function runLocalConsumerWorkflow({marketInputs,privateComparison}={},
 {marketPolicy,privatePolicy,enablePrivateEvaluation=false}={}){
 if(typeof enablePrivateEvaluation!=='boolean')throw new Error('INVALID_PRIVATE_OPT_IN');
 const publicResult=buildPublicConsumerSummary(marketInputs,marketPolicy);
 let privateResult={status:'DISABLED',data:null};
 if(enablePrivateEvaluation){
  try {privateResult={status:'LOCAL_FICTIONAL_EVALUATION',data:compareAlternatives(privateComparison,privatePolicy)};}
  catch {privateResult={status:'BLOCKED',code:'PRIVATE_INPUT_OR_POLICY_INVALID',data:null};}
 }
 return {classification:'PRIVATE_COMBINED_RESULT_DO_NOT_PUBLISH',publicResult,privateResult};
}
