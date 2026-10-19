import test from 'node:test';
import assert from 'node:assert/strict';
import {selectConsumerData} from '../cloudflare/consumer-fallback.mjs';
const now=Date.parse('2026-10-16T03:20:00Z');
const policy={nowMs:now,maxObservationAgeMs:120000,maxFeatureAgeMs:300000};
function fixture(){return {
 candidateState:{apiSchemaVersion:1,inputCutoffMs:now,state:{schemaVersion:1,observedAtMs:now-1000,availableAtMs:now-500,
  tradingDay:'20261016',pipelineStatus:'DEGRADED',quality:{issues:['STALE'],unverifiedMarketTimes:['futures']},metrics:{
   'samsung.price':{value:null,status:'STALE'},'skHynix.price':{value:100,status:'RECENT_FETCH'},
   'program.totalNet':{value:0,status:'STALE'}}}},
 candidateFeatures:{apiSchemaVersion:1,inputCutoffMs:now,feature:{featureVersion:2,inputCutoffMs:now-100000,
  observedAtMs:now-100000,generatedAtMs:now-99000,tradingDay:'20261016',generationStatus:'SUCCESS',
  qualityCeiling:'UNVERIFIED_TIME',compactFeatures:{featureVersion:2,windows:{}}}},
 githubSnapshot:{schemaVersion:3,koreaDate:'20261016',relayUpdatedAt:new Date(now-2000).toISOString(),fresh:true,
  pipelineStatus:'DEGRADED',sourceErrors:[],dataQuality:{issues:['STALE']},stocks:{samsung:{price:null,volume:0},skHynix:{price:200,volume:500}}}
};}
test('candidate preserves null/zero/degraded source quality; feature age is independent and output is immutable',()=>{
 const f=fixture(),before=structuredClone(f),r=selectConsumerData(f,policy);
 assert.equal(r.observation.source,'CANDIDATE');assert.equal(r.observation.ageMs,1000);
 assert.equal(r.features.ageMs,100000);assert.equal(r.features.quality,'UNVERIFIED_TIME');
 assert.equal(r.observation.metrics['samsung.price'].value,null);
 assert.equal(r.observation.metrics['program.totalNet'].value,0);
 assert.equal(r.observation.metrics['program.totalNet'].status,'STALE');assert.equal(r.observation.pipelineStatus,'DEGRADED');
 assert.equal(r.capabilities.signals,'UNAVAILABLE');assert.equal(r.status,'PARTIAL');
 r.features.data.compactFeatures.windows.mutated=true;assert.deepEqual(f,before);
});
test('candidate failure falls back only to price/volume; no Feature/Signal/portfolio success',()=>{
 for(const candidateState of [undefined,{error:'UNAUTHORIZED'},{error:'QUERY_TIMEOUT'},{apiSchemaVersion:99}]){
  const f=fixture();f.candidateState=candidateState;
  const r=selectConsumerData(f,policy);assert.equal(r.observation.source,'GITHUB_FALLBACK');
  assert.equal(r.features.reason,'GITHUB_OBSERVATION_ONLY');assert.equal(r.features.data,null);
  assert.equal(r.observation.metrics['samsung.price'].value,null);
  assert.equal(r.observation.metrics['samsung.volume'].value,0);
  assert.equal(r.observation.metrics['skHynix.price'].status,'UNKNOWN');
  for(const k of ['features','signals','portfolio','decision'])assert.equal(r.capabilities[k],'UNAVAILABLE');
 }
});
test('old Feature never inherits observation freshness; failed/missing/mismatched Feature remains unavailable',()=>{
 for(const mutate of [f=>f.candidateFeatures=undefined,f=>f.candidateFeatures.feature.inputCutoffMs=now-400000,
  f=>f.candidateFeatures.feature.qualityCeiling='STALE_INPUT',f=>f.candidateFeatures.feature.featureVersion=1,
  f=>f.candidateFeatures.feature.inputCutoffMs=now+1,f=>f.candidateFeatures.feature.generatedAtMs=now+1]){
  const f=fixture();mutate(f);const r=selectConsumerData(f,policy);
  assert.equal(r.observation.source,'CANDIDATE');assert.equal(r.features.status,'UNAVAILABLE');assert.equal(r.features.data,null);
 }
});
test('future/missing/stale observations do not become live via fresh=true; invalid values cannot become zero',()=>{
 for(const offset of [1,-120001]){
  const f=fixture();f.candidateState.state.observedAtMs=now+offset;
  f.githubSnapshot.relayUpdatedAt=new Date(now+offset).toISOString();
  const r=selectConsumerData(f,policy);assert.equal(r.status,'UNAVAILABLE');assert.equal(r.features.status,'UNAVAILABLE');
 }
 const f=fixture();f.candidateState.state.metrics['skHynix.price'].value=Infinity;
 const r=selectConsumerData(f,policy);assert.equal(r.observation.metrics['skHynix.price'].value,null);
 assert.equal(r.observation.metrics['skHynix.price'].status,'INVALID_INPUT');
 assert.throws(()=>selectConsumerData(f,{...policy,maxFeatureAgeMs:NaN}),/INVALID_SELECTION_POLICY/);
 const empty=selectConsumerData({},policy);assert.equal(empty.status,'UNAVAILABLE');
});

test('empty/null-only observations are unavailable and future per-metric time is suppressed',()=>{
 const f=fixture();f.candidateState.state.metrics={};
 f.githubSnapshot.stocks={};
 assert.equal(selectConsumerData(f,policy).status,'UNAVAILABLE');
 const future=fixture();future.candidateState.state.metrics['skHynix.price'].marketTime=new Date(now+1).toISOString();
 const r=selectConsumerData(future,policy);
 assert.equal(r.observation.metrics['skHynix.price'].value,null);
 assert.equal(r.observation.metrics['skHynix.price'].status,'FUTURE_INPUT');
});

test('age rejection retains only known stored quality without making Feature available',()=>{
 for(const qualityCeiling of ['STALE_INPUT','UNVERIFIED_TIME','MISSING_INPUT','RECENT_FETCH','VERIFIED','PRIVATE_SENTINEL',null,{}]){
  const f=fixture();Object.assign(f.candidateFeatures.feature,{inputCutoffMs:now-600000,qualityCeiling});
  const r=selectConsumerData(f,policy);
  assert.equal(r.features.status,'UNAVAILABLE');assert.equal(r.features.reason,'STALE_INPUT');
  assert.equal(r.features.data,null);assert.equal(r.features.inputCutoffMs,now-600000);assert.equal(r.features.ageMs,600000);
  assert.equal(r.features.quality,typeof qualityCeiling==='string'&&qualityCeiling!=='PRIVATE_SENTINEL'?qualityCeiling:'UNKNOWN');
  assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));
 }
});

test('metric source times are bounded by their saved response cutoff, not a later display clock',()=>{
 for(const field of ['marketTime','fetchedAt']){
  const f=fixture(),cutoff=now-2000;
  f.candidateState.inputCutoffMs=cutoff;
  Object.assign(f.candidateState.state,{observedAtMs:cutoff,availableAtMs:cutoff});
  f.candidateState.state.metrics={'samsung.price':{value:50},'skHynix.price':{value:100,[field]:new Date(cutoff+1).toISOString()}};
  const before=structuredClone(f),r=selectConsumerData(f,policy);
  assert.equal(r.observation.metrics['skHynix.price'].value,null);
  assert.equal(r.observation.metrics['skHynix.price'].status,'FUTURE_INPUT');
  assert.deepEqual(f,before);
  const metric=f.candidateState.state.metrics['skHynix.price'];
  metric[field]=new Date(cutoff).toISOString();
  assert.equal(selectConsumerData(f,policy).observation.metrics['skHynix.price'].value,100);
 }
});

test('Feature must have been generated by its response cutoff even when displayed later',()=>{
 const f=fixture(),feature=f.candidateFeatures.feature;
 f.candidateFeatures.inputCutoffMs=feature.generatedAtMs-1;
 const before=structuredClone(f),r=selectConsumerData(f,policy);
 assert.equal(r.observation.status,'AVAILABLE');
 assert.equal(r.features.status,'UNAVAILABLE');
 assert.equal(r.features.reason,'INVALID_OR_FUTURE_FEATURE_TIME');
 assert.deepEqual(f,before);
 f.candidateFeatures.inputCutoffMs=feature.generatedAtMs;
 assert.equal(selectConsumerData(f,policy).features.status,'AVAILABLE');
});
