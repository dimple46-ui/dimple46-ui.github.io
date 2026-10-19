import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, statSync, symlinkSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {now, policy, setup, inputs} from './fixtures/research-pair.mjs';
import {buildResearchPairSummary} from '../domain/research-pair-summary.mjs';
import {researchHash} from '../domain/research-handoff.mjs';
const cli = new URL('../scripts/record-research-evidence.mjs', import.meta.url);
const run = (...args) => spawnSync(process.execPath, [cli.pathname, ...args], {encoding: 'utf8', timeout: 5000});

test('CLI creates a new restricted-mode snapshot, adds followup, preserves original and projects history safely', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-evidence-'));
  try {
    const {session} = await setup(), pair = buildResearchPairSummary(inputs(session), policy);
    const pairPath = join(dir, 'pair.json'), first = join(dir, 'first.json'), second = join(dir, 'second.json');
    writeFileSync(pairPath, JSON.stringify(pair));
    let result = run('snapshot', pairPath, '-', 'fictional:snapshot', String(now + 1000), first);
    assert.equal(result.status, 0, result.stderr); assert.equal(statSync(first).mode & 0o777, 0o600);
    assert.equal(JSON.parse(result.stdout).snapshots, 1); assert.ok(!result.stdout.includes(pair.decision_id));
    const original = readFileSync(first, 'utf8');
    const point = (price, offset) => ({ticker: '005930', market: 'KRX', currency: 'KRW', venue: 'KRX_REGULAR',
      price_basis: 'UNADJUSTED', price_krw: price, observed_at_ms: now + offset,
      available_at_ms: now + offset + 100, source_id: 'fictional:quote', source_sha256: 'b'.repeat(64)});
    const request = join(dir, 'request.json');
    writeFileSync(request, JSON.stringify({followupId: 'fictional:followup', snapshotEntryId: 'fictional:snapshot',
      ticker: '005930', baseline: point(10000, 2000), followup: point(9000, 6000), recordedAtMs: now + 7000}));
    result = run('followup', request, first, second); assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(first, 'utf8'), original);
    const history = JSON.parse(run('history', second, String(now + 7000), '5000').stdout);
    assert.equal(history.price_followups[0].raw_price_change_percent, -10);
    assert.ok(history.snapshots[0].view.rows.every(row => row.long_term_state === null));
    assert.equal(history.forecast_accuracy, null); assert.ok(!JSON.stringify(history).includes('supporting_claim_refs'));
    const early = JSON.parse(run('history', second, String(now + 6500), '5000').stdout);
    assert.equal(early.price_followups.length, 0);
    result = run('snapshot', pairPath, first, 'fictional:snapshot', String(now + 1000), first);
    assert.equal(result.status, 1); assert.equal(readFileSync(first, 'utf8'), original);
    const link = join(dir, 'link.json'); symlinkSync(first, link);
    assert.equal(run('history', link, String(now + 7000), '5000').status, 1);
    assert.equal(run('snapshot', pairPath, '-', 'fictional:snapshot', String(now + 1000), link).status, 1);
    assert.equal(readFileSync(first, 'utf8'), original);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
test('CLI rejects corrupt/oversized/nonregular input and redacts paths, values and parser errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-evidence-'));
  try {
    const path = join(dir, 'SECRET-SENTINEL.json'); writeFileSync(path, '{"private":"SECRET-SENTINEL"');
    for (const args of [['history', path, String(now), '1'], ['history', dir, String(now), '1'],
      ['snapshot', path, '-', 'x', String(now), join(dir, 'out')],
      ['followup', path, '-', join(dir, 'out')], ['history', path, 'NaN', '0']]) {
      const result = run(...args); assert.equal(result.status, 1);
      assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes('SECRET-SENTINEL'));
      assert.equal(JSON.parse(result.stderr).code, 'RESEARCH_EVIDENCE_OPERATION_FAILED');
    }
    writeFileSync(path, ' '.repeat(5 * 1024 * 1024));
    assert.equal(run('history', path, String(now), '1').status, 1);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
test('evidence CLI rejects malformed UTF-8 before creating a snapshot and retains valid Unicode', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-evidence-utf8-'));
  try {
    const {session} = await setup(), base = buildResearchPairSummary(inputs(session), policy);
    const path = join(dir, 'PRIVATE_UTF8_SENTINEL.json');
    const pairBytes = text => {
      const pair = structuredClone(base); pair.extra = {text};
      const {decision_id, ...body} = pair;
      return Buffer.from(JSON.stringify({...body, decision_id: 'local-research-pair:' + researchHash(body)}));
    };
    for (const [index, invalid] of [Buffer.from([0xff]), Buffer.from([0xed, 0xa0, 0x80])].entries()) {
      const replacement = invalid.toString('utf8'), valid = pairBytes('PRIVATE_UTF8_SENTINEL' + replacement);
      const start = valid.indexOf(Buffer.from(replacement)); assert.ok(start >= 0);
      const bytes = Buffer.concat([valid.subarray(0, start), invalid, valid.subarray(start + Buffer.byteLength(replacement))]);
      const output = join(dir, `invalid-${index}.json`); writeFileSync(path, bytes);
      const result = run('snapshot', path, '-', 'fictional:utf8', String(now + 1000), output);
      assert.equal(result.status, 1); assert.equal(result.stdout, '');
      assert.equal(result.stderr.trim(), JSON.stringify({status: 'REJECTED', code: 'RESEARCH_EVIDENCE_OPERATION_FAILED'}));
      assert.equal(existsSync(output), false); assert.deepEqual(readFileSync(path), bytes);
    }
    const bytes = pairBytes('한글 😀 e\u0301 \ufffd'), output = join(dir, 'valid.json'); writeFileSync(path, bytes);
    const result = run('snapshot', path, '-', 'fictional:utf8', String(now + 1000), output);
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(readFileSync(path), bytes);
    const original = readFileSync(output), history = run('history', output, String(now + 1000), '120000');
    assert.equal(history.status, 0, history.stderr); assert.deepEqual(readFileSync(output), original);
    writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]));
    const bomOutput = join(dir, 'bom.json');
    assert.equal(run('snapshot', path, '-', 'fictional:bom', String(now + 1000), bomOutput).status, 1);
    assert.equal(existsSync(bomOutput), false);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
