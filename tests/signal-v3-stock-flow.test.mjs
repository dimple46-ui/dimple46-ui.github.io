import test from 'node:test';
import assert from 'node:assert/strict';
import {generateStockFlowSignalsV3} from '../cloudflare/signal-v3-stock-flow.mjs';
import {generateDescriptiveSignals,SIGNAL_VERSION} from '../cloudflare/signal-engine.mjs';
const inputCutoffMs=Date.parse('2026-10-16T02:28:46.739Z');
const options={enabled:true,featureVersion:2,inputCutoffMs,generatedAtMs:inputCutoffMs+1000,engineGitSha:'a'.repeat(40)};
const make=values=>values.map((value,i)=>({value,marketTimeMs:Date.parse(`2026-10-16T${['00:30','01:00','02:20'][i]}:00Z`),
  availableAtMs:inputCutoffMs,quality:'UNVERIFIED_TIME',timeBasis:'SOURCE_SCHEDULED_BUCKET'}));
const fixture=()=>({samsung:{foreignFlow:make([-916000,-865000,-684000]),institutionFlow:make([0,111000,-108000])},
  skHynix:{foreignFlow:make([-146000,-291000,-448000]),institutionFlow:make([0,58000,-27000])}});

test('v3 requires boolean opt-in and keeps v2 legacy meaning unchanged',()=>{
  assert.equal(generateStockFlowSignalsV3(fixture()).status,'DISABLED');
  assert.throws(()=>generateStockFlowSignalsV3(fixture(),{...options,enabled:'true'}),/INVALID_SIGNAL_V3_OPT_IN/);
  assert.equal(SIGNAL_VERSION,2);
  const v2=generateDescriptiveSignals({version:2,inputCutoff:new Date(inputCutoffMs).toISOString(),bucketChanges:{
    skHynix:{foreignFlow:{value:-157000,acceleration:-12000,status:'BUCKET_DELTA',quality:'UNVERIFIED_TIME'}}}},
    {engineGitSha:options.engineGitSha,generatedAt:new Date(options.generatedAtMs).toISOString()});
  assert.equal(v2[0].signal_type,'FOREIGN_SELLING_ACCELERATING');
  const v3=generateStockFlowSignalsV3(fixture(),options).signals.find(s=>s.ticker==='000660'&&s.signal_type.startsWith('FOREIGN'));
  assert.equal(v3.signal_type,'FOREIGN_SELLING_DECELERATING');assert.equal(v3.signal_version,3);
  assert.notEqual(v3.signal_id,v2[0].signal_id);
});
test('actual public counterexample produces deterministic descriptive evidence for both stocks',()=>{
  const input=fixture(),copy=structuredClone(input),result=generateStockFlowSignalsV3(input,options);
  assert.deepEqual(result,generateStockFlowSignalsV3(input,options));assert.deepEqual(input,copy);
  assert.equal(result.signals.length,4);assert.equal(result.diagnostics.length,0);
  for(const signal of result.signals) {
    assert.equal(signal.confidence.ceiling,'MEDIUM');assert.equal(signal.confidence.level,'MEDIUM');
    assert.equal(signal.data_quality.ceiling,'UNVERIFIED_TIME');assert.equal(signal.kinematics_version,1);
    assert.deepEqual(signal.interval_minutes,[30,80]);assert.equal(signal.midpoint_distance_minutes,55);
    assert.equal(signal.input_cutoff,new Date(inputCutoffMs).toISOString());
    assert.ok(signal.supporting_evidence.every(e=>Number.isFinite(e.value)));
    assert.ok(!('probability' in signal));assert.ok(!('action' in signal));
  }
  assert.ok(result.signals.some(s=>s.signal_type==='FOREIGN_BUYING_ACCELERATING'));
  assert.equal(result.signals.filter(s=>s.signal_type==='INSTITUTION_FLOW_REVERSAL').length,2);
});
test('missing basis has no raw fallback; per-flow failures cannot produce stale or future signals',()=>{
  const missing=generateStockFlowSignalsV3({samsung:{foreignFlow:{value:-157000,acceleration:-12000}}},options);
  assert.equal(missing.signals.length,0);assert.equal(missing.diagnostics[0].reason,'INSUFFICIENT_TIME_BASIS');
  for(const [mutate,reason] of [
    [s=>s[0].quality='STALE_INPUT','UNUSABLE_INPUT_QUALITY'],
    [s=>s[0].quality='MISSING_INPUT','UNUSABLE_INPUT_QUALITY'],
    [s=>s[0].value=null,'MISSING_INPUT'],
    [s=>s[0].availableAtMs=inputCutoffMs+1,'FUTURE_OR_UNAVAILABLE_BUCKET'],
    [s=>s[1].marketTimeMs=s[0].marketTimeMs,'UNORDERED_OR_DUPLICATE_BUCKET'],
    [s=>s[0].timeBasis='FETCH_TIME','UNSUPPORTED_BUCKET_TIME_BASIS']]) {
    const input=fixture();mutate(input.skHynix.foreignFlow);
    const result=generateStockFlowSignalsV3(input,options);
    assert.equal(result.signals.length,3);
    assert.ok(result.diagnostics.some(d=>d.ticker==='000660'&&d.flow==='foreignFlow'&&d.reason===reason));
  }
});
test('quality of the oldest sample caps confidence, flat rates emit no acceleration and bad context fails',()=>{
  const input=fixture();input.samsung.foreignFlow=make([0,3000,11000]);
  input.skHynix.foreignFlow=make([-146000,-291000,-448000]).map(s=>({...s,quality:'VERIFIED'}));
  input.skHynix.foreignFlow[0].quality='RECENT_FETCH';
  const r=generateStockFlowSignalsV3(input,options);
  assert.ok(!r.signals.some(s=>s.ticker==='005930'&&s.signal_type.startsWith('FOREIGN')));
  const signal=r.signals.find(s=>s.ticker==='000660'&&s.signal_type.startsWith('FOREIGN'));
  assert.equal(signal.data_quality.ceiling,'RECENT_FETCH');assert.equal(signal.confidence.ceiling,'MEDIUM');
  for(const changes of [{featureVersion:1},{generatedAtMs:inputCutoffMs-1},{engineGitSha:'bad'}])
    assert.throws(()=>generateStockFlowSignalsV3(fixture(),{...options,...changes}));
});
