import test from 'node:test';
import assert from 'node:assert/strict';
import {generateDescriptiveSignals} from '../cloudflare/signal-engine.mjs';

const cutoff='2026-10-07T02:30:00.000Z',generatedAt='2026-10-07T02:31:00.000Z',sha='abcdef0';
const metric=(value,{status='OK',quality='VERIFIED',...extra}={})=>({value,status,quality,...extra});
function fixture(){
 const window={metrics:{'program.totalNet':metric(100),'futures.price':metric(1)},
  acceleration:{'program.totalNet':metric(80)},
  momentumAcceleration:{samsung:metric(2),skHynix:metric(-1)},
  futuresPosition:{state:'NEW_LONG_CANDIDATE',status:'VALID',quality:'UNVERIFIED_TIME',
   supportingEvidence:[{metric:'futures.priceReturnPct',value:1},{metric:'futures.openInterestDelta',value:10}],contraryEvidence:[]},
  divergences:{samsungPriceVsForeignFlow:{state:'PRICE_UP_FLOW_DOWN',status:'VALID',quality:'VERIFIED',strength:2,
   supportingEvidence:[{metric:'price',value:1},{metric:'flow',value:-2}],contraryEvidence:[]},
   cashVsFutures:{state:'CASH_UP_FUTURES_DOWN',status:'VALID',quality:'UNVERIFIED_TIME',strength:1,
    supportingEvidence:[{metric:'cash',value:1},{metric:'futures',value:-1}],contraryEvidence:[]}}};
 return {version:2,inputCutoff:cutoff,
  bucketChanges:{samsung:{foreignFlow:metric(100,{status:'BUCKET_DELTA',acceleration:150}),
    institutionFlow:metric(20,{status:'BUCKET_DELTA',acceleration:50})},
   skHynix:{foreignFlow:metric(-100,{status:'BUCKET_DELTA',acceleration:40}),
    institutionFlow:metric(0,{status:'BUCKET_UNCHANGED',acceleration:null})}},
  windows:{'5m':structuredClone(window),'10m':structuredClone(window),'30m':structuredClone(window)},
  sameTimeHistorical:{windows:{'5d':{metrics:{'samsung.volume':metric(100000,{status:'VALID',percentile:100,zScore:3}),
    'skHynix.volume':metric(1000,{status:'VALID',percentile:50,zScore:0})}}}}};
}
function generated(features=fixture()){return generateDescriptiveSignals(features,{engineGitSha:sha,generatedAt});}

test('descriptive signals cover flow acceleration, reversal, program, futures, relative strength and divergence',()=>{
 const signals=generated(),types=new Set(signals.map(signal=>signal.signal_type));
 for(const type of ['FOREIGN_BUYING_ACCELERATING','FOREIGN_SELLING_DECELERATING','INSTITUTION_FLOW_REVERSAL',
  'PROGRAM_BUYING_ACCELERATING','OI_NEW_LONG_CANDIDATE','FUTURES_RISK_ON','RELATIVE_STRENGTH_IMPROVING',
  'PRICE_FLOW_DIVERGENCE','CASH_FUTURES_DIVERGENCE','ABNORMAL_VOLUME']) assert.ok(types.has(type),type);
 assert.ok(signals.every(signal=>signal.state==='ACTIVE'));
 assert.ok(signals.every(signal=>!signal.signal_type.includes('BUY')||signal.signal_type.includes('BUYING')));
});

test('signal schema is reproducible and carries evidence, invalidation and versions',()=>{
 const signal=generated().find(value=>value.signal_type==='FOREIGN_BUYING_ACCELERATING');
 assert.equal(signal.signal_id,`s1:${cutoff}:005930:BUCKET:FOREIGN_BUYING_ACCELERATING`);
 assert.equal(signal.input_cutoff,cutoff);assert.equal(signal.generated_at,generatedAt);
 assert.equal(signal.feature_version,2);assert.equal(signal.signal_version,1);assert.equal(signal.engine_git_sha,sha);
 assert.ok(signal.supporting_evidence.length>=2);assert.ok(signal.invalidation.length>=1);
 assert.match(signal.confidence.meaning,/NOT_PREDICTIVE_PROBABILITY/);
});

test('confidence never exceeds UNVERIFIED_TIME quality ceiling',()=>{
 const futures=generated().find(value=>value.signal_type==='OI_NEW_LONG_CANDIDATE');
 assert.equal(futures.data_quality.ceiling,'UNVERIFIED_TIME');
 assert.equal(futures.confidence.ceiling,'MEDIUM');
 assert.notEqual(futures.confidence.level,'HIGH');
});

test('stale, null and unchanged inputs do not create false zero-flow signals',()=>{
 const features=fixture();
 features.bucketChanges.samsung.foreignFlow=metric(null,{status:'BUCKET_UNCHANGED',quality:'STALE_INPUT',acceleration:null});
 features.bucketChanges.skHynix.foreignFlow=metric(0,{status:'BUCKET_UNCHANGED',acceleration:0});
 const signals=generated(features).filter(value=>value.signal_type.startsWith('FOREIGN_'));
 assert.equal(signals.length,0);
});

test('futures classifications preserve contrary evidence and remain descriptive',()=>{
 const features=fixture();
 features.windows['5m'].futuresPosition.contraryEvidence=[{metric:'futures.basis',value:-1,reason:'OPPOSES_PRICE_DIRECTION'}];
 const signal=generated(features).find(value=>value.signal_type==='OI_NEW_LONG_CANDIDATE'&&value.horizon==='5m');
 assert.equal(signal.contrary_evidence.length,1);assert.equal(signal.confidence.level,'MEDIUM');
 assert.ok(!('probability' in signal));
});

test('invalid feature versions, engine revisions and times are rejected',()=>{
 const features=fixture();features.version=1;
 assert.throws(()=>generated(features),/FEATURE_VERSION_MISMATCH/);
 assert.throws(()=>generateDescriptiveSignals(fixture(),{engineGitSha:'bad',generatedAt}),/INVALID_SIGNAL_ENGINE_GIT_SHA/);
 assert.throws(()=>generateDescriptiveSignals(fixture(),{engineGitSha:sha,generatedAt:'2026-10-07T02:00:00Z'}),/INVALID_SIGNAL_TIME/);
});

