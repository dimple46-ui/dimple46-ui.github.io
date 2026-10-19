import {selectConsumerData} from './consumer-fallback.mjs';
const finiteAge=n=>Number.isSafeInteger(n)&&n>=0?n:null;
const safeTime=(n,reference)=>Number.isSafeInteger(n)&&n>0&&
 Number.isFinite(new Date(n).getTime())&&n<=reference?n:null;
const quality=q=>['VERIFIED','RECENT_FETCH','UNVERIFIED_TIME','STALE_INPUT','MISSING_INPUT'].includes(q)?q:'UNKNOWN';

const SOURCES={program:'PROGRAM','indexes.kospi':'KOSPI','indexes.kospi200':'KOSPI200',
 'stocks.samsung':'SAMSUNG','stocks.skHynix':'SK_HYNIX','futures.kospi200':'FUTURES',
 'futuresInvestors.kospi200':'FUTURES_INVESTORS'};
const ISSUE_STATES=new Set(['STALE','MISSING','ERROR','UNVERIFIED_TIME']);
function sourceQualitySummary(observation){
 const q=observation?.quality?.dataQuality??observation?.quality;
 const available=observation?.status==='AVAILABLE';
 const object=q!==null&&typeof q==='object'&&!Array.isArray(q);
 const issues=object&&Array.isArray(q.issues)?q.issues:null;
 const unverified=object&&Array.isArray(q.unverifiedMarketTimes)?q.unverifiedMarketTimes:null;
 const reasons=new Set(),known=new Set(),unknownTimes=new Set();let unrecognized=0;
 for(const issue of issues??[]){
  // Own-key lookup prevents inherited names such as __proto__ becoming public codes.
  const source=typeof issue?.path==='string'&&Object.hasOwn(SOURCES,issue.path)?SOURCES[issue.path]:null;
  if(source&&ISSUE_STATES.has(issue.status)){const code=`${source}_${issue.status}`;known.add(code);reasons.add(code);}
  else unrecognized++;
 }
 for(const path of unverified??[]){
  if(typeof path==='string'&&Object.hasOwn(SOURCES,path)){
   unknownTimes.add(path);reasons.add(`${SOURCES[path]}_UNVERIFIED_MARKET_TIME`);
  }else unrecognized++;
 }
 const complete=issues!==null&&unverified!==null&&unrecognized===0;
 return {status:!available?'UNAVAILABLE':!complete?'INCOMPLETE_METADATA':reasons.size?'REPORTED_ISSUES':'NO_REPORTED_ISSUES',
  reasonCodes:available?[...reasons].sort():[],
  knownIssueCount:available&&issues!==null?known.size:null,
  unverifiedSourceCount:available&&unverified!==null?unknownTimes.size:null,
  unrecognizedEntryCount:available&&object?unrecognized:null,
  scope:'CAPTURE_REPORTED_NOT_READ_TIME_REVALIDATED'};
}

// Whitelisted metadata only. Never spread input, raw quality, errors, descriptions or private results.
export function buildPublicConsumerSummary(marketInputs,policy){
 const selected=selectConsumerData(marketInputs,policy);
 const observation=selected.observation,features=selected.features;
 return {schemaVersion:1,generatedAtMs:policy.nowMs,status:selected.status,
  sourceQuality:sourceQualitySummary(observation),
  observation:{status:observation?.status==='AVAILABLE'?'AVAILABLE':'UNAVAILABLE',
   source:['CANDIDATE','GITHUB_FALLBACK'].includes(observation?.source)?observation.source:null,
   observedAtMs:safeTime(observation?.observedAtMs,policy.nowMs),inputCutoffMs:safeTime(observation?.inputCutoffMs,policy.nowMs),
   ageMs:finiteAge(observation?.ageMs),
   pipelineStatus:['OK','DEGRADED','CLOSED'].includes(observation?.pipelineStatus)?observation.pipelineStatus:'UNKNOWN'},
  features:{status:features.status==='AVAILABLE'?'AVAILABLE':'UNAVAILABLE',
   featureVersion:features.status==='AVAILABLE'?2:null,inputCutoffMs:safeTime(features.inputCutoffMs,policy.nowMs),
   ageMs:finiteAge(features.ageMs),quality:quality(features.quality)},
  capabilities:{observation:selected.capabilities.observation,features:selected.capabilities.features,
   signals:'UNAVAILABLE',portfolio:'UNAVAILABLE',thesis:'UNAVAILABLE',decision:'UNAVAILABLE'},
  integrationStatus:'LOCAL_ONLY_NOT_DEPLOYED_OR_SCHEDULED',
  limitations:['OBSERVATION_AGE_NOT_SOURCE_FRESHNESS','NO_PRIVATE_ASSET_OR_SCENARIO_OUTPUT']};
}

