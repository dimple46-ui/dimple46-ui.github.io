import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../cloudflare/intelligence-read-worker.mjs';
import {checkCandidate, assertReadMeta} from '../scripts/check-candidate.mjs';
import {auditCandidateAccess, summarizeSettings} from '../scripts/audit-candidate-access.mjs';

const token = 'synthetic-automation-token-not-a-real-secret';
const sha = 'a'.repeat(40);
function fixture({wrongSha = false, rowsWritten = 0} = {}) {
  const at = Date.now() - 100000;
  const row = {slot_ms: Math.floor(at / 120000) * 120000, observed_at_ms: at, available_at_ms: at,
    trading_day: '20261012', schema_version: 1, pipeline_status: 'DEGRADED', quality_version: 'fixture',
    metrics_json: JSON.stringify({'samsung.price': {value: null, status: 'STALE'}}),
    quality_json: JSON.stringify({dataQuality: {issues: [{status: 'STALE'}]}})};
  const feature = {...row, feature_version: 2, engine_git_sha: sha, engine_source_sha256: 'a'.repeat(64), generated_at_ms: at,
    input_cutoff_ms: at, quality_ceiling: 'STALE_INPUT', generation_status: 'SUCCESS',
    compact_features_json: JSON.stringify({encodingVersion: 1, featureVersion: 2, codes: {}, order: {}, windows: {}}),
    validation_json: JSON.stringify({featureVersion: 2, qualityCeiling: 'STALE_INPUT'})};
  const calls = [];
  const db = {prepare(sql) {
    assert.match(sql.trim(), /^SELECT\b/);
    const all = async () => ({success: true, results: sql.includes('GROUP BY') ? [] :
      [sql.includes('FROM feature_runs') ? feature : row], meta: {rows_read: 1, rows_written: rowsWritten, duration: 1}});
    return {all, bind() { return {all}; }};
  }};
  return {calls, fetcher: async (url, options) => {
    calls.push({url, method: options.method});
    assert.equal(options.redirect, 'error');
    return worker.fetch(new Request(url, options), {MARKET_HISTORY: db,
      INTELLIGENCE_READ_TOKEN: token, INTELLIGENCE_WORKER_GIT_SHA: wrongSha ? 'b'.repeat(40) : sha,
      INTELLIGENCE_RATE_LIMIT_PER_MINUTE: '1000', INTELLIGENCE_RATE_LIMITER: {limit: async () => ({success: true})}});
  }};
}
test('automation exercises actual candidate handlers, preserves stale/null and never sends a write', async () => {
  const f = fixture();
  const result = await checkCandidate({kind: 'intelligence', token, expectedSha: sha, fetcher: f.fetcher});
  assert.equal(result.status, 'PASS');
  assert.equal(result.quality, 'STALE_INPUT');
  assert.equal(result.liveMarketGate, 'UNCHANGED');
  assert.equal(result.deployment, 'NOT_PERFORMED');
  assert.ok(f.calls.every(call => call.method === 'GET'));
  assert.ok(!JSON.stringify(result).includes(token));
});
test('missing credentials and wrong targets fail before network', async () => {
  const fetcher = () => assert.fail('network must not be reached');
  await assert.rejects(checkCandidate({kind: 'market-relay', token, expectedSha: sha, fetcher}), /INVALID_CANDIDATE/);
  await assert.rejects(checkCandidate({kind: 'intelligence', expectedSha: sha, fetcher}), /TOKEN_UNAVAILABLE/);
  await assert.rejects(auditCandidateAccess({fetcher}), /CREDENTIALS_UNAVAILABLE/);
});
test('deployed SHA mismatch blocks successful validation', async () => {
  await assert.rejects(checkCandidate({kind: 'intelligence', token, expectedSha: sha,
    fetcher: fixture({wrongSha: true}).fetcher}), /DEPLOYMENT_SHA_MISMATCH/);
});
test('nonzero or absent D1 write telemetry cannot pass', () => {
  assert.throws(() => assertReadMeta({rowsRead: 1, rowsWritten: 1}), /D1_WRITE_DETECTED/);
  assert.throws(() => assertReadMeta({}), /QUERY_META_MISSING/);
  assertReadMeta({current: {rowsRead: 1, rowsWritten: 0}});
});
test('source hash mismatch and future replay are blocked', async () => {
  const fetcher = async (url, options) => options.headers.Authorization === `Bearer ${token}` ?
    Response.json({candidateSha256: 'b'.repeat(64)}) : Response.json({}, {status: 401});
  await assert.rejects(checkCandidate({kind: 'validator', token, expectedSha: sha,
    expectedSourceHash: 'a'.repeat(64), cutoffMs: Date.now() - 1000, fetcher}), /SOURCE_IDENTITY_MISMATCH/);
  await assert.rejects(checkCandidate({kind: 'validator', token, expectedSha: sha,
    expectedSourceHash: 'a'.repeat(64), cutoffMs: Date.now() + 99999, fetcher}), /INVALID_CUTOFF/);
});
test('Cloudflare audit only queries fixed candidate settings; redacts all values', async () => {
  const calls = [];
  const result = await auditCandidateAccess({accountId: 'a'.repeat(32), token, fetcher: async (url, options) => {
    calls.push({url, method: options.method});
    return Response.json({success: true, result: {bindings: [
      {type: 'secret_text', name: url.includes('market-feature-validation') ? 'VALIDATION_TOKEN' : 'INTELLIGENCE_READ_TOKEN', text: token},
      {type: 'plain_text', name: 'UNKNOWN', text: 'sensitive-value'},
      {type: 'd1', name: 'MARKET_HISTORY', id: 'known-db'}
    ]}});
  }});
  assert.equal(result.status, 'READ_ACCESS_VERIFIED');
  assert.ok(calls.every(call => call.method === 'GET' && !call.url.includes('market-relay')));
  assert.ok(result.candidates.every(c => c.requiredSecretPresent && c.historyBindingPresent));
  assert.doesNotMatch(JSON.stringify(result), /sensitive-value|synthetic-automation-token/);
  assert.throws(() => summarizeSettings('market-relay', {}), /PRODUCTION_TARGET_FORBIDDEN/);
});
test('Cloudflare 403 is a blocker, not a retry or permission escalation', async () => {
  let calls = 0;
  await assert.rejects(auditCandidateAccess({accountId: 'a'.repeat(32), token, fetcher: async () => {
    calls++; return Response.json({}, {status: 403});
  }}), /CLOUDFLARE_ACCESS_403/);
  assert.equal(calls, 1);
});
test('workflow cannot deploy, migrate, change secrets or run on untrusted PR code', () => {
  const workflow = readFileSync(new URL('../.github/workflows/candidate-check.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /pull_request_target|secrets: inherit|contents: write|wrangler (deploy|secret|rollback)|migrations apply/);
  assert.match(workflow, /CANDIDATE_CHECKS_ENABLED == 'true'/);
  assert.match(workflow, /refs\/heads\/feature\/m2-operational-storage/);
});
