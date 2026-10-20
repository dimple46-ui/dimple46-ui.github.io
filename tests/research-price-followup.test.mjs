import test from 'node:test';
import assert from 'node:assert/strict';
import {now, policy, setup, inputs} from './fixtures/research-pair.mjs';
import {buildResearchPairSummary} from '../domain/research-pair-summary.mjs';
import {createResearchDecisionJournal, appendResearchDecisionSnapshot} from '../domain/research-decision-journal.mjs';
import {createResearchPriceFollowup, verifyResearchPriceFollowup, appendResearchPriceFollowup,
  selectResearchPriceFollowups} from '../domain/research-price-followup.mjs';
async function fixture() {
  const {session} = await setup();
  const journal = appendResearchDecisionSnapshot(createResearchDecisionJournal(), {entryId: 'fictional:snapshot',
    recordedAtMs: now + 1000, pairSummary: buildResearchPairSummary(inputs(session), policy)});
  const quote = (price, offset) => ({ticker: '005930', market: 'KRX', currency: 'KRW', venue: 'KRX_REGULAR',
    price_basis: 'UNADJUSTED', price_krw: price, observed_at_ms: now + offset,
    available_at_ms: now + offset + 100, source_id: 'fictional:quote', source_sha256: 'a'.repeat(64)});
  return {journal, input: {followupId: 'fictional:followup', snapshotEntryId: 'fictional:snapshot',
    ticker: '005930', baseline: quote(10000, 2000), followup: quote(11000, 6000), recordedAtMs: now + 7000}};
}
test('post-record price change is reproducible, frozen and explicitly not prediction success or total return', async () => {
  const {journal, input} = await fixture(), before = structuredClone(input);
  const record = createResearchPriceFollowup(journal, input);
  assert.equal(record.raw_price_change_krw, 1000); assert.equal(record.raw_price_change_percent, 10);
  assert.equal(record.forecast_accuracy, null); assert.equal(record.total_return, null);
  assert.equal(record.user_action, 'NOT_RECORDED'); assert.equal(record.execution_allowed, false);
  assert.match(record.interval_selection, /POST_HOC/); assert.match(record.provenance, /NOT_INDEPENDENT/);
  assert.deepEqual(input, before); assert.deepEqual(createResearchPriceFollowup(journal, input), record);
  assert.equal(verifyResearchPriceFollowup(journal, record), true);
  assert.throws(() => record.baseline.price_krw = 1, TypeError);
  input.followup.price_krw = 9000;
  assert.equal(createResearchPriceFollowup(journal, input).raw_price_change_percent, -10);
});
test('missing/zero/nonfinite/unsafe prices, mixed basis, ticker, currency, source or venue reject', async () => {
  const {journal, input} = await fixture();
  const changes = [q => delete q.price_krw, ...[0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(n => q => q.price_krw = n),
    q => q.ticker = '000660', q => q.currency = 'USD', q => q.market = 'NXT', q => q.venue = 'NXT',
    q => q.price_basis = 'ADJUSTED', q => q.source_id = 'different', q => q.source_sha256 = 'invalid',
    q => q.extra = 'secret'];
  for (const change of changes) {
    const bad = structuredClone(input); change(bad.followup);
    assert.throws(() => createResearchPriceFollowup(journal, bad));
  }
});
test('quote accessors cannot change a validated price or run during input inspection', async () => {
 const {journal,input}=await fixture();let reads=0;
 Object.defineProperty(input.baseline,'price_krw',{enumerable:true,get(){return ++reads<3?10000:-10000;}});
 assert.throws(()=>createResearchPriceFollowup(journal,input),/INVALID_RESEARCH_PRICE_FOLLOWUP/);
 assert.equal(reads,0);
});
test('pre-record baseline, future knowledge, overlapping intervals and missing snapshot reject', async () => {
  const {journal, input} = await fixture();
  for (const change of [x => x.baseline.observed_at_ms = now,
    x => x.followup.available_at_ms = x.recordedAtMs + 1,
    x => x.followup.observed_at_ms = x.baseline.observed_at_ms,
    x => x.baseline.available_at_ms = x.followup.observed_at_ms + 1,
    x => x.followup.available_at_ms = x.followup.observed_at_ms - 1,
    x => x.snapshotEntryId = 'missing', x => x.recordedAtMs = now]) {
    const bad = structuredClone(input); change(bad); assert.throws(() => createResearchPriceFollowup(journal, bad));
  }
});
test('linked digest, duplicate conflict and original journal integrity are checked on append and as-of read', async () => {
  const {journal, input} = await fixture(), record = createResearchPriceFollowup(journal, input);
  const records = appendResearchPriceFollowup([], record, journal);
  assert.deepEqual(appendResearchPriceFollowup(records, record, journal), records);
  const bad = structuredClone(record); bad.raw_price_change_percent = 100;
  assert.equal(verifyResearchPriceFollowup(journal, bad), false);
  assert.throws(() => appendResearchPriceFollowup(records, bad, journal));
  const conflict = createResearchPriceFollowup(journal, {...input, followup: {...input.followup, price_krw: 12000}});
  assert.throws(() => appendResearchPriceFollowup(records, conflict, journal));
  assert.equal(selectResearchPriceFollowups(records, journal, {asOfMs: now + 6500}).length, 0);
  assert.deepEqual(selectResearchPriceFollowups(records, journal, {asOfMs: now + 7000}), records);
  const corrupt = structuredClone(journal); corrupt.entries[0].recorded_at_ms++;
  assert.equal(verifyResearchPriceFollowup(corrupt, record), false);
  assert.throws(() => selectResearchPriceFollowups([record, record], journal, {asOfMs: now + 8000}));
});
