import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/intelligence-read-worker.mjs';

const now=Date.now(),slot=Math.floor((now-120000)/120000)*120000;
const observation={slot_ms:slot,observed_at_ms:slot+1000,available_at_ms:slot+1000,trading_day:'20261007',
 schema_version:1,quality_version:'test',pipeline_status:'OK',
 metrics_json:JSON.stringify({'samsung.price':{value:null,status:'STALE',quality:'STALE_INPUT'}}),
 quality_json:JSON.stringify({sourceErrors:[{source:'PROGRAM',category:'STALE'}]})};
const compact={encodingVersion:1,featureVersion:2,codes:{},order:{},windows:{}};
const validation={featureVersion:2,qualityCeiling:'UNVERIFIED_TIME',nullRatio:0.5};
const token='super-secret-credential-123';
const feature={slot_ms:slot,feature_version:2,observed_at_ms:slot+1000,trading_day:'20261007',
 engine_git_sha:'abcdef0',engine_source_sha256:'a'.repeat(64),generated_at_ms:slot+2000,input_cutoff_ms:slot+1000,
 quality_ceiling:'UNVERIFIED_TIME',generation_status:'SUCCESS',compact_features_json:JSON.stringify(compact),
 validation_json:JSON.stringify(validation)};

function db({badFeature=false,fail=false}={}){
 const statements=[];
 return {statements,prepare(sql){statements.push(sql);assert.match(sql.trim(),/^SELECT\b/);
  const execute=async()=>{
   if(fail) return {success:false,results:[]};
   let results=[];
   if(sql.includes('FROM feature_runs')&&sql.includes('GROUP BY')) results=[{trading_day:'20261007',row_count:1,json_bytes:14000}];
   else if(sql.includes('FROM market_observations')&&sql.includes('GROUP BY')) results=[{trading_day:'20261007',row_count:10,json_bytes:100000}];
   else if(sql.includes('FROM feature_runs')) results=[badFeature?{...feature,feature_version:3}:feature];
   else if(sql.includes('FROM market_observations')) results=[observation];
   return {success:true,results,meta:{duration:0.25,rows_read:results.length,rows_written:0,served_by:'local-test'}};
  };
  return {all:execute,bind(){return {all:execute};}};
 }};
}
function request(path,options={}){
 return new Request(`https://candidate${path}`,{...options,headers:{Authorization:`Bearer ${token}`,
  'CF-Connecting-IP':options.ip||'192.0.2.1',...(options.headers||{})}});
}
const env=database=>({MARKET_HISTORY:database,INTELLIGENCE_READ_TOKEN:token,
 INTELLIGENCE_RATE_LIMIT_PER_MINUTE:'100',INTELLIGENCE_WORKER_GIT_SHA:'abcdef0',
 CF_VERSION_METADATA:{id:'deployment-test'}});

test('authentication and methods are rejected before any D1 access',async()=>{
 const database=db();
 assert.equal((await worker.fetch(new Request('https://candidate/health'),env(database))).status,401);
 assert.equal((await worker.fetch(request('/health',{method:'POST'}),env(database))).status,405);
 assert.equal(database.statements.length,0);
});

test('health is machine-readable, bounded and contains no secret',async()=>{
 const database=db(),response=await worker.fetch(request('/health'),env(database));
 assert.equal(response.status,200);const body=await response.json();
 assert.equal(body.readOnly,true);assert.equal(body.collectionHealth,'OK');
 assert.equal(body.latestFeatureRun.featureVersion,2);assert.equal(body.latestFeatureRun.qualityCeiling,'UNVERIFIED_TIME');
 assert.equal(body.storageGrowth.observations[0].row_count,10);
 assert.equal(body.release.workerGitSha,'abcdef0');assert.equal(body.release.deploymentId,'deployment-test');
 assert.equal(body.storageGrowth.observationProjection.status,'LIMITED_SAMPLE');
 assert.equal(body.storageGrowth.observationProjection.projectedAnnualJsonBytes,25000000);
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.doesNotMatch(JSON.stringify(body),new RegExp(token));
 assert.ok(database.statements.every(sql=>sql.trim().startsWith('SELECT')));
});

test('state preserves null and stale quality and enforces a past-only cutoff',async()=>{
 const database=db(),cutoff=now-1000;
 const response=await worker.fetch(request(`/state?cutoffMs=${cutoff}`),env(database));
 assert.equal(response.status,200);const body=await response.json();
 assert.equal(body.inputCutoffMs,cutoff);assert.equal(body.state.metrics['samsung.price'].value,null);
 assert.equal(body.state.metrics['samsung.price'].quality,'STALE_INPUT');
 const future=await worker.fetch(request(`/state?cutoffMs=${now+60000}`,{ip:'192.0.2.2'}),env(db()));
 assert.equal(future.status,400);assert.equal((await future.json()).error,'INVALID_CUTOFF');
});

test('features enforce version and stored identity integrity',async()=>{
 let response=await worker.fetch(request('/features?featureVersion=2',{ip:'192.0.2.3'}),env(db()));
 assert.equal(response.status,200);let body=await response.json();
 assert.equal(body.feature.featureVersion,2);assert.equal(body.feature.inputCutoffMs,slot+1000);
 response=await worker.fetch(request('/features?featureVersion=3',{ip:'192.0.2.4'}),env(db()));
 assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_FEATURE_VERSION');
 response=await worker.fetch(request('/features',{ip:'192.0.2.5'}),env(db({badFeature:true})));
 assert.equal(response.status,409);assert.equal((await response.json()).error,'STORED_FEATURE_INTEGRITY_ERROR');
});

test('history rejects unbounded ranges and returns chronological read-only rows',async()=>{
 const from=now-60*60*1000,to=now-1000,database=db();
 let response=await worker.fetch(request(`/history?fromMs=${from}&toMs=${to}&limit=30`,{ip:'192.0.2.6'}),env(database));
 assert.equal(response.status,200);const body=await response.json();
 assert.equal(body.range.returned,1);assert.equal(body.rows[0].slotMs,slot);
 response=await worker.fetch(request(`/history?fromMs=${now-13*60*60*1000}&toMs=${to}`,{ip:'192.0.2.7'}),env(db()));
 assert.equal(response.status,400);assert.equal((await response.json()).error,'HISTORY_RANGE_TOO_LARGE');
 response=await worker.fetch(request('/history?limit=121',{ip:'192.0.2.8'}),env(db()));
 assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_LIMIT');
});

test('D1 failures are generic and per-isolate rate limiting blocks before D1',async()=>{
 let response=await worker.fetch(request('/state',{ip:'192.0.2.9'}),env(db({fail:true})));
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'INTELLIGENCE_READ_FAILED'});
 const database=db(),limited={MARKET_HISTORY:database,INTELLIGENCE_READ_TOKEN:token,INTELLIGENCE_RATE_LIMIT_PER_MINUTE:'1'};
 assert.equal((await worker.fetch(request('/state',{ip:'192.0.2.10'}),limited)).status,200);
 response=await worker.fetch(request('/state',{ip:'192.0.2.10'}),limited);
 assert.equal(response.status,429);assert.equal((await response.json()).error,'RATE_LIMITED');
 assert.equal(database.statements.length,1);
});
