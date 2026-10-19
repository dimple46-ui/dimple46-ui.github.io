import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {generateDescriptiveSignals} from '../cloudflare/signal-engine.mjs';

function runtime(file) {
 const source=readFileSync(new URL(`../cloudflare/${file}`,import.meta.url),'utf8');
 const context=vm.createContext({console,Date,URL,Request,Response,TextEncoder});
 vm.runInContext(source.replace('export default {','const worker = {'),context);
 return {context,run:code=>vm.runInContext(code,context)};
}
function payload(bucket,foreign,institution) {
 const at=`2026-10-16T${bucket}:00+09:00`;
 return {relayUpdatedAt:at,koreaDate:'20261016',stockFlowEstimates:{
  samsung:{latest:{foreignNetBuyQty:foreign,institutionNetBuyQty:institution}}},
  dataMeta:{stockFlowEstimates:{samsung:{status:'CURRENT_BUCKET',marketTime:at,
   fetchedAt:at,timeBasis:'SOURCE_SCHEDULED_BUCKET'}}}};
}

test('scheduled bucket estimates retain unverified time through Feature2, compact encoding and Signal2',()=>{
 const relay=runtime('market-relay-worker.js');
 relay.context.payloads=[payload('09:30',100,0),payload('10:00',140,20),payload('11:20',200,50)];
 const rows=JSON.parse(JSON.stringify(relay.run('payloads.map(historyObservation)')));
 for(const file of ['market-relay-worker.js','feature-validation-worker.js']) {
  const r=runtime(file);r.context.rows=structuredClone(rows);
  const features=JSON.parse(JSON.stringify(r.run('historyFeatures(rows.at(-1),rows,[])')));
  for(const [flow,delta,acceleration] of [['foreignFlow',60,20],['institutionFlow',30,10]]) {
   const metric=features.bucketChanges.samsung[flow];
   assert.equal(metric.quality,'UNVERIFIED_TIME',file);
   assert.equal(metric.status,'BUCKET_DELTA');assert.equal(metric.value,delta);
   assert.equal(metric.acceleration,acceleration);
  }
  const signals=generateDescriptiveSignals(features,{engineGitSha:'abcdef0',generatedAt:features.inputCutoff});
  assert.equal(signals.length,2);
  assert.ok(signals.every(s=>s.confidence.ceiling==='MEDIUM'&&s.data_quality.ceiling==='UNVERIFIED_TIME'));
  r.context.features=features;
  const compact=JSON.parse(JSON.stringify(r.run('compactHistoryFeatures(features)')));
  assert.ok(compact.codes.quality.includes('UNVERIFIED_TIME'));
  assert.equal(JSON.stringify(r.context.rows),JSON.stringify(rows));
 }
});

test('scheduled bucket quality correction preserves missing, stale and source-trade classifications',()=>{
 for(const file of ['market-relay-worker.js','feature-validation-worker.js']) {
  const r=runtime(file);
  for(const [metric,expected] of [
   [{value:null,status:'CURRENT_BUCKET',timeBasis:'SOURCE_SCHEDULED_BUCKET'},'MISSING_INPUT'],
   [{value:1,status:'STALE_BUCKET',timeBasis:'SOURCE_SCHEDULED_BUCKET'},'STALE_INPUT'],
   [{value:1,status:'CURRENT_BUCKET',timeBasis:'SOURCE_TRADE_TIME'},'VERIFIED'],
   [{value:1,status:'LIVE',timeBasis:'SOURCE_TRADE_TIME'},'VERIFIED'],
   [{value:1,status:'UNKNOWN',timeBasis:'SOURCE_SCHEDULED_BUCKET'},'UNUSABLE_INPUT']
  ]) {r.context.metric=metric;assert.equal(r.run('featureMetricQuality(metric)'),expected,file);}
 }
});
