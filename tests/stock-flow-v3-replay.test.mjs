import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateStockFlowV3Replay} from '../scripts/validate-stock-flow-v3-replay.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/stock-flow-20261016.json',import.meta.url),'utf8'));
const options={engineGitSha:'74855080042caac2dc8789e78c6403acc712afab'};
test('saved public evidence replay preserves versions, quality and explicit provenance',()=>{
  const input=fixture(),before=structuredClone(input),r=validateStockFlowV3Replay(input,options);
  assert.deepEqual(input,before);assert.deepEqual(r,validateStockFlowV3Replay(input,options));
  assert.equal(r.status,'PASS');assert.equal(r.signals.length,4);
  assert.equal(r.pipelineStatus,'DEGRADED');assert.equal(r.databaseValidation,'NOT_PERFORMED');
  assert.equal(r.deploymentValidation,'NOT_PERFORMED');
  const hynix=r.signals.find(s=>s.ticker==='000660'&&s.signal_type.startsWith('FOREIGN'));
  assert.equal(hynix.signal_type,'FOREIGN_SELLING_DECELERATING');
  assert.ok(Math.abs(hynix.supporting_evidence[2].value-52.19696969697)<1e-8);
  assert.equal(hynix.supporting_evidence[3].value,-12000);
  assert.deepEqual(hynix.interval_minutes,[30,80]);
  assert.ok(r.signals.every(s=>s.data_quality.ceiling==='UNVERIFIED_TIME'));
});
test('invalid identity, stale/null, missing and future buckets fail without zero replacement',()=>{
  assert.throws(()=>validateStockFlowV3Replay(fixture(),{engineGitSha:'bad'}),/INVALID_SIGNAL_ENGINE_GIT_SHA/);
  for(const mutate of [
    s=>s.dataMeta.stockFlowEstimates.samsung.status='STALE',
    s=>s.stockFlowEstimates.samsung.rows[0].foreignNetBuyQty=null,
    s=>s.stockFlowEstimates.samsung.rows.splice(0,1),
    s=>s.relayUpdatedAt='2026-10-16T02:19:00Z',
    s=>s.koreaDate='20261015'
  ]) {const s=fixture();mutate(s);assert.throws(()=>validateStockFlowV3Replay(s,options));}
});
