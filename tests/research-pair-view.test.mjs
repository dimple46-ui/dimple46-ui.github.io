import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {now, policy, setup, inputs} from './fixtures/research-pair.mjs';
import {researchHash} from '../domain/research-handoff.mjs';
import {buildResearchPairSummary} from '../domain/research-pair-summary.mjs';
import {MAX_PAIR_DISPLAY_BYTES, parseResearchPairDisplay, buildResearchPairView, renderResearchPairText}
  from '../domain/research-pair-view.mjs';
const options = {nowMs: now + 100, maxSummaryAgeMs: 120000};
async function fixture(config) {const {session} = await setup(config); return buildResearchPairSummary(inputs(session), policy);}
function reseal(pair) {
  const {decision_id, ...body} = pair;
  return {decision_id: 'local-research-pair:' + researchHash(body), ...body};
}
test('bounded view shows both stocks, independent ages and historical long/short state without claiming authorization', async () => {
  const r = await fixture(), view = buildResearchPairView(r, options), text = renderResearchPairText(r, options);
  assert.equal(view.rows[0].long_term_state, 'SUPPORTIVE');
  assert.equal(view.rows[0].short_term_state, 'ADVERSE_DESCRIPTIVE_SIGNALS');
  assert.equal(view.rows[1].short_term_state, 'SUPPORTIVE_DESCRIPTIVE_SIGNALS');
  assert.equal(view.rows[0].observation_age_at_display_ms, 1100);
  assert.equal(view.rows[0].feature_age_at_display_ms, 1100);
  assert.equal(view.rows[0].feature_quality_at_generation, 'UNVERIFIED_TIME');
  assert.equal(view.temporal_scope, 'STORED_AS_OF_NOT_REEVALUATED');
  assert.match(view.integrity, /NOT_AUTHENTICATION/); assert.equal(view.execution_allowed, false);
  assert.match(text, /삼성전자/); assert.match(text, /SK하이닉스/); assert.match(text, /확인 불가/);
});
test('stale saved summary suppresses both directional states, preserves source times and never becomes current', async () => {
  const r = await fixture(), before = structuredClone(r);
  const view = buildResearchPairView(r, {...options, nowMs: now + 120001});
  assert.ok(view.rows.every(row => row.long_term_state === null && row.short_term_state === null &&
    row.display_status === 'STALE_SUMMARY_SUPPRESSED'));
  assert.equal(view.generated_at_ms, now); assert.deepEqual(r, before);
  assert.equal(buildResearchPairView(r, {...options, nowMs: now + 120000}).rows[0].long_term_state, 'SUPPORTIVE');
});
test('unapproved research remains unavailable and missing/stale Feature is never upgraded by rendering', async () => {
  const f = await setup({approve: ['005930']}), x = inputs(f.session);
  x.marketInputs.candidateFeatures.feature.qualityCeiling = 'STALE_INPUT';
  const view = buildResearchPairView(buildResearchPairSummary(x, policy), options);
  assert.equal(view.rows[1].research_available_at_generation, false);
  assert.equal(view.rows[1].long_term_state, null);
  assert.ok(view.rows.every(row => row.short_term_state === null && row.trade_quantities === null));
});
test('tampered hashes, future display baseline, unsafe policy numbers and nested identity mismatch reject', async () => {
  const r = await fixture(), tampered = structuredClone(r); tampered.comparison[0].long_term_state = 'ADVERSE';
  assert.throws(() => buildResearchPairView(tampered, options));
  for (const p of [{...options, nowMs: now - 1}, {...options, nowMs: Infinity},
    {...options, maxSummaryAgeMs: -1}, {...options, maxSummaryAgeMs: NaN}])
    assert.throws(() => buildResearchPairView(r, p));
  const swapped = structuredClone(r); swapped.stocks.reverse();
  assert.throws(() => buildResearchPairView(reseal(swapped), options));
  const child = structuredClone(r); child.stocks[0].summary.long_term.state = 'ADVERSE';
  assert.throws(() => buildResearchPairView(reseal(child), options));
});
test('rehashed extra content is omitted from fixed projection, including prose, URL, private values and terminal control characters', async () => {
  const r = structuredClone(await fixture());
  r.extra = {token: 'SENTINEL_PRIVATE', prose: '\u001b[2J https://example.invalid/instruction'};
  const text = renderResearchPairText(reseal(r), options), view = buildResearchPairView(reseal(r), options);
  assert.ok(!text.includes('SENTINEL') && !text.includes('\u001b') && !text.includes('https://'));
  assert.ok(!JSON.stringify(view).includes('SENTINEL_PRIVATE'));
});
test('parser bounds bytes, nesting and node count before recursive hash checks', async () => {
  const r = await fixture(); assert.deepEqual(parseResearchPairDisplay(JSON.stringify(r)), r);
  for (const text of ['invalid json', ' '.repeat(MAX_PAIR_DISPLAY_BYTES + 1),
    '['.repeat(26) + '0' + ']'.repeat(26), JSON.stringify(Array(20001).fill(0))])
    assert.throws(() => parseResearchPairDisplay(text));
});
test('CLI reads an explicit bounded local file, emits safe text/JSON and sanitizes errors without echoing input or path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pair-display-'));
  try {
    const path = join(dir, 'PRIVATE_PATH_SENTINEL.json'); writeFileSync(path, JSON.stringify(await fixture()));
    const run = args => spawnSync(process.execPath, ['scripts/show-research-pair.mjs', ...args], {encoding: 'utf8'});
    let r = run([path, String(options.nowMs), '120000']); assert.equal(r.status, 0); assert.match(r.stdout, /삼성전자/);
    r = run([path, String(options.nowMs), '120000', 'json']); assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).status, 'LOCAL_DISPLAY_ONLY');
    writeFileSync(path, JSON.stringify({secret: 'PRIVATE_VALUE_SENTINEL'}));
    for (const args of [[path, String(now), '120000'], [path, 'Infinity', '120000'], [path, String(now), '120000', 'html'],
      [dir, String(now), '120000']]) {
      r = run(args); assert.equal(r.status, 1); assert.equal(r.stdout, '');
      assert.ok(!r.stderr.includes('PRIVATE_PATH') && !r.stderr.includes('PRIVATE_VALUE') && !r.stderr.includes(dir));
      assert.equal(JSON.parse(r.stderr).code, 'RESEARCH_PAIR_DISPLAY_FAILED');
    }
    writeFileSync(path, ' '.repeat(MAX_PAIR_DISPLAY_BYTES + 1));
    assert.equal(run([path, String(now), '120000']).status, 1);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
