import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync} from 'node:fs';
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
test('rejected future or unrepresentable Feature cutoff cannot break the independent research display', async () => {
  const {session} = await setup();
  for (const cutoff of [now + 1, 8640000000000001, Number.MAX_SAFE_INTEGER]) {
    const x = inputs(session); x.marketInputs.candidateFeatures.feature.inputCutoffMs = cutoff;
    const before = structuredClone(x.marketInputs), pair = buildResearchPairSummary(x, policy);
    const view = buildResearchPairView(parseResearchPairDisplay(JSON.stringify(pair)), options);
    assert.ok(pair.stocks.every(stock => stock.summary.market.features.inputCutoffMs === null));
    assert.ok(view.rows.every(row => row.short_term_status === 'UNAVAILABLE' &&
      row.short_term_state === null && row.feature_age_at_display_ms === null));
    assert.equal(view.rows[0].long_term_state, 'SUPPORTIVE');
    assert.equal(view.rows[0].feature_quality_at_generation, 'UNVERIFIED_TIME');
    assert.match(renderResearchPairText(pair, options), /Feature 경과: 확인 불가/);
    assert.deepEqual(x.marketInputs, before);
  }
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
test('JSON and text display reject reference timestamps outside the Date range', async () => {
  const r = await fixture();
  for (const nowMs of [8640000000000001, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => buildResearchPairView(r, {...options, nowMs}), /INVALID_PAIR_DISPLAY_INPUT/);
    assert.throws(() => renderResearchPairText(r, {...options, nowMs}), /INVALID_PAIR_DISPLAY_INPUT/);
  }
  assert.equal(buildResearchPairView(r, {...options, nowMs: 8640000000000000}).status, 'LOCAL_DISPLAY_ONLY');
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
test('display CLI rejects malformed UTF-8 without repairing hashed summaries and preserves valid Unicode', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pair-display-utf8-'));
  const path = join(dir, 'PRIVATE_UTF8_SENTINEL.json');
  const run = () => spawnSync(process.execPath, ['scripts/show-research-pair.mjs', path, String(options.nowMs), '120000', 'json'], {encoding: 'utf8', timeout: 5000});
  try {
    const base = await fixture();
    for (const invalid of [Buffer.from([0xff]), Buffer.from([0xed, 0xa0, 0x80])]) {
      const replacement = invalid.toString('utf8'), pair = structuredClone(base);
      pair.extra = {text: 'PRIVATE_UTF8_SENTINEL' + replacement};
      const valid = Buffer.from(JSON.stringify(reseal(pair))), start = valid.indexOf(Buffer.from(replacement));
      assert.ok(start >= 0);
      const bytes = Buffer.concat([valid.subarray(0, start), invalid, valid.subarray(start + Buffer.byteLength(replacement))]);
      writeFileSync(path, bytes); const result = run();
      assert.equal(result.status, 1); assert.equal(result.stdout, '');
      assert.equal(result.stderr.trim(), JSON.stringify({status: 'REJECTED', code: 'RESEARCH_PAIR_DISPLAY_FAILED'}));
      assert.deepEqual(readFileSync(path), bytes);
    }
    const pair = structuredClone(base); pair.extra = {text: '한글 😀 e\u0301 \ufffd'};
    const sealed = reseal(pair), bytes = Buffer.from(JSON.stringify(sealed)); writeFileSync(path, bytes);
    const result = run(); assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), buildResearchPairView(sealed, options));
    assert.deepEqual(readFileSync(path), bytes);
    writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes])); assert.equal(run().status, 1);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
test('display CLI rejects final-component symlinks without reading or changing their target', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pair-display-link-'));
  try {
    const path = join(dir, 'input.json'), link = join(dir, 'PRIVATE_LINK_SENTINEL.json');
    const bytes = Buffer.from(JSON.stringify(await fixture())); writeFileSync(path, bytes); symlinkSync(path, link);
    const result = spawnSync(process.execPath, ['scripts/show-research-pair.mjs', link, String(options.nowMs), '120000', 'json'], {encoding: 'utf8', timeout: 2000});
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), JSON.stringify({status: 'REJECTED', code: 'RESEARCH_PAIR_DISPLAY_FAILED'}));
    assert.deepEqual(readFileSync(path), bytes);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
