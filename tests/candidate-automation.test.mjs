import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../cloudflare/intelligence-read-worker.mjs';
import {checkCandidate, assertReadMeta} from '../scripts/check-candidate.mjs';
import {auditCandidateAccess, summarizeSettings} from '../scripts/audit-candidate-access.mjs';

const token = 'synthetic-automation-token-not-a-real-secret';
const sha = 'a'.repeat(40);
function fixture({wrongSha = false, rowsWritten = 0, authToken = token} = {}) {
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
      INTELLIGENCE_READ_TOKEN: authToken, INTELLIGENCE_WORKER_GIT_SHA: wrongSha ? 'b'.repeat(40) : sha,
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
  assert.equal(result.summary.runtimeReportedSha,sha);
  assert.equal(result.summary.serviceReleaseVersion,3);
  assert.equal(f.calls.filter(call=>new URL(call.url).pathname==='/summary').length,3);
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
test('intelligence checks do not require management or validator credentials and wait for the build', () => {
  const workflow = readFileSync(new URL('../.github/workflows/candidate-check.yml', import.meta.url), 'utf8');
  const intelligence = workflow.split('  remote-checks:')[1].split('  validator-checks:')[0];
  assert.doesNotMatch(intelligence, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|VALIDATION_TOKEN|audit-candidate-access/);
  assert.match(intelligence, /secrets.INTELLIGENCE_READ_TOKEN/);
  assert.ok(intelligence.indexOf('wait-candidate-build.mjs') < intelligence.indexOf('check-candidate.mjs'));
  assert.match(intelligence, /github.event_name == 'push' && github.sha/);
  assert.match(workflow, /vars.VALIDATOR_CHECKS_ENABLED == 'true'/);
  assert.match(workflow, /vars.CANDIDATE_ACCESS_AUDIT_ENABLED == 'true'/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  for(const name of ['validator-checks','provider-access-audit']) {
    const job=workflow.split(`  ${name}:`)[1];
    assert.match(job.slice(0,job.indexOf('runs-on:')), /github.event_name == 'workflow_dispatch'/);
  }
});

test('existing short tokens are authenticated by server, never approved by length alone', async () => {
  const shortToken = 'fixture-short';
  const f = fixture({authToken: shortToken});
  const result = await checkCandidate({kind: 'intelligence', token: shortToken, expectedSha: sha, fetcher: f.fetcher});
  assert.equal(result.status, 'PASS');
  assert.ok(!JSON.stringify(result).includes(shortToken));
  await assert.rejects(checkCandidate({kind: 'intelligence', token: 'wrong-short', expectedSha: sha,
    fetcher: fixture({authToken: shortToken}).fetcher}), /HTTP_STATUS_401_EXPECTED_200/);
  for (const empty of ['', '   ']) await assert.rejects(checkCandidate({kind: 'intelligence', token: empty,
    expectedSha: sha, fetcher: () => assert.fail('no network')}), /TOKEN_UNAVAILABLE/);
});

test('validator write-disabled evidence must be explicit and readable', () => {
  const inspect = bindings => summarizeSettings('market-feature-validation', {bindings});
  for (const bindings of [undefined, [], [{name: 'FEATURE_V2_WRITE_ENABLED', type: 'secret_text'}],
    [{name: 'FEATURE_V2_WRITE_ENABLED', type: 'plain_text'}],
    [{name: 'FEATURE_V2_WRITE_ENABLED', type: 'plain_text', text: 'FALSE'}],
    [{name: 'FEATURE_V2_WRITE_ENABLED', type: 'plain_text', text: 'false'},
     {name: 'FEATURE_V2_WRITE_ENABLED', type: 'plain_text', text: 'true'}]]) {
    const result = inspect(bindings);
    assert.equal(result.writeState, 'UNVERIFIED');
    assert.equal(result.writeEnabled, null);
    assert.equal(result.writeDisabledVerified, false);
  }
  for (const enabled of [true, false]) {
    const result = inspect([{name: 'FEATURE_V2_WRITE_ENABLED', type: 'plain_text', text: String(enabled)}]);
    assert.equal(result.writeEnabled, enabled);
    assert.equal(result.writeDisabledVerified, !enabled);
  }
});

test('failure codes identify endpoint and auth stage without secrets, bodies or retries',async()=>{
 for (const endpoint of ['/health','/state','/features','/history','/summary']) {
  const f=fixture();let failures=0;
  const fetcher=async(url,options)=>{
   if(new URL(url).pathname===endpoint && options.headers.Authorization===`Bearer ${token}`) {
    failures++;return new Response('private upstream response',{status:504});
   }
   return f.fetcher(url,options);
  };
  await assert.rejects(checkCandidate({kind:'intelligence',token,expectedSha:sha,fetcher}),
   new RegExp(`HTTP_STATUS_504_EXPECTED_200_AT_${endpoint.slice(1).toUpperCase()}_AUTHENTICATED`));
  assert.equal(failures,1);
 }
 for(const scenario of ['network','json']) {
  const fetcher=async()=>{
   if(scenario==='network')throw new Error(token+' private transport error');
   return new Response('private invalid JSON',{status:401});
  };
  await assert.rejects(checkCandidate({kind:'intelligence',token,expectedSha:sha,fetcher}),error=>{
   assert.match(error.message,scenario==='network'?/NETWORK_OR_TIMEOUT_FAILURE_AT_HEALTH_NO_TOKEN/:/INVALID_JSON_RESPONSE_AT_HEALTH_NO_TOKEN/);
   assert.ok(!error.message.includes(token));assert.ok(!error.message.includes('private'));return true;
  });
 }
});

test('actual summary response corruption blocks the existing authenticated smoke receipt',async()=>{
 for(const mutate of [s=>s.release.workerGitSha='b'.repeat(40),s=>s.queryMeta.feature=null,
 s=>s.capabilities.portfolio='AVAILABLE']){
  const f=fixture();let authenticatedSummaryCalls=0;
  const fetcher=async(url,options)=>{
   const response=await f.fetcher(url,options);
   if(new URL(url).pathname==='/summary'&&options.headers.Authorization===`Bearer ${token}`){
    authenticatedSummaryCalls++;const body=await response.json();mutate(body);return Response.json(body);
   }
   return response;
  };
  await assert.rejects(checkCandidate({kind:'intelligence',token,expectedSha:sha,fetcher}));
  assert.equal(authenticatedSummaryCalls,1);
 }
});
