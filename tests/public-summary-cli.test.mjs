import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../scripts/summarize-public-input.mjs',import.meta.url));
const fixture=fileURLToPath(new URL('./fixtures/closed-snapshot.json',import.meta.url));
const asOf=Date.parse('2026-09-30T11:00:07.732Z');
const policy=['--as-of-ms',String(asOf),'--max-observation-age-ms','120000','--max-feature-age-ms','300000'];
const run=args=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
test('existing saved public fixture emits only safe summary; partial observation is not full analysis success',()=>{
 const r=run(['--snapshot',fixture,...policy]);assert.equal(r.status,0);assert.equal(r.stderr,'');
 const result=JSON.parse(r.stdout);assert.equal(result.status,'PARTIAL');
 assert.equal(result.observation.source,'GITHUB_FALLBACK');assert.equal(result.observation.ageMs,1000);
 for(const k of ['features','signals','portfolio','decision'])assert.equal(result.capabilities[k],'UNAVAILABLE');
 assert.equal(result.integrationStatus,'LOCAL_ONLY_NOT_DEPLOYED_OR_SCHEDULED');
 assert.ok(!r.stdout.includes('stocks'));assert.deepEqual(r.stdout,run(['--snapshot',fixture,...policy]).stdout);
});
test('old or future saved input returns unavailable with exit2, never current live PASS',()=>{
 for(const ms of [asOf+120001,asOf-2000]){
  const p=[...policy];p[1]=String(ms);const r=run(['--snapshot',fixture,...p]);
  assert.equal(r.status,2);assert.equal(JSON.parse(r.stdout).status,'UNAVAILABLE');assert.equal(r.stderr,'');
 }
});
test('private flags, missing/duplicate/coerced policies and paths never appear in errors',()=>{
 for(const args of [[],['--private','PRIVATE_SENTINEL'],['--snapshot','/PRIVATE_SENTINEL/missing',...policy],
 ['--snapshot',fixture,...policy,'--as-of-ms','PRIVATE_SENTINEL'],
 ['--snapshot',fixture,'--as-of-ms','NaN','--max-observation-age-ms','1','--max-feature-age-ms','1']]){
  const r=run(args);assert.equal(r.status,1);assert.equal(r.stdout,'');
  assert.deepEqual(JSON.parse(r.stderr),{status:'FAIL',code:'PUBLIC_INPUT_OR_POLICY_INVALID'});
  assert.ok(!r.stderr.includes('PRIVATE_SENTINEL'));assert.ok(!r.stderr.includes(fixture));
 }
});
test('malformed, oversized, combined private and hostile raw payloads are not echoed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'public-cli-'));
 try{
  const path=join(dir,'PRIVATE_SENTINEL.json');
  for(const data of ['PRIVATE_SENTINEL_NOT_JSON',' '.repeat(2*1024*1024+1),
   JSON.stringify({schemaVersion:3,stocks:{},privateResult:{secret:'PRIVATE_SENTINEL'}})]){
   writeFileSync(path,data);const r=run(['--snapshot',path,...policy]);assert.equal(r.status,1);
   assert.equal(r.stdout,'');assert.ok(!r.stderr.includes('PRIVATE_SENTINEL'));
  }
  writeFileSync(path,JSON.stringify({schemaVersion:3,koreaDate:'20260930',relayUpdatedAt:'2026-09-30T11:00:06.732Z',
   pipelineStatus:'PRIVATE_SENTINEL',dataQuality:{secret:'PRIVATE_SENTINEL'},stocks:{samsung:{price:100,volume:0}}}));
  const r=run(['--snapshot',path,...policy]);assert.equal(r.status,0);assert.ok(!r.stdout.includes('PRIVATE_SENTINEL'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('saved candidate state/features preserve independent cutoff and unverified quality',()=>{
 const dir=mkdtempSync(join(tmpdir(),'public-cli-feature-'));
 try{
  const state=join(dir,'state.json'),feature=join(dir,'feature.json');
  writeFileSync(state,JSON.stringify({apiSchemaVersion:1,inputCutoffMs:asOf,state:{schemaVersion:1,
   observedAtMs:asOf-1000,availableAtMs:asOf-500,tradingDay:'20260930',pipelineStatus:'OK',
   metrics:{'samsung.price':{value:100,status:'LIVE'}}}}));
  const f={apiSchemaVersion:1,inputCutoffMs:asOf,feature:{featureVersion:2,inputCutoffMs:asOf-60000,
   observedAtMs:asOf-60000,generatedAtMs:asOf-59000,tradingDay:'20260930',qualityCeiling:'UNVERIFIED_TIME',
   generationStatus:'SUCCESS',compactFeatures:{featureVersion:2}}};
  writeFileSync(feature,JSON.stringify(f));
  let r=run(['--state',state,'--features',feature,...policy]);assert.equal(r.status,0);
  let out=JSON.parse(r.stdout);assert.equal(out.features.status,'AVAILABLE');assert.equal(out.features.quality,'UNVERIFIED_TIME');
  assert.equal(out.features.ageMs,60000);assert.equal(out.observation.ageMs,1000);
  f.feature.inputCutoffMs=asOf-600000;writeFileSync(feature,JSON.stringify(f));
  r=run(['--state',state,'--features',feature,...policy]);out=JSON.parse(r.stdout);
  assert.equal(out.features.status,'UNAVAILABLE');assert.equal(out.features.ageMs,600000);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
