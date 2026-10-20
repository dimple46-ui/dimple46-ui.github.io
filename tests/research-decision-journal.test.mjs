import test from 'node:test';
import assert from 'node:assert/strict';
import {now, policy, setup, inputs} from './fixtures/research-pair.mjs';
import {buildResearchPairSummary} from '../domain/research-pair-summary.mjs';
import {researchHash} from '../domain/research-handoff.mjs';
import {createResearchDecisionJournal, appendResearchDecisionSnapshot, verifyResearchDecisionJournal,
  parseResearchDecisionJournal, buildResearchDecisionHistory, MAX_JOURNAL_BYTES} from '../domain/research-decision-journal.mjs';
async function summary() { const {session} = await setup(); return buildResearchPairSummary(inputs(session), policy); }
const append = (journal, pairSummary, extra = {}) => appendResearchDecisionSnapshot(journal,
  {entryId: 'fictional:receipt:1', recordedAtMs: now + 1000, pairSummary, ...extra});

test('frozen detached snapshots preserve pair evidence and exact retry is idempotent', async () => {
  const pair = structuredClone(await summary()), empty = createResearchDecisionJournal(), journal = append(empty, pair);
  assert.equal(empty.entries.length, 0); assert.equal(journal.entries.length, 1);
  pair.comparison[0].long_term_state = 'ADVERSE';
  assert.equal(journal.entries[0].pair_summary.comparison[0].long_term_state, 'SUPPORTIVE');
  assert.equal(verifyResearchDecisionJournal(journal), true);
  assert.deepEqual(append(journal, await summary()), journal);
  assert.throws(() => journal.entries.push({}), TypeError);
});
test('conflicting IDs, duplicate decisions, backdated receipts and future snapshots fail', async () => {
  const pair = await summary(), empty = createResearchDecisionJournal(), journal = append(empty, pair);
  assert.throws(() => append(journal, pair, {recordedAtMs: now + 2000}));
  assert.throws(() => append(journal, pair, {entryId: 'fictional:duplicate'}));
  assert.throws(() => append(empty, pair, {recordedAtMs: now - 1}));
  const {session} = await setup({approve: ['005930']});
  const partial = buildResearchPairSummary(inputs(session), policy);
  assert.throws(() => append(journal, partial, {entryId: 'fictional:receipt:2', recordedAtMs: now}));
  const second = append(journal, partial, {entryId: 'fictional:receipt:2', recordedAtMs: now + 2000});
  assert.equal(second.entries[1].previous_entry_hash, journal.entries[0].entry_hash);
});
test('hash tamper, reorder, unknown fields and a rehashed invalid child cannot pass', async () => {
  const journal = append(createResearchDecisionJournal(), await summary());
  for (const change of [j => j.entries[0].recorded_at_ms++, j => j.entries[0].previous_entry_hash = 'a'.repeat(64),
    j => j.entries[0].pair_summary.stocks.reverse(), j => j.entries[0].private = 'sentinel',
    j => j.schema_version = 2]) {
    const bad = structuredClone(journal); change(bad); assert.equal(verifyResearchDecisionJournal(bad), false);
  }
  const bad = structuredClone(journal); bad.entries[0].pair_summary.stocks[0].summary.generated_at_ms++;
  const {entry_hash, ...body} = bad.entries[0]; bad.entries[0].entry_hash = researchHash(body);
  assert.equal(verifyResearchDecisionJournal(bad), false);
});
test('as-of history honors receipt time, stale suppression and unapproved research independently', async () => {
  const {session} = await setup({approve: ['005930']});
  const journal = append(createResearchDecisionJournal(), buildResearchPairSummary(inputs(session), policy));
  assert.equal(buildResearchDecisionHistory(journal, {asOfMs: now, maxSummaryAgeMs: 5000}).snapshots.length, 0);
  const view = buildResearchDecisionHistory(journal, {asOfMs: now + 1000, maxSummaryAgeMs: 5000});
  assert.equal(view.snapshots[0].view.rows[1].long_term_state, null);
  assert.equal(view.forecast_accuracy, null); assert.equal(view.approval_status, 'NOT_REEVALUATED');
  const stale = buildResearchDecisionHistory(journal, {asOfMs: now + 10000, maxSummaryAgeMs: 5000});
  assert.ok(stale.snapshots[0].view.rows.every(row => row.long_term_state === null && row.short_term_state === null));
});
test('JSON round-trip is bounded and cycles, nonfinite values and invalid policies fail closed', async () => {
  const journal = append(createResearchDecisionJournal(), await summary());
  assert.deepEqual(parseResearchDecisionJournal(JSON.stringify(journal)), journal);
  for (const text of ['{', ' '.repeat(MAX_JOURNAL_BYTES + 1)]) assert.throws(() => parseResearchDecisionJournal(text));
  const cycle = {}; cycle.self = cycle;
  assert.equal(verifyResearchDecisionJournal(cycle), false);
  for (const asOfMs of [NaN, Infinity, -1, 8640000000000001])
    assert.throws(() => buildResearchDecisionHistory(journal, {asOfMs, maxSummaryAgeMs: 1}));
  const nan = structuredClone(journal); nan.entries[0].pair_summary.extra = NaN;
  assert.equal(verifyResearchDecisionJournal(nan), false);
  let getterRan = false;
  const accessor = {schema_version: 1, status: 'LOCAL_EVIDENCE_ONLY'};
  Object.defineProperty(accessor, 'entries', {enumerable: true, get() { getterRan = true; return []; }});
  assert.equal(verifyResearchDecisionJournal(accessor), false); assert.equal(getterRan, false);
  assert.equal(verifyResearchDecisionJournal({...journal, [Symbol('hidden')]: true}), false);
});
