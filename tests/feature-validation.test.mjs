import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';

const source=readFileSync(new URL('../cloudflare/feature-validation-worker.js',import.meta.url),'utf8');
test('generated validator identifies the current relay source and embeds its feature core',()=>{
 const relay=readFileSync(new URL('../cloudflare/market-relay-worker.js',import.meta.url),'utf8');
 const digest=createHash('sha256').update(relay).digest('hex');
 assert.equal(source.match(/const CANDIDATE_SHA256 = "([a-f0-9]{64})";/)?.[1],digest,
  'Regenerate with node cloudflare/build-feature-validation.mjs before validation deployment');
 const start=relay.indexOf('function usableHistoryMetric('),end=relay.indexOf('async function persistMarketHistory(');
 assert.ok(start>=0&&end>start,'Feature core extraction boundaries must remain valid');
 assert.ok(source.includes(relay.slice(start,end)),'Validator must embed the current feature core');
});
function worker(){
 const ctx=vm.createContext({console,Date,Request,Response,TextEncoder,Set,URL});
 vm.runInContext(source.replace('export default {','const worker = {'),ctx);
 return vm.runInContext('worker',ctx);
}
function readOnlyDb(row,queries=[],binds=[]){
 return {prepare(sql){queries.push(sql);assert.match(sql.trim(),/^(SELECT|WITH)\b/);return {bind(...args){binds.push(args);return {
  all:async()=>({success:true,results:sql.includes('recent_days')?[]:[row],meta:{duration:0.2,rows_read:1,rows_written:0}})
 };}};}};
}
function sqliteWriteFixture({existing=false,writeMetadata=true}={}){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0001_market_history.sql','0002_feature_runs.sql'])
  sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const at=Date.now()-1000,slot=Math.floor(at/120000)*120000;
 sqlite.prepare('INSERT INTO market_observations VALUES (?,?,?,?,?,?,?,?,?,?)').run(
  slot,at,at,'20261019',3,'fictional','DEGRADED','{}','{}','{"version":1}');
 const compact='{"featureVersion":2,"fixture":"가상"}';
 if(existing)sqlite.prepare('INSERT INTO feature_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
  slot,2,at,'20261019','1111111','1'.repeat(64),at+10,at,'STALE_INPUT','PARTIAL',compact,
  JSON.stringify({fullFeatureBytes:1000,compactFeatureBytes:Buffer.byteLength(compact),reductionPct:50}));
 const db={prepare(sql){return {bind(...args){return {
  all:async()=>({success:true,results:sqlite.prepare(sql).all(...args),meta:{rows_read:1,rows_written:0}}),
  run:async()=>{const result=sqlite.prepare(sql).run(...args);return {success:true,
   meta:writeMetadata?{changes:result.changes,rows_written:result.changes}:{}};}
 };}};}};
 return {sqlite,db,compact,stored:()=>({...sqlite.prepare('SELECT * FROM feature_runs').get()})};
}

test('duplicate Feature write reports immutable stored provenance and keeps recomputation separate',async()=>{
 const f=sqliteWriteFixture({existing:true}),before=f.stored();
 try {
  const response=await worker().fetch(new Request('https://test/feature-runs',{method:'POST',
   headers:{Authorization:'Bearer test'}}),{MARKET_HISTORY:f.db,VALIDATION_TOKEN:'test',
   FEATURE_V2_WRITE_ENABLED:'true',FEATURE_ENGINE_GIT_SHA:'2222222'});
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.status,'EXISTS');assert.deepEqual(f.stored(),before);
  assert.equal(result.engineGitSha,before.engine_git_sha);
  assert.equal(result.engineSourceSha256,before.engine_source_sha256);
  assert.equal(result.qualityCeiling,before.quality_ceiling);
  assert.equal(result.generatedAtMs,before.generated_at_ms);
  assert.equal(result.inputCutoffMs,before.input_cutoff_ms);
  assert.equal(result.compactFeaturesBytes,Buffer.byteLength(f.compact));
  assert.equal(result.fullFeatureBytes,1000);assert.equal(result.reductionPct,50);
  assert.equal(result.stored.engineGitSha,before.engine_git_sha);
  assert.equal(result.computed.engineGitSha,'2222222');
  assert.notEqual(result.computed.qualityCeiling,result.qualityCeiling);
  assert.equal(result.metadataScope,'STORED_FEATURE_RUN');
  assert.equal(result.candidateSha256,result.computed.engineSourceSha256);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
 } finally {f.sqlite.close();}
});
test('write outcomes require explicit D1 counts while returned Feature metadata always comes from readback',async()=>{
 for(const writeMetadata of [true,false]){
  const f=sqliteWriteFixture({writeMetadata});
  try {
   const post=()=>worker().fetch(new Request('https://test/feature-runs',{method:'POST',
    headers:{Authorization:'Bearer test'}}),{MARKET_HISTORY:f.db,VALIDATION_TOKEN:'test',
    FEATURE_V2_WRITE_ENABLED:'true',FEATURE_ENGINE_GIT_SHA:'2222222'});
   const first=await (await post()).json(),stored=f.stored(),second=await (await post()).json();
   assert.equal(first.status,writeMetadata?'INSERTED':'STORED_WRITE_OUTCOME_UNKNOWN');
   assert.equal(second.status,writeMetadata?'EXISTS':'STORED_WRITE_OUTCOME_UNKNOWN');
   assert.equal(first.engineGitSha,stored.engine_git_sha);
   assert.equal(second.generatedAtMs,stored.generated_at_ms);
   assert.deepEqual(f.stored(),stored);
   assert.equal(first.stored.compactFeaturesBytes,Buffer.byteLength(stored.compact_features_json));
  } finally {f.sqlite.close();}
 }
});

test('validation refuses unauthenticated requests before touching D1',async()=>{
 const w=worker(),db={prepare(){throw new Error('must not access D1');}};
 assert.equal((await w.fetch(new Request('https://test/'),{MARKET_HISTORY:db})).status,401);
 assert.equal((await w.fetch(new Request('https://test/',{headers:{Authorization:'Bearer wrong'}}),
  {MARKET_HISTORY:db,VALIDATION_TOKEN:'test'})).status,401);
});

test('GET replays stored observations, exposes compact preview and never writes',async()=>{
 const at=Date.now()-1000,queries=[];
 const row={slot_ms:Math.floor(at/120000)*120000,observed_at_ms:at,available_at_ms:at,trading_day:'20261002',
  metrics_json:'{}',quality_json:'{}',features_json:'{"version":1}'};
 const response=await worker().fetch(new Request('https://test/',{headers:{Authorization:'Bearer test'}}),
  {MARKET_HISTORY:readOnlyDb(row,queries),VALIDATION_TOKEN:'test'});
 assert.equal(response.status,200);const result=await response.json();
 assert.equal(result.mode,'READ_ONLY_REPLAY');assert.equal(result.storedFeatureVersion,1);assert.equal(result.features.version,2);
 assert.equal(result.distinctSlots,1);assert.equal(queries.length,3);assert.ok(result.compactFeaturesBytes>0);
 assert.ok(result.featuresBytes>=result.compactFeaturesBytes);assert.equal(result.features.windows['5m'].status,'INSUFFICIENT_HISTORY');
 assert.equal(result.queryMeta.current.rowsRead,1);assert.ok(result.candidateSha256);
 assert.match(source,/INSERT INTO feature_runs/);
 assert.doesNotMatch(source,/UPDATE market_observations|DELETE FROM market_observations|GITHUB_TOKEN|async scheduled/);
});

test('GET supports a past replay cutoff and rejects invalid or future cutoffs before D1',async()=>{
 const now=Date.now(),at=now-120000,cutoff=now-60000,queries=[],binds=[];
 const row={slot_ms:Math.floor(at/120000)*120000,observed_at_ms:at,available_at_ms:at,trading_day:'20261002',
  metrics_json:'{}',quality_json:'{}',features_json:'{"version":1}'};
 let response=await worker().fetch(new Request(`https://test/?cutoffMs=${cutoff}`,{headers:{Authorization:'Bearer test'}}),
  {MARKET_HISTORY:readOnlyDb(row,queries,binds),VALIDATION_TOKEN:'test'});
 assert.equal(response.status,200);const result=await response.json();
 assert.equal(result.replayCutoffMs,cutoff);assert.equal(binds[0][0],cutoff);assert.equal(queries.length,3);
 const untouched={prepare(){throw new Error('must not access D1');}};
 response=await worker().fetch(new Request('https://test/?cutoffMs=not-a-number',{headers:{Authorization:'Bearer test'}}),
  {MARKET_HISTORY:untouched,VALIDATION_TOKEN:'test'});
 assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_REPLAY_CUTOFF');
 response=await worker().fetch(new Request(`https://test/?cutoffMs=${Date.now()+60000}`,{headers:{Authorization:'Bearer test'}}),
  {MARKET_HISTORY:untouched,VALIDATION_TOKEN:'test'});
 assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_REPLAY_CUTOFF');
});

test('GET accepts replay cutoff from a header when the Cloudflare tester strips query parameters',async()=>{
 const now=Date.now(),at=now-120000,cutoff=now-60000,queries=[],binds=[];
 const row={slot_ms:Math.floor(at/120000)*120000,observed_at_ms:at,available_at_ms:at,trading_day:'20261002',
  metrics_json:'{}',quality_json:'{}',features_json:'{"version":1}'};
 const response=await worker().fetch(new Request('https://test/',{headers:{Authorization:'Bearer test',
  'X-Replay-Cutoff-Ms':String(cutoff)}}),
  {MARKET_HISTORY:readOnlyDb(row,queries,binds),VALIDATION_TOKEN:'test'});
 assert.equal(response.status,200);const result=await response.json();
 assert.equal(result.replayCutoffMs,cutoff);assert.equal(binds[0][0],cutoff);assert.equal(queries.length,3);
});

test('GET accepts replay cutoff from the path when the Cloudflare tester strips parameters and headers',async()=>{
 const now=Date.now(),at=now-120000,cutoff=now-60000,queries=[],binds=[];
 const row={slot_ms:Math.floor(at/120000)*120000,observed_at_ms:at,available_at_ms:at,trading_day:'20261002',
  metrics_json:'{}',quality_json:'{}',features_json:'{"version":1}'};
 const response=await worker().fetch(new Request(`https://test/replay/${cutoff}`,{
  headers:{Authorization:'Bearer test'}}),
  {MARKET_HISTORY:readOnlyDb(row,queries,binds),VALIDATION_TOKEN:'test'});
 assert.equal(response.status,200);const result=await response.json();
 assert.equal(result.replayCutoffMs,cutoff);assert.equal(binds[0][0],cutoff);assert.equal(queries.length,3);
});

test('candidate write is explicit opt-in and validates the engine git SHA',async()=>{
 const at=Date.now()-1000,row={slot_ms:Math.floor(at/120000)*120000,observed_at_ms:at,available_at_ms:at,
  trading_day:'20261002',metrics_json:'{}',quality_json:'{}',features_json:'{"version":1}'};
 const request=()=>new Request('https://test/feature-runs',{method:'POST',headers:{Authorization:'Bearer test'}});
 let response=await worker().fetch(request(),{MARKET_HISTORY:readOnlyDb(row),VALIDATION_TOKEN:'test'});
 assert.equal(response.status,403);assert.equal((await response.json()).error,'FEATURE_WRITE_DISABLED');
 response=await worker().fetch(request(),{MARKET_HISTORY:readOnlyDb(row),VALIDATION_TOKEN:'test',FEATURE_V2_WRITE_ENABLED:'true'});
 assert.equal(response.status,503);assert.equal((await response.json()).error,'INVALID_FEATURE_ENGINE_GIT_SHA');
});

test('D1 read failures and corrupt observations return a generic failure without leaking details',async()=>{
 const failing={prepare(){return {bind(){return {all:async()=>({success:false,results:[]})};}};}};
 let response=await worker().fetch(new Request('https://test/',{headers:{Authorization:'Bearer test'}}),
  {MARKET_HISTORY:failing,VALIDATION_TOKEN:'test'});
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'FEATURE_VALIDATION_FAILED'});
 const at=Date.now()-1000,row={slot_ms:Math.floor(at/120000)*120000,observed_at_ms:at,available_at_ms:at,
  trading_day:'20261002',metrics_json:'not-json',quality_json:'{}',features_json:'{"version":1}'};
 response=await worker().fetch(new Request('https://test/',{headers:{Authorization:'Bearer test'}}),
  {MARKET_HISTORY:readOnlyDb(row),VALIDATION_TOKEN:'test'});
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'FEATURE_VALIDATION_FAILED'});
});

test('D1 write failure is isolated and reported without storing or exposing the database error',async()=>{
 const at=Date.now()-1000,row={slot_ms:Math.floor(at/120000)*120000,observed_at_ms:at,available_at_ms:at,
  trading_day:'20261002',metrics_json:'{}',quality_json:'{}',features_json:'{"version":1}'};
 const db={prepare(sql){return {bind(){return {
  all:async()=>({success:true,results:sql.includes('recent_days')?[]:[row],meta:{rows_read:1,rows_written:0}}),
  run:async()=>({success:false,meta:{rows_read:0,rows_written:0}})
 };}};}};
 const response=await worker().fetch(new Request('https://test/feature-runs',{method:'POST',headers:{Authorization:'Bearer test'}}),
  {MARKET_HISTORY:db,VALIDATION_TOKEN:'test',FEATURE_V2_WRITE_ENABLED:'true',FEATURE_ENGINE_GIT_SHA:'abcdef0'});
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'FEATURE_VALIDATION_FAILED'});
});

test('authenticated write-control observes runtime bindings without D1 or token disclosure',async()=>{
 const db={prepare(){throw new Error('write-control must not access D1');}};
 for(const enabled of ['false','true']) {
  const w=worker(),env={MARKET_HISTORY:db,VALIDATION_TOKEN:'fictional-sensitive-token',
   FEATURE_ENGINE_GIT_SHA:'2222222',FEATURE_V2_WRITE_ENABLED:enabled};
  assert.equal((await w.fetch(new Request('https://test/write-control'),env)).status,401);
  const response=await w.fetch(new Request('https://test/write-control',{
   headers:{Authorization:'Bearer fictional-sensitive-token'}}),env);
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.mode,'WRITE_CONTROL');assert.equal(body.schemaVersion,1);
  assert.equal(body.writeEnabled,enabled==='true');assert.equal(body.engineGitSha,'2222222');
  assert.equal(body.scope,'RUNTIME_BINDINGS_ONLY');assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(JSON.stringify(body).includes('fictional-sensitive-token'),false);
  assert.equal(Object.hasOwn(body,'observedAt'),false);
 }
});
