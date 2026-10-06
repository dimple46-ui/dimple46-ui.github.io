import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const migration1=readFileSync(new URL('../migrations/0001_market_history.sql',import.meta.url),'utf8');
const migration2=readFileSync(new URL('../migrations/0002_feature_runs.sql',import.meta.url),'utf8');
const source=readFileSync(new URL('../cloudflare/feature-validation-worker.js',import.meta.url),'utf8');
const start=Date.parse('2026-10-01T09:00:00+09:00');

function binding(db,statements=[]){
 return {prepare(sql){statements.push(sql);return {bind(...params){return {
  async run(){const result=db.prepare(sql).run(...params),changes=Number(result.changes);return {
   success:true,meta:{duration:0.1,changes,rows_read:0,rows_written:changes,served_by:'local-test'}};},
  async all(){const results=db.prepare(sql).all(...params);return {
   success:true,results,meta:{duration:0.2,rows_read:results.length,rows_written:0,served_by:'local-test'}};}
 };}};}};
}
function worker(){
 const context=vm.createContext({console,Date,Request,Response,TextEncoder,Set,URL});
 vm.runInContext(source.replace('export default {','const worker = {'),context);
 return vm.runInContext('worker',context);
}
function metric(value,at,{status='LIVE',timeBasis='SOURCE_TRADE_TIME',marketTime=at}={}){
 return {value,source:'TEST',status,marketTime,fetchedAt:at,timeBasis,availableAt:at};
}
function observation(minute){
 const observed=start+minute*60000,at=new Date(observed).toISOString(),metrics={};
 for(const stock of ['samsung','skHynix']){
  const multiple=stock==='samsung'?1:2;
  metrics[`${stock}.price`]=metric(100+minute*multiple,at);
  metrics[`${stock}.previousClose`]=metric(100,at);
  metrics[`${stock}.open`]=metric(100,at);
  metrics[`${stock}.high`]=metric(200,at);
  metrics[`${stock}.low`]=metric(90,at);
  metrics[`${stock}.volume`]=metric(minute*100,at);
  metrics[`${stock}.tradingValue`]=metric(minute*10000,at);
  metrics[`${stock}.foreignFlow`]=metric(null,at,{status:'NOT_DUE'});
  metrics[`${stock}.institutionFlow`]=metric(null,at,{status:'NOT_DUE'});
 }
 metrics['kospi.price']=metric(100+minute/2,at);
 metrics['kospi200.price']=metric(100+minute/2,at);
 for(const name of ['foreigner','institution','individual']) metrics[`market.${name}`]=metric(
  name==='foreigner'?minute*10:name==='institution'?-minute*10:0,at);
 for(const name of ['arbitrageNet','nonArbitrageNet','totalNet']) metrics[`program.${name}`]=metric(
  name==='arbitrageNet'?0:minute*5,at);
 for(const [name,value] of Object.entries({price:100+minute,openInterest:1000+minute,openInterestChange:minute,
  basis:minute/10,marketBasis:minute/10})) metrics[`futures.${name}`]=metric(value,at,{status:'RECENT_FETCH',timeBasis:'FETCH_TIME_NO_EXCHANGE_TIMESTAMP'});
 for(const name of ['foreign','institution','individual']) metrics[`futures.${name}Net`]=metric(
  name==='foreign'?minute:name==='institution'?-minute:0,at,{status:'RECENT_FETCH',timeBasis:'FETCH_TIME_NO_EXCHANGE_TIMESTAMP'});
 return {slot_ms:observed,observed_at_ms:observed,available_at_ms:observed,trading_day:'20261001',schema_version:1,
  quality_version:'test',pipeline_status:'OK',metrics_json:JSON.stringify(metrics),
  quality_json:JSON.stringify({dataQuality:null,sourceErrors:[],futuresCode:'A01612'}),features_json:'{"version":1}'};
}
function setup(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys = ON');db.exec(migration1);db.exec(migration2);
 const insert=db.prepare(`INSERT INTO market_observations
  (slot_ms,observed_at_ms,available_at_ms,trading_day,schema_version,quality_version,pipeline_status,metrics_json,quality_json,features_json)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
 for(let minute=0;minute<=40;minute+=2){const row=observation(minute);insert.run(row.slot_ms,row.observed_at_ms,row.available_at_ms,
  row.trading_day,row.schema_version,row.quality_version,row.pipeline_status,row.metrics_json,row.quality_json,row.features_json);}
 return db;
}

test('feature_runs migration is additive, versioned and JSON constrained',()=>{
 const db=setup();try{
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM market_observations').get().n,21);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM feature_runs').get().n,0);
  assert.throws(()=>db.prepare(`INSERT INTO feature_runs VALUES
   (?,?,?,?,?,?,?,?,?,?,?,?)`).run(start,2,start,'20261001','abcdef0','a'.repeat(64),start,start,'VERIFIED','SUCCESS','{}','not-json'));
  db.exec(migration2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='feature_runs'").get().n,1);
 }finally{db.close();}
});

test('candidate v2 writes one immutable compact row without touching v1 observations',async()=>{
 const db=setup(),statements=[];try{
  const env={MARKET_HISTORY:binding(db,statements),VALIDATION_TOKEN:'test',FEATURE_V2_WRITE_ENABLED:'true',
   FEATURE_ENGINE_GIT_SHA:'4156d94829d29085f24f02b29b8672ed815317cd'};
  const request=()=>new Request('https://test/feature-runs',{method:'POST',headers:{Authorization:'Bearer test'}});
  let response=await worker().fetch(request(),env);assert.equal(response.status,200);
  const first=await response.json();assert.equal(first.mode,'CANDIDATE_COMPACT_WRITE');assert.equal(first.status,'INSERTED');
  assert.equal(first.featureVersion,2);assert.equal(first.writeMeta.rowsWritten,1);assert.equal(first.stored.generationStatus,'SUCCESS');
  assert.ok(first.compactFeaturesBytes<first.fullFeatureBytes*.3);assert.ok(first.reductionPct>70);
  const stored=db.prepare('SELECT * FROM feature_runs').get();
  assert.equal(stored.feature_version,2);assert.equal(stored.engine_git_sha,env.FEATURE_ENGINE_GIT_SHA);
  const compact=JSON.parse(stored.compact_features_json);
  assert.equal(compact.encodingVersion,1);assert.equal(compact.featureVersion,2);
  assert.ok(compact.codes.status.includes('INSUFFICIENT_HISTORY'));
  const sameTimeMetric=compact.sameTimeHistorical.windows['5d'].metrics[0];
  assert.equal(sameTimeMetric[0],null);assert.equal(compact.codes.status[sameTimeMetric[1]],'INSUFFICIENT_HISTORY');
  assert.equal(JSON.parse(stored.validation_json).windowsAvailable.length,4);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM market_observations WHERE features_json=?').get('{"version":1}').n,21);
  const generated=stored.generated_at_ms;
  response=await worker().fetch(request(),{...env,FEATURE_ENGINE_GIT_SHA:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'});
  assert.equal(response.status,200);const retry=await response.json();assert.equal(retry.status,'EXISTS');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM feature_runs').get().n,1);
  const after=db.prepare('SELECT * FROM feature_runs').get();assert.equal(after.generated_at_ms,generated);
  assert.equal(after.engine_git_sha,env.FEATURE_ENGINE_GIT_SHA);
  assert.ok(statements.some(sql=>sql.includes('INSERT INTO feature_runs')));
  assert.ok(statements.every(sql=>!sql.includes('UPDATE market_observations')));
 }finally{db.close();}
});

test('rollback switch prevents D1 reads and compact writes',async()=>{
 const db=setup(),statements=[];try{
  const response=await worker().fetch(new Request('https://test/feature-runs',{method:'POST',headers:{Authorization:'Bearer test'}}),
   {MARKET_HISTORY:binding(db,statements),VALIDATION_TOKEN:'test',FEATURE_V2_WRITE_ENABLED:'false',
    FEATURE_ENGINE_GIT_SHA:'4156d94829d29085f24f02b29b8672ed815317cd'});
  assert.equal(response.status,403);assert.equal((await response.json()).error,'FEATURE_WRITE_DISABLED');
  assert.equal(statements.length,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM feature_runs').get().n,0);
 }finally{db.close();}
});
