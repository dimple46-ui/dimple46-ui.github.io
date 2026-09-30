import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../cloudflare/market-relay-worker.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ console, Date, URL, TextEncoder });
vm.runInContext(source.replace('export default {', 'const worker = {'), ctx);
const now = Date.parse('2026-09-30T14:48:00+09:00');
const run = expression => vm.runInContext(expression, ctx);
test('closed aliases and invalid timestamps cannot become LIVE', () => {
  for (const status of ['CLOSE', 'CLOSED']) assert.equal(run(`continuousStatus({marketStatus:'${status}'}, '${new Date(now).toISOString()}', 300, ${now})`), 'CLOSED');
  assert.equal(run(`continuousStatus({}, null, 300, ${now})`), 'UNKNOWN');
  assert.equal(run(`continuousStatus({}, '${new Date(now + 120000).toISOString()}', 300, ${now})`), 'INVALID_TIME');
  assert.equal(run(`continuousStatus({}, '${new Date(now - 301000).toISOString()}', 300, ${now})`), 'STALE');
});
test('scheduled flow is current after 18 minutes, historical on another day', () => {
  const value = `{latest:{inputTimeKst:'14:30'}, fetchedAt:'2026-09-30T05:36:18Z'}`;
  assert.equal(run(`stockFlowMeta(${value}, '20260930', null, ${now}).status`), 'CURRENT_BUCKET');
  assert.equal(run(`stockFlowMeta(${value}, '20260929', null, ${now}).status`), 'HISTORICAL');
  assert.equal(run(`stockFlowMeta(null, '20260930', null, ${Date.parse('2026-09-30T09:00:00+09:00')}).status`), 'NOT_DUE');
});
test('missing investor and program times do not become LIVE', () => {
  const meta = run(`buildDataMeta({kospiInvestors:{}, program:{}}, {}, {data:{}}, ${now})`);
  assert.equal(meta.kospiInvestors.status, 'UNKNOWN');
  assert.equal(meta.program.status, 'UNKNOWN');
  assert.equal(meta.program.maxAgeSeconds, 300);
});
test('normalizations preserve raw values and expose signed/scaled values', () => {
  const stock = run(`compactStock({price:269500, previousClose:272500, change:3000})`);
  assert.equal(stock.change, 3000);
  assert.equal(stock.signedChange, -3000);
  assert.equal(stock.signedChangeRate, -1.1);
  assert.equal(run(`compactIndex({value:108182}).normalizedValue`), 1081.82);
});
test('delayed estimate bucket is retried, complete bucket is cached', async () => {
  run(`kisGet = async () => ({output2:[{bsop_hour_gb:'4', frgn_fake_ntby_qty:'1'}]})`);
  await run(`getStockFlowEstimate({}, 'test', '005930', ${now})`);
  assert.equal(run('memoryCache.size'), 0);
  run(`kisGet = async () => ({output2:[{bsop_hour_gb:'5', frgn_fake_ntby_qty:'1'}]})`);
  await run(`getStockFlowEstimate({}, 'test', '005930', ${now})`);
  assert.equal(run('memoryCache.size'), 1);
});
test('calendar rejects a response for another date', async () => {
  run(`kisGet = async () => ({output:[{bass_dt:'20260929', opnd_yn:'Y'}]})`);
  await assert.rejects(run(`getKoreaMarketCalendar({}, 'test', ${now})`), /missing requested date/);
});
