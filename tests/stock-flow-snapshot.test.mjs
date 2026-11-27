import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStockFlowSnapshot} from '../scripts/validate-stock-flow-snapshot.mjs';

const asOfMs=Date.parse('2026-10-16T02:29:00Z');
function fixture() {
  const snapshot={schemaVersion:3,koreaDate:'20261016',relayUpdatedAt:'2026-10-16T02:28:46Z',
    pipelineStatus:'DEGRADED',sourceErrors:[],stockFlowEstimates:{},dataMeta:{stockFlowEstimates:{}}};
  for(const [stock,ticker,foreign,institution] of [
    ['samsung','005930',[-916000,-865000,-684000],[0,111000,-108000]],
    ['skHynix','000660',[-146000,-291000,-448000],[0,58000,-27000]]]) {
    const rows=['09:30','10:00','11:20'].map((time,i)=>({bucket:String(i+1),inputTimeKst:time,
      foreignNetBuyQty:foreign[i],institutionNetBuyQty:institution[i]}));
    snapshot.stockFlowEstimates[stock]={source:'KIS_OPEN_API',isEstimate:true,stockCode:ticker,
      businessDate:'20261016',scheduledBucket:'1120',rows,latest:{...rows.at(-1)}};
    snapshot.dataMeta.stockFlowEstimates[stock]={hasValue:true,status:'CURRENT_BUCKET',
      timeBasis:'SOURCE_SCHEDULED_BUCKET',marketTime:'2026-10-16T02:20:00Z'};
  }
  return snapshot;
}
const run=snapshot=>validateStockFlowSnapshot(snapshot,{asOfMs});

test('signed bucket arithmetic distinguishes delta difference from unequal-duration flow rates',()=>{
  const input=fixture(),copy=structuredClone(input),result=run(input);
  assert.equal(result.status,'PASS');assert.equal(result.pipelineStatus,'DEGRADED');
  assert.deepEqual(result.stocks.samsung.intervalMinutes,[30,80]);
  assert.deepEqual(result.stocks.samsung.flows.foreign.delta,[51000,181000]);
  assert.equal(result.stocks.samsung.flows.foreign.deltaDifference,130000);
  assert.deepEqual(result.stocks.skHynix.flows.institution.delta,[58000,-85000]);
  assert.equal(result.stocks.skHynix.flows.foreign.deltaDifference,-12000);
  assert.ok(result.stocks.skHynix.flows.foreign.rateChangeSharesPerMinute>0);
  assert.deepEqual(input,copy);
});
test('missing buckets wait; valid equal quantities are real zeros, not missing input',()=>{
  const missing=fixture();missing.stockFlowEstimates.samsung=null;
  assert.equal(run(missing).status,'WAITING_FOR_LIVE_DATA');
  const short=fixture(),value=short.stockFlowEstimates.samsung;
  value.rows=value.rows.slice(0,2);value.latest={...value.rows.at(-1)};value.scheduledBucket='1000';
  short.dataMeta.stockFlowEstimates.samsung.marketTime='2026-10-16T01:00:00Z';
  assert.equal(run(short).stocks.samsung.reason,'INSUFFICIENT_BUCKET_HISTORY');
  const equal=fixture();for(const row of equal.stockFlowEstimates.samsung.rows)row.institutionNetBuyQty=0;
  equal.stockFlowEstimates.samsung.latest.institutionNetBuyQty=0;
  assert.deepEqual(run(equal).stocks.samsung.flows.institution.delta,[0,0]);
  for(const bad of [null,'0',NaN,Infinity]) {
    const input=fixture();input.stockFlowEstimates.samsung.rows[0].institutionNetBuyQty=bad;
    assert.throws(()=>run(input),/INVALID_FLOW_QUANTITY/);
  }
});
test('stale quality, mixed days, future, duplicate, wrong identity and mismatched latest fail closed',()=>{
  for(const [mutate,code] of [
    [s=>s.dataMeta.stockFlowEstimates.samsung.status='STALE_BUCKET','UNUSABLE_FLOW_QUALITY'],
    [s=>s.stockFlowEstimates.samsung.businessDate='20261015','TRADING_DAY_MISMATCH'],
    [s=>s.relayUpdatedAt='2026-10-16T02:19:00Z','FUTURE_BUCKET'],
    [s=>s.stockFlowEstimates.samsung.rows[1]={...s.stockFlowEstimates.samsung.rows[0]},'UNORDERED_OR_DUPLICATE_BUCKET'],
    [s=>s.stockFlowEstimates.samsung.stockCode='000660','INVALID_FLOW_IDENTITY'],
    [s=>s.stockFlowEstimates.samsung.latest.foreignNetBuyQty=1,'LATEST_BUCKET_MISMATCH'],
    [s=>s.stockFlowEstimates.samsung.rows[0].foreignNetBuyQty=Number.MAX_SAFE_INTEGER,'FLOW_ARITHMETIC_OVERFLOW']]) {
    const snapshot=fixture();mutate(snapshot);assert.throws(()=>run(snapshot),new RegExp(code));
  }
  assert.throws(()=>validateStockFlowSnapshot(fixture(),{asOfMs:asOfMs-86400000}),/INVALID_SNAPSHOT_TIME/);
  assert.throws(()=>validateStockFlowSnapshot(fixture(),{asOfMs:asOfMs+86400000}),/TRADING_DAY_MISMATCH/);
});
