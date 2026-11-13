import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {generateDescriptiveSignals} from '../cloudflare/signal-engine.mjs';

const at=Date.parse('2026-10-16T01:10:00Z');
function rows(){return [0,1,2].map(i=>{
 const t=at-(2-i)*300000,iso=new Date(t).toISOString();
 const metric=value=>({value,status:'LIVE',marketTime:iso,fetchedAt:iso,availableAt:iso,timeBasis:'SOURCE_TRADE_TIME'});
 return {observed_at_ms:t,available_at_ms:t,trading_day:'20261016',quality:{futuresCode:'FICTIONAL'},metrics:{
  'samsung.price':metric(90+i*10),'samsung.volume':metric(100+i*i*100),
  'skHynix.price':metric(100+i*5),'futures.price':metric(100+i*2),'futures.openInterest':metric(1000+i*10),
  'program.totalNet':metric(100+i*i*100),'samsung.foreignFlow':metric(100+i*i*10)}};
});}
function run(file,rows,current=rows.at(-1)){
 const c=vm.createContext({console,Date,URL,Request,Response,TextEncoder});
 vm.runInContext(readFileSync(new URL(`../cloudflare/${file}`,import.meta.url),'utf8').replace('export default {','const worker = {'),c);
 c.rows=structuredClone(rows);
 c.current=structuredClone(current);
 return JSON.parse(JSON.stringify(vm.runInContext('historyFeatures(current,rows,[])',c)));
}
const withoutQuality=value=>Array.isArray(value)?value.map(withoutQuality):value&&typeof value==='object'?
 Object.fromEntries(Object.entries(value).filter(([key])=>key!=='quality').map(([key,v])=>[key,withoutQuality(v)])):value;
for(const file of ['market-relay-worker.js','feature-validation-worker.js']){
 test(`${file}: volatility includes the explicit current point exactly once with or without its stored history row`,()=>{
  const data=rows(),before=structuredClone(data);
  const present=run(file,data),absent=run(file,data.slice(0,-1),data.at(-1));
  assert.deepEqual(absent,present);
  const value=absent.windows['5m'].realizedVolatility.samsung;
  assert.equal(value.status,'OK');assert.equal(value.sampleCount,1);
  assert.equal(value.value,Math.abs(Math.log(110/100)*100));
  assert.deepEqual(data,before);
 });
 test(`${file}: unverified historical baselines cap return, acceleration and volatility without changing numbers`,()=>{
  const original=rows(),before=structuredClone(original),verified=run(file,original);
  for(const index of [0,1]){
   const mixed=structuredClone(original);
   for(const metric of Object.values(mixed[index].metrics))metric.status='RECENT_FETCH';
   const result=run(file,mixed),w=result.windows['5m'],base=verified.windows['5m'];
   const derived=[w.momentumAcceleration.samsung,w.volumeAcceleration.samsung,w.acceleration['futures.openInterest']];
   const originals=[base.momentumAcceleration.samsung,base.volumeAcceleration.samsung,base.acceleration['futures.openInterest']];
   if(index===1){derived.push(w.metrics['samsung.price'],w.volumeRate.samsung,w.realizedVolatility.samsung,w.futuresPosition);
    originals.push(base.metrics['samsung.price'],base.volumeRate.samsung,base.realizedVolatility.samsung,base.futuresPosition);}
   for(let i=0;i<derived.length;i++){
    assert.equal(derived[i].quality,'UNVERIFIED_TIME');
    assert.equal(derived[i].value,originals[i].value);
    assert.equal(derived[i].status,originals[i].status);
   }
   assert.equal(result.bucketChanges.samsung.foreignFlow.quality,'UNVERIFIED_TIME');
   assert.equal(result.bucketChanges.samsung.foreignFlow.acceleration,verified.bucketChanges.samsung.foreignFlow.acceleration);
   assert.equal(result.intraday.returns.samsung.quality,index===0?'UNVERIFIED_TIME':'VERIFIED');
   assert.deepEqual(withoutQuality(result),withoutQuality(verified));
   const signals=generateDescriptiveSignals(result,{engineGitSha:'abcdef0',generatedAt:result.inputCutoff});
   const program=signals.find(s=>s.horizon==='5m'&&s.signal_type==='PROGRAM_BUYING_ACCELERATING');
   assert.equal(program.data_quality.ceiling,'UNVERIFIED_TIME');
   assert.equal(program.confidence.ceiling,'MEDIUM');
  }
  assert.deepEqual(original,before);
 });
 test(`${file}: source-aligned program deltas and acceleration retain the quality of used source points`,()=>{
  const data=rows();data[1].metrics['program.totalNet'].status='RECENT_FETCH';
  const w=run(file,data).windows['5m'];
  assert.equal(w.metrics['program.totalNet'].value,300);
  assert.equal(w.metrics['program.totalNet'].quality,'UNVERIFIED_TIME');
  assert.equal(w.acceleration['program.totalNet'].quality,'UNVERIFIED_TIME');
 });
}
