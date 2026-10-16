import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSummary} from '../scripts/check-candidate.mjs';
const at=Date.now()-1000,sha='a'.repeat(40);
const options={expectedSha:sha,referenceMs:at,maxObservationAgeMs:180000,maxFeatureAgeMs:300000};
function fixture(){return {readOnly:true,apiSchemaVersion:1,schemaVersion:1,status:'PARTIAL',generatedAtMs:at+100,
 evaluationReferenceMs:at,release:{workerGitSha:sha,serviceReleaseVersion:3,supportedFeatureVersion:2},
 agePolicy:{maxObservationAgeMs:180000,maxFeatureAgeMs:300000},observation:{status:'AVAILABLE',source:'CANDIDATE',
 observedAtMs:at-1000,inputCutoffMs:at,ageMs:1000,pipelineStatus:'DEGRADED'},features:{status:'UNAVAILABLE',featureVersion:null,
 inputCutoffMs:at-600000,ageMs:600000,quality:'STALE_INPUT'},featureRead:{status:'OK'},
 capabilities:{observation:'AVAILABLE',features:'UNAVAILABLE',signals:'UNAVAILABLE',portfolio:'UNAVAILABLE',thesis:'UNAVAILABLE',decision:'UNAVAILABLE'},
 sourceQuality:{scope:'CAPTURE_REPORTED_NOT_READ_TIME_REVALIDATED',reasonCodes:['PROGRAM_STALE'],status:'REPORTED_ISSUES'},
 queryMeta:{observation:{rowsRead:1,rowsWritten:0},feature:{rowsRead:1,rowsWritten:0}}};}
test('checker accepts stale Feature as unavailable while preserving separate age and non-production scope',()=>{
 const r=assertSummary(fixture(),options);assert.equal(r.featureStatus,'UNAVAILABLE');assert.equal(r.featureAgeMs,600000);
 assert.equal(r.observationAgeMs,1000);assert.equal(r.d1Writes,0);assert.equal(r.pipelineStatus,'DEGRADED');
});
test('summary SHA/version/time/policy, future/leaked inputs and private readiness cannot pass',()=>{
 for(const mutate of [s=>s.release.workerGitSha='b'.repeat(40),s=>s.release.serviceReleaseVersion=2,
 s=>s.evaluationReferenceMs++,s=>s.agePolicy.maxFeatureAgeMs++,s=>s.features.inputCutoffMs=at+1,
 s=>s.features.ageMs=1000,s=>s.capabilities.portfolio='AVAILABLE',s=>s.privateResult={secret:'never print'},
 s=>s.sourceQuality.reasonCodes=['PRIVATE_SENTINEL']]){const s=fixture();mutate(s);assert.throws(()=>assertSummary(s,options));}
});
test('nonzero/unknown write telemetry and Feature read failure never become zero-write PASS',()=>{
 for(const mutate of [s=>s.queryMeta.feature.rowsWritten=1,s=>s.queryMeta.feature.rowsWritten=null,
 s=>s.queryMeta.feature=null,s=>delete s.queryMeta.observation.rowsRead,s=>s.featureRead.status='FAILED',
 s=>s.featureRead.status='NOT_FOUND']){const s=fixture();mutate(s);assert.throws(()=>assertSummary(s,options));}
});
test('available Feature cannot bypass quality ceiling or age policy',()=>{
 const s=fixture();s.features={status:'AVAILABLE',featureVersion:2,inputCutoffMs:at-100000,ageMs:100000,quality:'UNVERIFIED_TIME'};
 s.capabilities.features='AVAILABLE';assert.equal(assertSummary(s,options).featureQuality,'UNVERIFIED_TIME');
 for(const patch of [{quality:'STALE_INPUT'},{ageMs:600000,inputCutoffMs:at-600000},{featureVersion:3}])
  assert.throws(()=>assertSummary({...s,features:{...s.features,...patch}},options));
});

test('matching stored cutoff detects erased quality; different rows are not falsely compared',()=>{
 const s=fixture(),storedFeature={featureVersion:2,inputCutoffMs:s.features.inputCutoffMs,qualityCeiling:'STALE_INPUT'};
 assert.equal(assertSummary(s,{...options,storedFeature}).featureQuality,'STALE_INPUT');
 s.features.quality='UNKNOWN';
 assert.throws(()=>assertSummary(s,{...options,storedFeature}),/SUMMARY_FEATURE_QUALITY_NOT_PRESERVED/);
 assert.doesNotThrow(()=>assertSummary(s,{...options,storedFeature:{...storedFeature,inputCutoffMs:at-700000}}));
 s.features.quality='UNKNOWN';
 assert.doesNotThrow(()=>assertSummary(s,{...options,storedFeature:{...storedFeature,qualityCeiling:'PRIVATE_SENTINEL'}}));
});
