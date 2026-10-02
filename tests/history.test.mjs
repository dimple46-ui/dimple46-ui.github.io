import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../cloudflare/market-relay-worker.js',import.meta.url),'utf8');
const migration=readFileSync(new URL('../migrations/0001_market_history.sql',import.meta.url),'utf8');
function setup(){
 const db=new DatabaseSync(':memory:');db.exec(migration);
 const binding={prepare(sql){return {bind(...params){return {
  async run(){const r=db.prepare(sql).run(...params);return {success:true,meta:{changes:Number(r.changes)}};},
  async first(){return db.prepare(sql).get(...params)??null;},
  async all(){return {success:true,results:db.prepare(sql).all(...params)};}
 };}};}};
 const ctx=vm.createContext({console,Date,URL,TextEncoder});
 vm.runInContext(source.replace('export default {','const worker = {'),ctx);
 ctx.env={MARKET_HISTORY:binding};
 return {db,ctx,run:s=>vm.runInContext(s,ctx)};
}
const start=Date.parse('2026-10-01T09:00:00+09:00');
function sample(minute){
 const at=new Date(start+minute*60000).toISOString();
 const meta={status:'LIVE',marketTime:at,fetchedAt:at,timeBasis:'SOURCE_TRADE_TIME'};
 const stock={price:100+minute,previousClose:100,open:100,high:200,low:90,volume:minute*100,tradingValue:minute*10000};
 return {relayUpdatedAt:at,sourceFetchedAt:at,koreaDate:'20261001',qualityVersion:'2026-10-01.1',pipelineStatus:'OK',
  stocks:{samsung:stock,skHynix:{...stock,price:100+minute*2}},indexes:{kospi:{normalizedValue:100+minute/2},kospi200:{normalizedValue:100+minute/2}},
  kospiInvestors:{summary:{foreigner:minute*10,institution:-minute*10,individual:0}},program:{arbitrageNet:0,nonArbitrageNet:minute*5,totalNet:minute*5},
  futures:{kospi200:{code:'A01612',price:100+minute,openInterest:1000+minute,basis:minute/10,marketBasis:minute/10}},
  futuresInvestors:{kospi200:{foreign:{netBuyQty:minute},institution:{netBuyQty:-minute},individual:{netBuyQty:0}}},
  stockFlowEstimates:{samsung:null,skHynix:null},dataMeta:{session:{status:'TRADING_DAY'},stocks:{samsung:meta,skHynix:meta},indexes:{kospi:meta,kospi200:meta},
   kospiInvestors:meta,program:meta,futures:{kospi200:meta},futuresInvestors:{kospi200:meta},stockFlowEstimates:{samsung:{status:'NOT_DUE'},skHynix:{status:'NOT_DUE'}}},sourceErrors:[]};
}
async function put(s,minute,p=sample(minute)){s.ctx.payload=p;return s.run('persistMarketHistory(env,payload)');}
test('real SQLite migration and 21 distinct observations produce past-only features',async()=>{
 const s=setup();try{
 for(let m=0;m<=40;m+=2) await put(s,m);
 assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM market_observations').get().n,21);
 const last=s.db.prepare('SELECT * FROM market_observations ORDER BY slot_ms DESC LIMIT 1').get();
 const f=JSON.parse(last.features_json);
 assert.equal(f.windows['5m'].actualElapsedSeconds,360);
 assert.ok(Math.abs(f.windows['5m'].metrics['samsung.price'].value-(140/134-1)*100)<1e-9);
 assert.equal(f.windows['10m'].metrics['market.foreigner'].value,100);
 assert.equal(f.windows['30m'].metrics['futures.openInterest'].value,30);
 assert.equal(f.windows['5m'].volumeAcceleration.samsung.value,0);
 assert.equal(f.sameTimeHistoricalAverage.status,'NOT_IMPLEMENTED');
 console.log('Measured JSON bytes per row:',Buffer.byteLength(last.metrics_json)+Buffer.byteLength(last.quality_json)+Buffer.byteLength(last.features_json));
 }finally{s.db.close();}
});
test('same two-minute slot is immutable and retries do not duplicate',async()=>{
 const s=setup();try{await put(s,2);const before=s.db.prepare('SELECT metrics_json FROM market_observations').get().metrics_json;
 await put(s,3);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM market_observations').get().n,1);
 assert.equal(s.db.prepare('SELECT metrics_json FROM market_observations').get().metrics_json,before);
 }finally{s.db.close();}
});
test('missing/STALE values never become zero deltas',async()=>{
 const s=setup();try{await put(s,0);const p=sample(10);p.dataMeta.program.status='STALE';p.stocks.samsung.price=null;
 await put(s,10,p);const f=JSON.parse(s.db.prepare('SELECT features_json FROM market_observations ORDER BY slot_ms DESC LIMIT 1').get().features_json);
 assert.equal(f.windows['10m'].metrics['samsung.price'].value,null);
 assert.equal(f.windows['10m'].metrics['program.totalNet'].value,null);
 }finally{s.db.close();}
});
test('future availability and missing baseline are rejected',()=>{
 const s=setup();try{s.ctx.payload=sample(40);const current=s.run('historyObservation(payload)');s.ctx.payload=sample(30);const previous=s.run('historyObservation(payload)');
 previous.available_at_ms=current.observed_at_ms+1;s.ctx.current=current;s.ctx.rows=[previous];
 assert.equal(s.run("historyFeatures(current,rows).windows['10m'].status"),'INSUFFICIENT_HISTORY');
 previous.available_at_ms=previous.observed_at_ms;previous.trading_day='20260930';
 assert.equal(s.run("historyFeatures(current,rows).windows['10m'].status"),'INSUFFICIENT_HISTORY');
 }finally{s.db.close();}
});
test('counter reset and futures rollover return null',async()=>{
 const s=setup();try{await put(s,10);const p=sample(20);p.stocks.samsung.volume=1;p.futures.kospi200.code='A01703';await put(s,20,p);
 const f=JSON.parse(s.db.prepare('SELECT features_json FROM market_observations ORDER BY slot_ms DESC LIMIT 1').get().features_json);
 assert.equal(f.windows['10m'].metrics['samsung.volume'].status,'COUNTER_RESET');
 assert.equal(f.windows['10m'].metrics['futures.price'].status,'CONTRACT_CHANGED');
 }finally{s.db.close();}
});
test('stock estimates are bucket deltas, never artificial 5m flows',async()=>{
 const s=setup();try{
 for(const m of [36,40,46,66]){const p=sample(m),bucket=m<65?'09:30':'10:00';
 p.stockFlowEstimates.samsung={latest:{foreignNetBuyQty:m<65?100:140,institutionNetBuyQty:0}};
 p.dataMeta.stockFlowEstimates.samsung={status:'CURRENT_BUCKET',marketTime:`2026-10-01T${bucket}:00+09:00`,fetchedAt:p.relayUpdatedAt};await put(s,m,p);}
 const f=JSON.parse(s.db.prepare('SELECT features_json FROM market_observations ORDER BY slot_ms DESC LIMIT 1').get().features_json);
 assert.equal(f.bucketChanges.samsung.foreignFlow.value,40);
 const earlier=JSON.parse(s.db.prepare('SELECT features_json FROM market_observations WHERE observed_at_ms=?').get(start+46*60000).features_json);
 assert.equal(earlier.windows['5m'].metrics['samsung.foreignFlow'].status,'UNCHANGED_BUCKET');
 assert.equal(earlier.windows['5m'].metrics['samsung.foreignFlow'].value,null);
 }finally{s.db.close();}
});
test('D1 failure is isolated; GitHub write still executes',async()=>{
 const s=setup();try{s.ctx.payload=sample(10);s.ctx.jobs=[];s.ctx.context={waitUntil:p=>s.ctx.jobs.push(p)};
 s.ctx.env.MARKET_HISTORY={prepare(){throw new Error('synthetic database failure');}};
 s.run(`let githubWrites=0; fetchLiveMarket=async()=>({data:{},ageMs:0}); enrichWithKis=async()=>({}); buildPayload=()=>payload; updateGithubFile=async()=>{githubWrites++;};`);
 await s.run('runRelay(env,context)');await Promise.all(s.ctx.jobs);
 assert.equal(s.run('githubWrites'),1);
 }finally{s.db.close();}
});
test('expiring synthetic D1 failure is bounded and isolated from GitHub write',async()=>{
 const s=setup();try{s.ctx.payload=sample(10);s.ctx.jobs=[];s.ctx.context={waitUntil:p=>s.ctx.jobs.push(p)};
 const observed=Date.parse(s.ctx.payload.relayUpdatedAt);
 s.ctx.env.HISTORY_FAILURE_TEST_UNTIL=new Date(observed+5*60000).toISOString();
 s.run(`let githubWrites=0; fetchLiveMarket=async()=>({data:{},ageMs:0}); enrichWithKis=async()=>({}); buildPayload=()=>payload; updateGithubFile=async()=>{githubWrites++;};`);
 await s.run('runRelay(env,context)');await Promise.all(s.ctx.jobs);
 assert.equal(s.run('githubWrites'),1);
 assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM market_observations').get().n,0);
 s.ctx.env.HISTORY_FAILURE_TEST_UNTIL=new Date(observed+16*60000).toISOString();
 assert.equal(s.run('historyFailureTestActive(env,payload.relayUpdatedAt ? Date.parse(payload.relayUpdatedAt) : Date.now())'),false);
 s.ctx.env.HISTORY_FAILURE_TEST_UNTIL=new Date(observed-1).toISOString();
 assert.equal(s.run('historyFailureTestActive(env,payload.relayUpdatedAt ? Date.parse(payload.relayUpdatedAt) : Date.now())'),false);
 }finally{s.db.close();}
});
test('unbound/disabled/holiday history does not write',async()=>{
 const s=setup();try{s.ctx.payload=sample(0);assert.equal((await s.run('persistMarketHistory({},payload)')).status,'DISABLED');
 assert.equal((await s.run('persistMarketHistory({...env,HISTORY_ENABLED:"false"},payload)')).status,'DISABLED');
 s.ctx.payload.dataMeta.session.status='HOLIDAY';assert.equal((await s.run('persistMarketHistory(env,payload)')).status,'SKIPPED_HOLIDAY');
 assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM market_observations').get().n,0);
 }finally{s.db.close();}
});
