import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPublicConsumerSummary} from '../domain/local-consumer-workflow.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/public-state-20261016-1338.json',import.meta.url)));
const policy={nowMs:1792125581965,maxObservationAgeMs:180000,maxFeatureAgeMs:300000};
const run=s=>buildPublicConsumerSummary({githubSnapshot:s},policy);
test('saved real public capture explains program stale and four unverified source times without upgrading quality',()=>{
 const s=fixture(),before=structuredClone(s),r=run(s);
 assert.deepEqual(s,before);assert.equal(r.observation.pipelineStatus,'DEGRADED');
 assert.equal(r.sourceQuality.status,'REPORTED_ISSUES');assert.equal(r.sourceQuality.knownIssueCount,1);
 assert.equal(r.sourceQuality.unverifiedSourceCount,4);assert.equal(r.sourceQuality.unrecognizedEntryCount,0);
 assert.deepEqual(r.sourceQuality.reasonCodes,['FUTURES_INVESTORS_UNVERIFIED_MARKET_TIME',
 'FUTURES_UNVERIFIED_MARKET_TIME','KOSPI200_UNVERIFIED_MARKET_TIME','KOSPI_UNVERIFIED_MARKET_TIME','PROGRAM_STALE']);
 assert.equal(r.capabilities.features,'UNAVAILABLE');assert.deepEqual(r,run(s));
});
test('unknown paths/statuses/private descriptions are counted generically, never echoed',()=>{
 const s=fixture();s.dataQuality.issues.push({path:'PRIVATE_SENTINEL_ACCOUNT',status:'PRIVATE_SENTINEL_STATUS',description:'PRIVATE_SENTINEL'},
  {path:'__proto__',status:'STALE'},{path:'program',status:'STALE',description:'PRIVATE_SENTINEL'},null);
 s.dataQuality.unverifiedMarketTimes.push('PRIVATE_SENTINEL_TIME','indexes.kospi');
 const r=run(s);assert.equal(r.sourceQuality.status,'INCOMPLETE_METADATA');
 assert.equal(r.sourceQuality.knownIssueCount,1);assert.equal(r.sourceQuality.unverifiedSourceCount,4);
 assert.equal(r.sourceQuality.unrecognizedEntryCount,4);assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));
});
test('missing metadata is unknown/null, explicit empty arrays mean only no reported issues',()=>{
 const s=fixture();delete s.dataQuality;
 let r=run(s);assert.equal(r.sourceQuality.status,'INCOMPLETE_METADATA');assert.equal(r.sourceQuality.knownIssueCount,null);
 s.dataQuality={issues:[],unverifiedMarketTimes:[]};r=run(s);
 assert.equal(r.sourceQuality.status,'NO_REPORTED_ISSUES');assert.equal(r.sourceQuality.knownIssueCount,0);
 // The source's degraded pipeline cannot be upgraded by an empty quality report.
 assert.equal(r.observation.pipelineStatus,'DEGRADED');
 s.relayUpdatedAt='2026-10-15T04:38:47Z';r=run(s);
 assert.equal(r.sourceQuality.status,'UNAVAILABLE');assert.equal(r.sourceQuality.knownIssueCount,null);
});
test('candidate quality wrapper is supported; fallback does not inherit rejected candidate quality',()=>{
 const s=fixture(),state={schemaVersion:1,observedAtMs:policy.nowMs-1000,availableAtMs:policy.nowMs,
 tradingDay:'20261016',pipelineStatus:'DEGRADED',metrics:{'samsung.price':{value:100,status:'LIVE'}},quality:{dataQuality:s.dataQuality}};
 let r=buildPublicConsumerSummary({candidateState:{apiSchemaVersion:1,inputCutoffMs:policy.nowMs,state}},policy);
 assert.equal(r.sourceQuality.knownIssueCount,1);
 state.observedAtMs=policy.nowMs+1;s.dataQuality={issues:[],unverifiedMarketTimes:[]};
 r=buildPublicConsumerSummary({candidateState:{apiSchemaVersion:1,inputCutoffMs:policy.nowMs,state},githubSnapshot:s},policy);
 assert.equal(r.observation.source,'GITHUB_FALLBACK');assert.deepEqual(r.sourceQuality.reasonCodes,[]);
});

test('saved authenticated receipt reproduces old Feature age with preserved STALE_INPUT; not a new runtime validation',()=>{
 const receipt=JSON.parse(readFileSync(new URL('../validation/candidate-summary-20261016-1411.json',import.meta.url)));
 const old=receipt.authenticatedSmoke,reference=old.summary.evaluationReferenceMs;
 const candidateState={apiSchemaVersion:1,inputCutoffMs:reference,state:{schemaVersion:1,
  observedAtMs:old.latestObservation,availableAtMs:old.latestObservation,tradingDay:'20261016',pipelineStatus:'DEGRADED',
  metrics:{'samsung.price':{value:100,status:'LIVE'}},quality:{dataQuality:{issues:[],unverifiedMarketTimes:[]}}}};
 const candidateFeatures={apiSchemaVersion:1,inputCutoffMs:reference,feature:{featureVersion:old.featureVersion,
  inputCutoffMs:old.featureInputCutoff,qualityCeiling:old.quality,compactFeatures:{featureVersion:2}}};
 const r=buildPublicConsumerSummary({candidateState,candidateFeatures},{...policy,nowMs:reference});
 assert.equal(old.summary.featureQuality,'UNKNOWN'); // Historical evidence must not be rewritten.
 assert.equal(r.features.quality,'STALE_INPUT');assert.equal(r.features.status,'UNAVAILABLE');
 assert.equal(r.features.ageMs,old.summary.featureAgeMs);assert.equal(r.features.inputCutoffMs,old.featureInputCutoff);
 assert.equal(r.observation.ageMs,old.summary.observationAgeMs);assert.equal(r.capabilities.features,'UNAVAILABLE');
});
