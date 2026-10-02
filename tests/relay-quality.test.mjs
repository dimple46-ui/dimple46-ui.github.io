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
  assert.equal(run(`stockFlowMeta({...${value}, businessDate:'20260929'}, '20260930', null, ${now}).status`), 'HISTORICAL');
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

const fixture = JSON.parse(readFileSync(new URL('./fixtures/closed-snapshot.json', import.meta.url), 'utf8'));
function evaluateSnapshot({ holiday = false, errors = [], program = fixture.program, nowMs = Date.parse(fixture.relayUpdatedAt) } = {}) {
  ctx.snapshotInput = { ...fixture, program, fetchedAt: fixture.sourceFetchedAt, indexes: Object.values(fixture.indexes), errors: [] };
  ctx.kisInput = { enabled: true, errors, data: { calendar: { korea: { date: '20260930', openDay: holiday ? 'N' : 'Y' } },
    stockFlowEstimates: fixture.stockFlowEstimates, futures: fixture.futures, futuresInvestors: fixture.futuresInvestors } };
  return run(`buildPayload(snapshotInput, 0, kisInput, ${nowMs})`);
}
test('production-shaped closed snapshot: closed prices, separate fetch and market times', () => {
  const p = evaluateSnapshot();
  assert.equal(p.dataMeta.stocks.samsung.status, 'CLOSED');
  assert.equal(p.dataMeta.program.status, 'CLOSED');
  assert.equal(p.dataMeta.indexes.kospi.marketTime, null);
  assert.equal(p.dataMeta.futures.kospi200.marketTime, null);
  assert.equal(p.dataMeta.stockFlowEstimates.samsung.status, 'CURRENT_BUCKET');
  assert.equal(p.pipelineStatus, 'OK');
  assert.equal(p.schemaVersion, 3);
  assert.equal(p.qualityVersion, '2026-10-01.1');
});
test('partial failure marks the affected source without destroying other data', () => {
  const p = evaluateSnapshot({ errors: [{source:'futures.kospi200', message:'synthetic failure'}] });
  assert.equal(p.pipelineStatus, 'DEGRADED');
  assert.equal(p.dataMeta.futures.kospi200.status, 'SOURCE_ERROR');
  assert.equal(p.stocks.samsung.price, fixture.stocks.samsung.price);
  assert.equal(p.dataMeta.stocks.samsung.status, 'CLOSED');
});
test('missing program time degrades the pipeline even without a source exception', () => {
  const p = evaluateSnapshot({program:{totalNet:0}});
  assert.equal(p.pipelineStatus, 'DEGRADED');
  assert.equal(p.dataMeta.program.status, 'UNKNOWN');
});
test('replaying yesterday does not carry ingestion freshness into today', () => {
  const p = evaluateSnapshot({nowMs:Date.parse('2026-10-01T09:00:00+09:00')});
  assert.equal(p.fresh, false);
  assert.equal(p.pipelineStatus, 'DEGRADED');
  assert.equal(p.dataMeta.session.status, 'UNKNOWN');
  assert.equal(p.dataMeta.stockFlowEstimates.samsung.status, 'HISTORICAL');
});
test('strict calendar and invalid date handling', () => {
  assert.equal(run(`kstIsoFromYmdHms('20260230', '090000')`), null);
  assert.equal(run(`kstIsoFromYmdHms('20260930', '240000')`), null);
  assert.equal(run(`koreaCalendarStatus({date:'20260930'}, ${now})`), 'UNKNOWN');
  assert.equal(evaluateSnapshot({holiday:true}).pipelineStatus, 'HOLIDAY');
});
test('confirmed holiday prevents KIS quote and estimate requests', async () => {
  run(`getKisToken = async () => 'test'; getKoreaMarketCalendar = async () => ({date:'20260930',openDay:'N'}); kisGet = async () => { throw new Error('should not request quotes'); };`);
  const result = await run(`enrichWithKis({KIS_APP_KEY:'test',KIS_APP_SECRET:'test'}, ${now})`);
  assert.equal(result.data.calendar.korea.openDay, 'N');
  assert.equal(result.errors.length, 0);
  assert.equal(result.data.futures, undefined);
});

test('explicit rate limits remain distinct from other source errors', () => {
  const p = evaluateSnapshot({errors:[{source:'KIS_TOKEN',category:'API_LIMIT',message:'HTTP 429'}]});
  assert.equal(p.dataMeta.futures.kospi200.status, 'API_LIMIT');
  assert.equal(p.dataMeta.stockFlowEstimates.samsung.status, 'API_LIMIT');
  assert.equal(p.dataMeta.stocks.samsung.status, 'CLOSED');
  assert.equal(p.pipelineStatus, 'DEGRADED');
});
test('recent fetch does not invent exchange time for an open index', () => {
  const p = evaluateSnapshot();
  p.indexes.kospi.marketStatus = 'OPEN';
  ctx.qualityPayload = p;
  ctx.qualityPayload.dataMeta.indexes.kospi.status = 'LIVE';
  run(`applyDataQuality(qualityPayload, {enabled:true}, ${Date.parse(fixture.relayUpdatedAt)})`);
  assert.equal(p.dataMeta.indexes.kospi.status, 'RECENT_FETCH');
  assert.equal(p.dataMeta.indexes.kospi.marketTime, null);
  assert.equal(p.dataMeta.indexes.kospi.sourceAgeSeconds, null);
});
