// Pure, local-only selection contract. No fetching, authentication, persistence or consumer opt-in.
const isTime=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());
const day=n=>new Date(n+9*3600000).toISOString().slice(0,10).replaceAll('-','');
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const copy=o=>o==null?null:structuredClone(o);
const unavailable=reason=>({status:'UNAVAILABLE',reason,data:null});
function age(time,now,maximum) {
  if(!isTime(time)) return {ageMs:null,reason:'MISSING_OR_INVALID_TIME'};
  if(time>now) return {ageMs:null,reason:'FUTURE_INPUT'};
  const ageMs=now-time;
  return {ageMs,reason:ageMs>maximum?'STALE_INPUT':null};
}
function safeMetrics(metrics,now) {
  const selected={};
  for(const [key,m] of Object.entries(metrics??{})) {
    if(!/^(samsung|skHynix|kospi|kospi200|market|program|futures)\.[A-Za-z]+$/.test(key)||!plain(m)) continue;
    const invalid=m.value!=null&&(typeof m.value!=='number'||!Number.isFinite(m.value));
    const future=[m.marketTime,m.fetchedAt].some(t=>typeof t==='string'&&Date.parse(t)>now);
    selected[key]={value:invalid||future?null:m.value??null,status:future?'FUTURE_INPUT':invalid?'INVALID_INPUT':m.status??'UNKNOWN',
      source:m.source??null,marketTime:m.marketTime??null,fetchedAt:m.fetchedAt??null,
      timeBasis:m.timeBasis??null,quality:m.quality??null};
  }
  return selected;
}
function candidateObservation(response,now,maximum) {
  if(!plain(response)||response.error) return unavailable('CANDIDATE_UNAVAILABLE');
  const s=response.state;
  if(response.apiSchemaVersion!==1||s?.schemaVersion!==1||!plain(s.metrics)) return unavailable('INVALID_CANDIDATE_SCHEMA');
  const a=age(s.observedAtMs,now,maximum);
  if(a.reason) return {...unavailable(a.reason),ageMs:a.ageMs};
  if(!isTime(s.availableAtMs)||!isTime(response.inputCutoffMs)||
    s.observedAtMs>s.availableAtMs||s.availableAtMs>response.inputCutoffMs||response.inputCutoffMs>now)
    return unavailable('INVALID_OR_FUTURE_CUTOFF');
  if(s.tradingDay!==day(s.observedAtMs)) return unavailable('TRADING_DAY_MISMATCH');
  const metrics=safeMetrics(s.metrics,response.inputCutoffMs);
  if(!Object.values(metrics).some(m=>Number.isFinite(m.value))) return unavailable('NO_USABLE_METRICS');
  return {status:'AVAILABLE',source:'CANDIDATE',schemaVersion:1,observedAtMs:s.observedAtMs,
    inputCutoffMs:response.inputCutoffMs,tradingDay:s.tradingDay,ageMs:a.ageMs,
    quality:copy(s.quality),pipelineStatus:s.pipelineStatus??null,metrics};
}
function githubObservation(snapshot,now,maximum) {
  if(snapshot?.schemaVersion!==3||!plain(snapshot.stocks)) return unavailable('GITHUB_UNAVAILABLE_OR_INVALID_SCHEMA');
  const observed=typeof snapshot.relayUpdatedAt==='string'?Date.parse(snapshot.relayUpdatedAt):NaN;
  const a=age(observed,now,maximum);
  if(a.reason) return {...unavailable(a.reason),ageMs:a.ageMs};
  if(snapshot.koreaDate!==day(observed)) return unavailable('TRADING_DAY_MISMATCH');
  const metrics={};
  for(const stock of ['samsung','skHynix']) for(const field of ['price','volume']) {
    const s=snapshot.stocks[stock];
    const meta=snapshot.dataMeta?.stocks?.[stock];
    metrics[`${stock}.${field}`]={value:s?.[field]??null,status:meta?.status??'UNKNOWN',
      source:meta?.source??null,marketTime:meta?.marketTime??s?.lastTradedAt??null,
      fetchedAt:meta?.fetchedAt??null,timeBasis:meta?.timeBasis??null};
  }
  const selectedMetrics=safeMetrics(metrics,now);
  if(!Object.values(selectedMetrics).some(m=>Number.isFinite(m.value))) return unavailable('NO_USABLE_METRICS');
  return {status:'AVAILABLE',source:'GITHUB_FALLBACK',schemaVersion:3,observedAtMs:observed,
    inputCutoffMs:observed,tradingDay:snapshot.koreaDate,ageMs:a.ageMs,
    quality:copy(snapshot.dataQuality),pipelineStatus:snapshot.pipelineStatus??null,
    sourceErrors:copy(snapshot.sourceErrors),metrics:selectedMetrics,
    limitation:'STOCK_PRICE_VOLUME_ONLY_NOT_FEATURE_SIGNAL_OR_PORTFOLIO'};
}
function featureSelection(response,now,maximum) {
  if(!plain(response)||response.error) return unavailable('FEATURE_RESPONSE_UNAVAILABLE');
  const f=response.feature;
  if(response.apiSchemaVersion!==1||f?.featureVersion!==2||f.compactFeatures?.featureVersion!==2)
    return unavailable('FEATURE_VERSION_MISMATCH');
  const a=age(f.inputCutoffMs,now,maximum);
  // Quality describes the stored input; rejecting its age must not erase or upgrade it.
  const quality=['VERIFIED','RECENT_FETCH','UNVERIFIED_TIME','STALE_INPUT','MISSING_INPUT'].includes(f.qualityCeiling)?f.qualityCeiling:'UNKNOWN';
  if(a.reason) return {...unavailable(a.reason),inputCutoffMs:f.inputCutoffMs,ageMs:a.ageMs,quality};
  if(!isTime(f.observedAtMs)||f.observedAtMs>f.inputCutoffMs||!isTime(f.generatedAtMs)||
    f.generatedAtMs<f.inputCutoffMs||f.generatedAtMs>now||!isTime(response.inputCutoffMs)||
    f.inputCutoffMs>response.inputCutoffMs||f.generatedAtMs>response.inputCutoffMs||response.inputCutoffMs>now)
    return unavailable('INVALID_OR_FUTURE_FEATURE_TIME');
  if(f.tradingDay!==day(f.inputCutoffMs)) return unavailable('TRADING_DAY_MISMATCH');
  if(f.generationStatus!=='SUCCESS'||!['VERIFIED','UNVERIFIED_TIME','RECENT_FETCH'].includes(f.qualityCeiling))
    return {...unavailable('UNUSABLE_FEATURE_QUALITY'),inputCutoffMs:f.inputCutoffMs,ageMs:a.ageMs,quality};
  return {status:'AVAILABLE',featureVersion:2,inputCutoffMs:f.inputCutoffMs,ageMs:a.ageMs,
    quality:f.qualityCeiling,data:copy(f)};
}

export function selectConsumerData({candidateState,candidateFeatures,githubSnapshot}={},
  {nowMs,maxObservationAgeMs,maxFeatureAgeMs}={}) {
  if(!isTime(nowMs)||![maxObservationAgeMs,maxFeatureAgeMs].every(n=>Number.isSafeInteger(n)&&n>=0))
    throw new Error('INVALID_SELECTION_POLICY');
  const candidate=candidateObservation(candidateState,nowMs,maxObservationAgeMs);
  const fallback=candidate.status==='AVAILABLE'?null:githubObservation(githubSnapshot,nowMs,maxObservationAgeMs);
  const observation=candidate.status==='AVAILABLE'?candidate:fallback;
  const selected=observation?.status==='AVAILABLE';
  const features=selected&&observation.source==='CANDIDATE'?featureSelection(candidateFeatures,nowMs,maxFeatureAgeMs):
    unavailable(selected?'GITHUB_OBSERVATION_ONLY':'NO_USABLE_OBSERVATION');
  return {contractVersion:1,generatedAtMs:nowMs,status:selected?'PARTIAL':'UNAVAILABLE',observation,
    features,capabilities:{observation:selected?'AVAILABLE':'UNAVAILABLE',features:features.status,
      signals:'UNAVAILABLE',portfolio:'UNAVAILABLE',thesis:'UNAVAILABLE',decision:'UNAVAILABLE'},
    selectionReasons:{candidate:candidate.status==='AVAILABLE'?'SELECTED':candidate.reason,
      github:fallback?.reason??(fallback?.status==='AVAILABLE'?'SELECTED':'NOT_NEEDED')},
    limitations:['OBSERVATION_AGE_IS_NOT_SOURCE_FRESHNESS','NO_SIGNAL_OR_PERSONAL_ASSET_CALCULATION',
      'LOCAL_CONTRACT_NOT_CONNECTED_TO_SCHEDULED_TASKS']};
}
