import {pathToFileURL} from 'node:url';
import {validateSignalReplay} from '../cloudflare/signal-replay-validator.mjs';

const ORIGINS = {
  intelligence: 'https://market-intelligence-read-candidate.dimple3691.workers.dev',
  validator: 'https://market-feature-validation.dimple3691.workers.dev'
};
function requireCheck(condition, code) { if (!condition) throw new Error(code); }
export function assertReadMeta(meta) {
  let count = 0;
  function visit(value) {
    requireCheck(value && typeof value === 'object', 'QUERY_META_MISSING');
    if ('rowsWritten' in value) {
      requireCheck(value.rowsWritten === 0, 'D1_WRITE_DETECTED');
      requireCheck(Number.isFinite(value.rowsRead) && value.rowsRead >= 0, 'ROWS_READ_MISSING');
      count++;
    } else for (const child of Object.values(value)) visit(child);
  }
  visit(meta);
  requireCheck(count > 0, 'QUERY_META_MISSING');
}
export async function checkCandidate({kind, token, expectedSha, expectedSourceHash, cutoffMs,
  fetcher = fetch, now = Date.now()}) {
  requireCheck(Object.hasOwn(ORIGINS, kind), 'INVALID_CANDIDATE');
  requireCheck(typeof token === 'string' && token.trim().length > 0, 'TOKEN_UNAVAILABLE');
  requireCheck(/^[a-f0-9]{40}$/.test(expectedSha || ''), 'EXPECTED_SHA_REQUIRED');
  if (kind === 'validator') {
    requireCheck(/^[a-f0-9]{64}$/.test(expectedSourceHash || ''), 'EXPECTED_SOURCE_HASH_REQUIRED');
    requireCheck(Number.isSafeInteger(cutoffMs) && cutoffMs > 0 && cutoffMs <= now, 'INVALID_CUTOFF');
  }
  async function request(path, auth = token, expectedStatus = 200) {
    // Fixed origins, no redirects or user-controlled SQL/host. Token never enters a URL or output.
    const route = path.split('?')[0];
    const endpoint = route.startsWith('/replay/') ? 'REPLAY'
      : ({'/':'ROOT','/health':'HEALTH','/state':'STATE','/features':'FEATURES','/history':'HISTORY'}[route] || 'UNKNOWN');
    const stage = auth == null ? 'NO_TOKEN' : auth === token ? 'AUTHENTICATED' : 'WRONG_TOKEN';
    const fail = code => { throw new Error(`${code}_AT_${endpoint}_${stage}`); };
    let response;
    try {
      response = await fetcher(ORIGINS[kind] + path, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: auth == null ? {} : {Authorization: `Bearer ${auth}`}
      });
    } catch { fail('NETWORK_OR_TIMEOUT_FAILURE'); }
    if (response.status !== expectedStatus) fail(`HTTP_STATUS_${response.status}_EXPECTED_${expectedStatus}`);
    try { return await response.json(); }
    catch { fail('INVALID_JSON_RESPONSE'); }
  }
  const authPath = kind === 'intelligence' ? '/health' : '/';
  await request(authPath, null, 401);
  await request(authPath, 'deliberately-invalid-candidate-smoke-token', 401);
  if (kind === 'validator') {
    const replay = await request(`/replay/${cutoffMs}`);
    requireCheck(replay.candidateSha256 === expectedSourceHash, 'SOURCE_IDENTITY_MISMATCH');
    requireCheck(replay.replayCutoffMs === cutoffMs, 'CUTOFF_MISMATCH');
    assertReadMeta(replay.queryMeta);
    const result = validateSignalReplay(replay, {engineGitSha: expectedSha, generatedAt: new Date(now).toISOString()});
    return {status: 'PASS', kind, validation: 'READ_ONLY_HISTORICAL_REPLAY',
      sourceHash: replay.candidateSha256, runtimeCommit: 'UNAVAILABLE_SOURCE_HASH_ONLY',
      signalValidatorCommit: expectedSha, featureVersion: result.featureVersion,
      signalVersion: result.signalVersion, inputCutoff: result.inputCutoff,
      checks: result.checks, liveMarketGate: 'UNCHANGED', deployment: 'NOT_PERFORMED'};
  }
  const health = await request('/health?includeStorageGrowth=false');
  if (health.storageGrowth?.status !== 'NOT_REQUESTED' ||
      Object.keys(health.queryMeta || {}).sort().join(',') !== 'feature,observation')
    throw new Error('HEALTH_LIGHTWEIGHT_CONTRACT_FAILED');
  requireCheck(health.service === 'market-intelligence-read-candidate' && health.readOnly === true, 'SERVICE_MISMATCH');
  requireCheck(health.release?.workerGitSha === expectedSha, 'DEPLOYMENT_SHA_MISMATCH');
  requireCheck(health.release?.supportedFeatureVersion === 2, 'FEATURE_VERSION_MISMATCH');
  assertReadMeta(health.queryMeta);
  const run = health.latestFeatureRun;
  if (run) requireCheck(run.freshness?.basis === "AS_OF_MINUS_FEATURE_INPUT_CUTOFF" &&
    run.freshness.status === "AGE_AVAILABLE" &&
    run.freshness.age_ms === health.nowMs - run.inputCutoffMs && run.freshness.age_ms >= 0,
    "FEATURE_AGE_MISMATCH");
  const state = await request('/state');
  assertReadMeta(state.queryMeta);
  requireCheck(state.state?.observedAtMs <= state.inputCutoffMs &&
    state.state?.availableAtMs <= state.inputCutoffMs && state.inputCutoffMs <= now + 60000, 'FUTURE_STATE');
  requireCheck(state.metadata?.quality != null && state.metadata?.pipeline_status != null, 'QUALITY_MISSING');
  requireCheck(state.metadata?.freshness?.age_ms === Math.max(0, state.inputCutoffMs - state.state.observedAtMs), 'FRESHNESS_MISMATCH');
  const features = await request('/features?featureVersion=2');
  assertReadMeta(features.queryMeta);
  requireCheck(features.feature?.featureVersion === 2, 'FEATURE_VERSION_MISMATCH');
  requireCheck(features.feature?.inputCutoffMs <= features.inputCutoffMs, 'FUTURE_FEATURE');
  requireCheck(features.metadata?.quality === features.feature?.qualityCeiling, 'QUALITY_NOT_PRESERVED');
  const history = await request('/history?ticker=005930&limit=2');
  assertReadMeta(history.queryMeta);
  requireCheck(Array.isArray(history.rows) && history.rows.length <= 2, 'HISTORY_UNBOUNDED');
  requireCheck(history.rows.every(row => row.availableAtMs <= history.inputCutoffMs && row.observedAtMs <= history.inputCutoffMs), 'FUTURE_HISTORY');
  for (const [path, code] of [
    ['/state?ticker=INVALID', 'INVALID_TICKER'],
    ['/history?ticker=005930&limit=999999', 'INVALID_LIMIT'],
    ['/state?cutoffMs=9999999999999', 'INVALID_CUTOFF'],
    ['/features?featureVersion=999', 'INVALID_FEATURE_VERSION']
  ]) requireCheck((await request(path, token, 400)).error === code, 'VALIDATION_REJECTION_MISMATCH');
  return {status: 'PASS', kind, validation: 'AUTHENTICATED_READ_ONLY_SMOKE',
    runtimeReportedSha: health.release.workerGitSha,
    deploymentId: health.release.deploymentId ?? null,
    identityEvidence: 'RUNTIME_REPORTED_SHA_NOT_PROVIDER_CODE_ATTESTATION',
    healthQueryCount: Object.keys(health.queryMeta).length,
    featureAge: health.latestFeatureRun?.freshness ?? null,
    storageGrowthStatus: health.storageGrowth.status,
    collectionHealth: health.collectionHealth, latestObservation: health.latestObservation?.observedAtMs,
    featureVersion: features.feature.featureVersion, featureInputCutoff: features.feature.inputCutoffMs,
    quality: features.feature.qualityCeiling, freshness: state.metadata.freshness,
    d1Writes: 0, liveMarketGate: 'UNCHANGED', deployment: 'NOT_PERFORMED'};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await checkCandidate({kind: process.env.CANDIDATE_KIND,
      token: process.env.CANDIDATE_READ_TOKEN, expectedSha: process.env.EXPECTED_CANDIDATE_SHA,
      expectedSourceHash: process.env.EXPECTED_SOURCE_HASH,
      cutoffMs: Number(process.env.REPLAY_CUTOFF_MS)}), null, 2));
  } catch (error) {
    // Never serialize remote bodies, fetch errors or credentials to CI logs.
    const code = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'CANDIDATE_CHECK_FAILED';
    console.error(JSON.stringify({status: 'FAIL', code, deployment: 'NOT_PERFORMED'}));
    process.exitCode = 1;
  }
}
