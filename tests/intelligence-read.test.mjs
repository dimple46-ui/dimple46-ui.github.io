import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/intelligence-read-worker.mjs';

const now=Date.now(),slot=Math.floor((now-120000)/120000)*120000;
const observation={slot_ms:slot,observed_at_ms:slot+1000,available_at_ms:slot+1000,trading_day:'20261007',
 schema_version:1,quality_version:'test',pipeline_status:'OK',
 metrics_json:JSON.stringify({'samsung.price':{value:null,status:'STALE',quality:'STALE_INPUT'},
  'skHynix.price':{value:100,status:'OK',quality:'VERIFIED'},
  'program.totalNet':{value:5,status:'OK',quality:'VERIFIED'}}),
 quality_json:JSON.stringify({sourceErrors:[{source:'PROGRAM',category:'STALE'}]})};
const compact={encodingVersion:1,featureVersion:2,codes:{},order:{},windows:{}};
const validation={featureVersion:2,qualityCeiling:'UNVERIFIED_TIME',nullRatio:0.5};
const token='super-secret-credential-123';
const feature={slot_ms:slot,feature_version:2,observed_at_ms:slot+1000,trading_day:'20261007',
 engine_git_sha:'abcdef0',engine_source_sha256:'a'.repeat(64),generated_at_ms:slot+2000,input_cutoff_ms:slot+1000,
 quality_ceiling:'UNVERIFIED_TIME',generation_status:'SUCCESS',compact_features_json:JSON.stringify(compact),
 validation_json:JSON.stringify(validation)};

function db({badFeature=false,fail=false,pending=false}={}){
 const statements=[];
 return {statements,prepare(sql){statements.push(sql);assert.match(sql.trim(),/^SELECT\b/);
  const execute=async()=>{
   if(pending) return new Promise(()=>{});
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
const providerLimiter=(success=true)=>({calls:[],async limit(input){this.calls.push(input);return {success};}});
const env=(database,overrides={})=>({MARKET_HISTORY:database,INTELLIGENCE_READ_TOKEN:token,
 INTELLIGENCE_RATE_LIMIT_PER_MINUTE:'100',INTELLIGENCE_WORKER_GIT_SHA:'abcdef0',
 CF_VERSION_METADATA:{id:'deployment-test'},INTELLIGENCE_RATE_LIMITER:providerLimiter(),...overrides});

test('authentication and methods are rejected before any D1 access',async()=>{
 const database=db();
 assert.equal((await worker.fetch(new Request('https://candidate/health'),env(database))).status,401);
 assert.equal((await worker.fetch(new Request('https://candidate/health',{headers:{Authorization:'Bearer wrong'}}),env(database))).status,401);
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
 assert.equal(body.metadata.feature_version,2);assert.equal(body.metadata.pipeline_status,'OK');
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
 assert.equal(body.metadata.schema_version,1);assert.equal(body.metadata.input_cutoff,new Date(cutoff).toISOString());
 const future=await worker.fetch(request(`/state?cutoffMs=${now+60000}`,{ip:'192.0.2.2'}),env(db()));
 assert.equal(future.status,400);assert.equal((await future.json()).error,'INVALID_CUTOFF');
});

test('features enforce version and stored identity integrity',async()=>{
 let response=await worker.fetch(request('/features?featureVersion=2',{ip:'192.0.2.3'}),env(db()));
 assert.equal(response.status,200);let body=await response.json();
 assert.equal(body.feature.featureVersion,2);assert.equal(body.feature.inputCutoffMs,slot+1000);
 assert.equal(body.metadata.feature_version,2);assert.equal(body.metadata.quality,'UNVERIFIED_TIME');
 response=await worker.fetch(request('/features?featureVersion=3',{ip:'192.0.2.4'}),env(db()));
 assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_FEATURE_VERSION');
 response=await worker.fetch(request('/features',{ip:'192.0.2.5'}),env(db({badFeature:true})));
 assert.equal(response.status,409);assert.equal((await response.json()).error,'STORED_FEATURE_INTEGRITY_ERROR');
 response=await worker.fetch(request('/features?ticker=035420',{ip:'192.0.2.16'}),env(db()));
 assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_TICKER');
});

test('state accepts only Samsung, SK Hynix or the explicit combined scope',async()=>{
 let response=await worker.fetch(request('/state?ticker=005930',{ip:'192.0.2.17'}),env(db()));
 assert.equal(response.status,200);let body=await response.json();
 assert.equal(body.scope.ticker,'005930');assert.ok('samsung.price' in body.state.metrics);
 assert.ok(!('skHynix.price' in body.state.metrics));assert.ok('program.totalNet' in body.state.metrics);
 response=await worker.fetch(request('/state?ticker=035420',{ip:'192.0.2.18'}),env(db()));
 assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_TICKER');
});

test('history rejects unbounded ranges and returns chronological read-only rows',async()=>{
 const from=now-60*60*1000,to=now-1000,database=db();
 let response=await worker.fetch(request(`/history?ticker=005930&fromMs=${from}&toMs=${to}&limit=30`,{ip:'192.0.2.6'}),env(database));
 assert.equal(response.status,200);const body=await response.json();
 assert.equal(body.range.returned,1);assert.equal(body.rows[0].slotMs,slot);
 assert.equal(body.scope.ticker,'005930');assert.ok('samsung.price' in body.rows[0].metrics);
 assert.ok(!('skHynix.price' in body.rows[0].metrics));assert.ok('program.totalNet' in body.rows[0].metrics);
 response=await worker.fetch(request(`/history?ticker=005930&fromMs=${now-13*60*60*1000}&toMs=${to}`,{ip:'192.0.2.7'}),env(db()));
 assert.equal(response.status,400);assert.equal((await response.json()).error,'HISTORY_RANGE_TOO_LARGE');
 response=await worker.fetch(request('/history?ticker=005930&limit=121',{ip:'192.0.2.8'}),env(db()));
 assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_LIMIT');
 response=await worker.fetch(request('/history',{ip:'192.0.2.11'}),env(db()));
 assert.equal(response.status,400);assert.equal((await response.json()).error,'TICKER_REQUIRED');
 response=await worker.fetch(request('/history?ticker=035420',{ip:'192.0.2.12'}),env(db()));
 assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_TICKER');
});

test('provider rate limit is mandatory and rejects before D1',async()=>{
 const database=db();
 let response=await worker.fetch(request('/state',{ip:'192.0.2.13'}),env(database,{INTELLIGENCE_RATE_LIMITER:undefined}));
 assert.equal(response.status,503);assert.equal((await response.json()).error,'PROVIDER_RATE_LIMIT_UNAVAILABLE');
 assert.equal(database.statements.length,0);
 response=await worker.fetch(request('/state',{ip:'192.0.2.14'}),env(database,{INTELLIGENCE_RATE_LIMITER:providerLimiter(false)}));
 assert.equal(response.status,429);assert.equal((await response.json()).error,'RATE_LIMITED');
 assert.equal(database.statements.length,0);
});

test('D1 failures, deadlines and per-isolate limits fail closed',async()=>{
 let response=await worker.fetch(request('/state',{ip:'192.0.2.9'}),env(db({fail:true})));
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'INTELLIGENCE_READ_FAILED'});
 response=await worker.fetch(request('/state',{ip:'192.0.2.15'}),env(db({pending:true}),{INTELLIGENCE_QUERY_TIMEOUT_MS:'100'}));
 assert.equal(response.status,504);assert.equal((await response.json()).error,'QUERY_TIMEOUT');
 const database=db(),limited=env(database,{INTELLIGENCE_RATE_LIMIT_PER_MINUTE:'1'});
 assert.equal((await worker.fetch(request('/state',{ip:'192.0.2.10'}),limited)).status,200);
 response=await worker.fetch(request('/state',{ip:'192.0.2.10'}),limited);
 assert.equal(response.status,429);assert.equal((await response.json()).error,'RATE_LIMITED');
 assert.equal(database.statements.length,1);
});
