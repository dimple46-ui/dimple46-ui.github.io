import test from 'node:test';
import assert from 'node:assert/strict';
import {bucketFlowKinematics} from '../cloudflare/bucket-flow-kinematics.mjs';

const inputCutoffMs=Date.parse('2026-10-16T02:28:46.739Z');
const make=values=>values.map((value,i)=>({value,
  marketTimeMs:Date.parse(`2026-10-16T${['00:30','01:00','02:20'][i]}:00Z`),
  availableAtMs:inputCutoffMs,quality:'VERIFIED',timeBasis:'SOURCE_SCHEDULED_BUCKET'}));
const run=samples=>bucketFlowKinematics(samples,{inputCutoffMs});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9);

test('real Hynix counterexample preserves raw delta difference while normalized selling slows',()=>{
  const samples=make([-146000,-291000,-448000]),copy=structuredClone(samples),r=run(samples);
  assert.equal(r.status,'VALID');assert.deepEqual(r.intervalMinutes,[30,80]);
  assert.deepEqual(r.deltaShares,[-145000,-157000]);assert.equal(r.deltaDifferenceShares,-12000);
  near(r.averageFlowSharesPerMinute[0],-145000/30);
  near(r.averageFlowSharesPerMinute[1],-157000/80);
  assert.equal(r.midpointDistanceMinutes,55);
  near(r.accelerationSharesPerMinuteSquared,(-157000/80+145000/30)/55);
  assert.ok(r.accelerationSharesPerMinuteSquared>0);assert.deepEqual(samples,copy);
});
test('constant flow across unequal intervals yields zero acceleration, real zero stays zero',()=>{
  const r=run(make([0,3000,11000]));
  assert.equal(r.deltaDifferenceShares,5000);
  assert.deepEqual(r.averageFlowSharesPerMinute,[100,100]);
  assert.equal(r.accelerationSharesPerMinuteSquared,0);
  assert.equal(run(make([0,0,0])).accelerationSharesPerMinuteSquared,0);
});
test('missing history/value and weak quality do not manufacture zero or verified quality',()=>{
  assert.equal(run(make([1,2])).status,'INSUFFICIENT_BUCKET_HISTORY');
  const missing=run(make([0,null,10]));assert.equal(missing.status,'MISSING_INPUT');
  assert.equal(missing.accelerationSharesPerMinuteSquared,null);
  for(const quality of ['STALE_INPUT','MISSING_INPUT','UNKNOWN','UNUSABLE_INPUT']) {
    const s=make([1,2,3]);s[0].quality=quality;
    const r=run(s);assert.equal(r.status,'UNUSABLE_INPUT_QUALITY');
    assert.equal(r.deltaDifferenceShares,null);
  }
  const s=make([1,2,3]);s[0].quality='UNVERIFIED_TIME';
  assert.deepEqual(run(s).qualityInputs,['UNVERIFIED_TIME','VERIFIED','VERIFIED']);
});
test('future availability, mixed days, duplicate/reordered source times and nonfinite quantities fail',()=>{
  const cases=[
    [s=>s[0].availableAtMs=inputCutoffMs+1,'FUTURE_OR_UNAVAILABLE_BUCKET'],
    [s=>s[0].marketTimeMs-=86400000,'CROSS_TRADING_DAY_BUCKET'],
    [s=>s[1].marketTimeMs=s[0].marketTimeMs,'UNORDERED_OR_DUPLICATE_BUCKET'],
    [s=>s.reverse(),'UNORDERED_OR_DUPLICATE_BUCKET'],
    [s=>s[0].timeBasis='FETCH_TIME','UNSUPPORTED_BUCKET_TIME_BASIS'],
    [s=>s[0].value=Infinity,'INVALID_FLOW_QUANTITY'],
    [s=>s[0].value=Number.MAX_SAFE_INTEGER,'FLOW_ARITHMETIC_OVERFLOW']
  ];
  for(const [mutate,code] of cases){const s=make([0,-1,2]);mutate(s);assert.throws(()=>run(s),new RegExp(code));}
});
