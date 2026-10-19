import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../cloudflare/intelligence-read-worker.mjs';
const cutoff=Date.now()-2000,day=ms=>new Date(ms+9*3600000).toISOString().slice(0,10).replaceAll('-','');
const token='fictional-summary-token';
const path=`/summary?cutoffMs=${cutoff}&maxObservationAgeMs=180000&maxFeatureAgeMs=300000`;
function db({featureMode='normal',stateFail=false,featureAge=60000}={}){
 const queries=[];
 return {queries,prepare(sql){assert.match(sql.trim(),/^SELECT\b/);queries.push({sql,params:[]});
 const execute=async()=>{
  const observation=sql.includes('market_observations');
  if(!observation&&featureMode==='pending')return new Promise(()=>{});
  if((observation&&stateFail)||(!observation&&featureMode==='failure'))throw new Error('PRIVATE_SENTINEL_DB_ERROR');
  const featureTime=cutoff-featureAge;
  const row=observation?{slot_ms:cutoff-2000,observed_at_ms:cutoff-1000,available_at_ms:cutoff-500,
   trading_day:day(cutoff-1000),schema_version:1,pipeline_status:'DEGRADED',
   metrics_json:JSON.stringify({'samsung.price':{value:100,status:'LIVE'},'skHynix.price':{value:null,status:'STALE'}}),
   quality_json:JSON.stringify({dataQuality:{issues:[{path:'program',status:'STALE',detail:'PRIVATE_SENTINEL'}],unverifiedMarketTimes:['futures.kospi200']}})}:
   {slot_ms:featureTime,feature_version:2,observed_at_ms:featureTime,input_cutoff_ms:featureTime,generated_at_ms:featureTime+1,
    trading_day:day(featureTime),engine_git_sha:'abcdef0',engine_source_sha256:'a'.repeat(64),quality_ceiling:'UNVERIFIED_TIME',
    generation_status:'SUCCESS',compact_features_json:featureMode==='corrupt'?'not-json':JSON.stringify({featureVersion:2}),
    validation_json:JSON.stringify({featureVersion:2})};
  return {success:true,results:!observation&&featureMode==='missing'?[]:[row],meta:{rows_read:1,rows_written:0,changes:0,duration:0.2}};
 };
 return {all:execute,bind(...params){queries.at(-1).params=params;return {all:execute};}};
 }};
}
function env(database,overrides={}){return {MARKET_HISTORY:database,INTELLIGENCE_READ_TOKEN:token,
 INTELLIGENCE_WORKER_GIT_SHA:'abcdef0',INTELLIGENCE_RATE_LIMIT_PER_MINUTE:'600',
 INTELLIGENCE_RATE_LIMITER:{async limit(){return {success:true};}},...overrides};}
function req(p=path,overrides={}){return new Request(`https://candidate${p}`,{headers:{Authorization:`Bearer ${token}`},...overrides});}
test('summary reuses auth/method/provider gates before D1 and is GET-only',async()=>{
 const database=db();
 for(const request of [new Request(`https://candidate${path}`),req(path,{headers:{Authorization:'Bearer wrong'}})])
  assert.equal((await worker.fetch(request,env(database))).status,401);
 assert.equal((await worker.fetch(req(path,{method:'POST'}),env(database))).status,405);
 assert.equal((await worker.fetch(req(),env(database,{INTELLIGENCE_RATE_LIMITER:{async limit(){return {success:false};}}}))).status,429);
 assert.equal(database.queries.length,0);
});
test('summary uses exactly two bounded read-only queries and preserves separate age/cutoff/quality',async()=>{
 const database=db(),r=await worker.fetch(req(),env(database));assert.equal(r.status,200);const b=await r.json();
 assert.equal(database.queries.length,2);assert.ok(database.queries.every(q=>q.sql.includes('LIMIT 1')&&q.params.includes(cutoff)));
 assert.equal(b.readOnly,true);assert.equal(b.release.serviceReleaseVersion,3);assert.equal(b.release.workerGitSha,'abcdef0');
 assert.equal(b.observation.ageMs,1000);assert.equal(b.features.ageMs,60000);assert.equal(b.features.quality,'UNVERIFIED_TIME');
 assert.equal(b.generatedAtMs>=b.evaluationReferenceMs,true);assert.equal(b.features.inputCutoffMs,cutoff-60000);
 assert.equal(b.sourceQuality.reasonCodes.includes('PROGRAM_STALE'),true);assert.equal(b.observation.pipelineStatus,'DEGRADED');
 assert.equal(b.queryMeta.observation.rowsWritten,0);assert.equal(b.queryMeta.feature.rowsWritten,0);
 for(const k of ['signals','portfolio','decision'])assert.equal(b.capabilities[k],'UNAVAILABLE');
 assert.equal(r.headers.get('Cache-Control'),'no-store');assert.ok(!JSON.stringify(b).includes('PRIVATE_SENTINEL'));
});
test('missing/corrupt/failed/old Feature cannot destroy available observation or become current',async()=>{
 for(const mode of ['missing','corrupt','failure','old']){
  const database=db({featureMode:mode==='old'?'normal':mode,featureAge:mode==='old'?600000:60000});
  const r=await worker.fetch(req(),env(database));assert.equal(r.status,200);const b=await r.json();
  assert.equal(b.observation.status,'AVAILABLE');assert.equal(b.features.status,'UNAVAILABLE');
  assert.equal(b.featureRead.status,mode==='missing'?'NOT_FOUND':mode==='old'?'OK':'FAILED');
  if(mode==='old')assert.equal(b.features.ageMs,600000);else assert.equal(b.queryMeta.feature,null);
  assert.ok(!JSON.stringify(b).includes('PRIVATE_SENTINEL'));
 }
});
test('missing/oversized/duplicate/unknown/future/ticker query errors reject before D1',async()=>{
 for(const p of ['/summary',path+'&sql=DROP',path+'&ticker=035420',path+'&cutoffMs=1',
 path.replace('180000','900001'),path.replace(`cutoffMs=${cutoff}`,`cutoffMs=${Date.now()+86400000}`)]){
  const database=db();assert.equal((await worker.fetch(req(p),env(database))).status,400);assert.equal(database.queries.length,0);
 }
});
test('observation failure remains sanitized failure; auth token and source payload never leak',async()=>{
 const database=db({stateFail:true});const r=await worker.fetch(req(),env(database));assert.equal(r.status,503);
 assert.deepEqual(await r.json(),{error:'INTELLIGENCE_READ_FAILED'});assert.equal(database.queries.length,1);
});

test('existing request deadline also bounds a pending summary Feature read',async()=>{
 const database=db({featureMode:'pending'});const r=await worker.fetch(req(),env(database,{INTELLIGENCE_QUERY_TIMEOUT_MS:'100'}));
 assert.equal(r.status,504);assert.deepEqual(await r.json(),{error:'QUERY_TIMEOUT'});assert.equal(database.queries.length,2);
});

test('actual SQLite selection excludes later-generated Features before LIMIT, including slot and summary reads',async()=>{
 const sqlite=new DatabaseSync(':memory:'),queries=[];
 try{
  for(const file of ['0001_market_history.sql','0002_feature_runs.sql'])
   sqlite.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
  const earlier=cutoff-60000,later=cutoff-1000;
  for(const slot of [earlier,later]) sqlite.prepare('INSERT INTO market_observations VALUES(?,?,?,?,?,?,?,?,?,?)').run(
   slot,slot,slot,day(slot),1,'fixture','OK',JSON.stringify({'samsung.price':{value:100,status:'OK'}}),'{}','{}');
  const insert=sqlite.prepare('INSERT INTO feature_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const [slot,generated] of [[earlier,earlier+1],[later,cutoff+1]])
   insert.run(slot,2,slot,day(slot),'abcdef0','a'.repeat(64),generated,slot,'UNVERIFIED_TIME','SUCCESS',
    JSON.stringify({featureVersion:2}),JSON.stringify({featureVersion:2}));
  const database={prepare(sql){assert.match(sql.trim(),/^SELECT\b/);queries.push(sql);
   const all=async(...params)=>{const rows=sqlite.prepare(sql).all(...params).map(r=>({...r}));
    return {success:true,results:rows,meta:{rows_read:rows.length,rows_written:0,changes:0}};};
   return {all:()=>all(),bind:(...params)=>({all:()=>all(...params)})};}};
  const featurePath=`/features?cutoffMs=${cutoff}`;
  let response=await worker.fetch(req(featurePath),env(database));
  assert.equal(response.status,200);let body=await response.json();
  assert.equal(body.feature.inputCutoffMs,earlier);
  response=await worker.fetch(req(featurePath+`&slotMs=${later}`),env(database));
  assert.equal(response.status,404);assert.equal((await response.json()).error,'FEATURES_NOT_FOUND');
  response=await worker.fetch(req(featurePath.replace(String(cutoff),String(cutoff+1))),env(database));
  assert.equal(response.status,200);body=await response.json();
  assert.equal(body.feature.inputCutoffMs,later);
  response=await worker.fetch(req(),env(database));assert.equal(response.status,200);body=await response.json();
  assert.equal(body.features.status,'AVAILABLE');assert.equal(body.features.inputCutoffMs,earlier);
  assert.equal(body.features.ageMs,60000);assert.equal(body.observation.status,'AVAILABLE');
  assert.equal(body.queryMeta.feature.rowsWritten,0);
  assert.ok(queries.every(sql=>sql.trim().startsWith('SELECT')));
 }finally{sqlite.close();}
});
