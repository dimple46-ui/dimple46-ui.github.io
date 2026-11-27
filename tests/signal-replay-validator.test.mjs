import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSignalReplay} from '../cloudflare/signal-replay-validator.mjs';

const cutoff = '2026-10-08T02:26:43.951Z';
const cutoffMs = Date.parse(cutoff);
const metric = (value, {status = 'OK', quality = 'VERIFIED', ...extra} = {}) =>
  ({value, status, quality, ...extra});

function replay() {
  const window = {
    metrics: {'program.totalNet': metric(-10, {quality: 'STALE_INPUT'})},
    acceleration: {'program.totalNet': metric(-4, {quality: 'STALE_INPUT'})},
    momentumAcceleration: {samsung: metric(2), skHynix: metric(-1)},
    futuresPosition: {state: 'NEW_SHORT_CANDIDATE', status: 'VALID', quality: 'UNVERIFIED_TIME',
      supportingEvidence: [{metric: 'price', value: -1}, {metric: 'oi', value: 2}], contraryEvidence: []},
    divergences: {}
  };
  return {
    mode: 'READ_ONLY_REPLAY', replayCutoffMs: cutoffMs + 1000,
    queryMeta: {current: {rowsWritten: 0}, intraday: {rowsWritten: 0}, sameTime: {rowsWritten: 0}},
    features: {version: 2, inputCutoff: cutoff,
      bucketChanges: {samsung: {
        foreignFlow: metric(100, {status: 'BUCKET_DELTA', acceleration: 60, accelerationStatus: 'VALID'}),
        institutionFlow: metric(null, {status: 'BUCKET_UNCHANGED', acceleration: null})
      }, skHynix: {
        foreignFlow: metric(-20, {status: 'BUCKET_DELTA', acceleration: 5, accelerationStatus: 'VALID'}),
        institutionFlow: metric(30, {status: 'BUCKET_DELTA', acceleration: 50, accelerationStatus: 'VALID'})
      }},
      windows: {'5m': structuredClone(window), '10m': structuredClone(window), '30m': structuredClone(window)},
      sameTimeHistorical: {windows: {}}
    }
  };
}

test('read-only replay validator enforces deterministic descriptive Signal invariants', () => {
  const result = validateSignalReplay(replay(), {engineGitSha: 'abcdef0', generatedAt: '2026-10-08T02:27:00Z'});
  assert.equal(result.status, 'PASS');
  assert.equal(result.featureVersion, 2);
  assert.equal(result.checks.d1RowsWrittenZero, true);
  assert.equal(result.checks.deterministic, true);
  assert.ok(result.signalTypes.includes('FOREIGN_BUYING_ACCELERATING'));
  assert.ok(result.signalTypes.includes('OI_NEW_SHORT_CANDIDATE'));
  assert.ok(!result.signalTypes.some(type => type.startsWith('PROGRAM_')));
  assert.equal(result.stockFlow.samsung.institutionFlow.delta, null);
});

test('validator rejects future leakage and any observed D1 write', () => {
  const future = replay();
  future.replayCutoffMs = cutoffMs - 1;
  assert.throws(() => validateSignalReplay(future, {engineGitSha: 'abcdef0'}), /FUTURE_DATA_LEAKAGE/);
  const write = replay();
  write.queryMeta.current.rowsWritten = 1;
  assert.throws(() => validateSignalReplay(write, {engineGitSha: 'abcdef0'}), /D1_WRITE_DETECTED/);
});

test('validator rejects non-replay and unsupported Feature payloads', () => {
  const wrongMode = replay(); wrongMode.mode = 'CANDIDATE_COMPACT_WRITE';
  assert.throws(() => validateSignalReplay(wrongMode, {engineGitSha: 'abcdef0'}), /NOT_READ_ONLY_REPLAY/);
  const wrongVersion = replay(); wrongVersion.features.version = 1;
  assert.throws(() => validateSignalReplay(wrongVersion, {engineGitSha: 'abcdef0'}), /FEATURE_VERSION_MISMATCH/);
});

test('replay cannot PASS with nonfinite supporting or contrary categorical evidence',()=>{
 const options={engineGitSha:'abcdef0',generatedAt:'2026-10-08T02:27:00Z'};
 for(const invalid of [NaN,Infinity,-Infinity]) {
  for(const kind of ['futures','divergence']) for(const field of ['supportingEvidence','contraryEvidence']) {
   const input=replay();
   const window=input.features.windows['5m'];
   const target=kind==='futures'?window.futuresPosition:
    (window.divergences.samsungPriceVsForeignFlow={state:'PRICE_UP_FLOW_DOWN',status:'VALID',quality:'VERIFIED',
     supportingEvidence:[{metric:'price',value:1}],contraryEvidence:[]});
   target[field]=[{metric:'fixture',details:{values:[1,invalid]}}];
   assert.throws(()=>validateSignalReplay(input,options),/NONFINITE_SIGNAL_EVIDENCE/);
  }
 }
 const malformed=replay();malformed.features.windows['5m'].futuresPosition.supportingEvidence={value:1};
 assert.throws(()=>validateSignalReplay(malformed,options),/INVALID_SIGNAL_EVIDENCE_SHAPE/);
 const valid=replay();
 valid.features.windows['5m'].futuresPosition.contraryEvidence=[{metric:'basis',value:null,reason:'MISSING'}];
 const result=validateSignalReplay(valid,options);
 assert.equal(result.status,'PASS');assert.equal(result.checks.finiteNumericEvidence,true);
 assert.equal(valid.features.windows['5m'].futuresPosition.contraryEvidence[0].value,null);
});
