import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../cloudflare/feature-validation-worker.js',import.meta.url),'utf8');
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

test('candidate write is explicit opt-in and validates the engine git SHA',async()=>{
 const at=Date.now()-1000,row={slot_ms:Math.floor(at/120000)*120000,observed_at_ms:at,available_at_ms:at,
  trading_day:'20261002',metrics_json:'{}',quality_json:'{}',features_json:'{"version":1}'};
 const request=()=>new Request('https://test/feature-runs',{method:'POST',headers:{Authorization:'Bearer test'}});
 let response=await worker().fetch(request(),{MARKET_HISTORY:readOnlyDb(row),VALIDATION_TOKEN:'test'});
 assert.equal(response.status,403);assert.equal((await response.json()).error,'FEATURE_WRITE_DISABLED');
 response=await worker().fetch(request(),{MARKET_HISTORY:readOnlyDb(row),VALIDATION_TOKEN:'test',FEATURE_V2_WRITE_ENABLED:'true'});
 assert.equal(response.status,503);assert.equal((await response.json()).error,'INVALID_FEATURE_ENGINE_GIT_SHA');
});
