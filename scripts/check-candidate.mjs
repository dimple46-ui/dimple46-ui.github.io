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
export function assertSummary(summary, {expectedSha, referenceMs, maxObservationAgeMs, maxFeatureAgeMs, storedFeature}) {
  requireCheck(summary?.readOnly === true && summary.apiSchemaVersion === 1 && summary.schemaVersion === 1,
    'SUMMARY_SCHEMA_MISMATCH');
  requireCheck(summary.release?.workerGitSha === expectedSha && summary.release?.serviceReleaseVersion === 3 &&
    summary.release?.supportedFeatureVersion === 2, 'SUMMARY_DEPLOYMENT_IDENTITY_MISMATCH');
  requireCheck(summary.evaluationReferenceMs === referenceMs && Number.isSafeInteger(summary.generatedAtMs) &&
    summary.generatedAtMs >= referenceMs && summary.generatedAtMs <= referenceMs + 60000, 'SUMMARY_TIME_MISMATCH');
  requireCheck(summary.agePolicy?.maxObservationAgeMs === maxObservationAgeMs &&
    summary.agePolicy?.maxFeatureAgeMs === maxFeatureAgeMs, 'SUMMARY_POLICY_MISMATCH');
  for (const name of ['signals','portfolio','thesis','decision'])
    requireCheck(summary.capabilities?.[name] === 'UNAVAILABLE', 'SUMMARY_PRIVATE_CAPABILITY_PROMOTED');
  const forbidden = new Set(['privateResult','privateComparison','ledger','accounts','holdings','accountRef',
    'capitalKrw','fundingGapKrw','requiredCashKrw','companyMerit','portfolioFit','authorization','token','secrets']);
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      requireCheck(!forbidden.has(key), 'SUMMARY_PRIVATE_PAYLOAD'); inspect(child);
    }
  }
  inspect(summary);
  requireCheck(['PARTIAL','UNAVAILABLE'].includes(summary.status), 'SUMMARY_OVERALL_STATUS_INVALID');
  const observation = summary.observation, feature = summary.features;
  requireCheck(summary.capabilities?.observation === observation?.status &&
    summary.capabilities?.features === feature?.status, 'SUMMARY_CAPABILITY_MISMATCH');
  for (const item of [observation, feature]) {
    if (item?.inputCutoffMs != null) requireCheck(Number.isSafeInteger(item.inputCutoffMs) &&
      item.inputCutoffMs > 0 && item.inputCutoffMs <= referenceMs, 'SUMMARY_FUTURE_INPUT');
  }
  if (observation?.status === 'AVAILABLE') requireCheck(observation.source === 'CANDIDATE' &&
    Number.isSafeInteger(observation.observedAtMs) && observation.observedAtMs <= observation.inputCutoffMs &&
    observation.ageMs === referenceMs - observation.observedAtMs && observation.ageMs >= 0 &&
    observation.ageMs <= maxObservationAgeMs, 'SUMMARY_OBSERVATION_AGE_MISMATCH');
  if (feature?.inputCutoffMs != null) requireCheck(feature.ageMs === referenceMs - feature.inputCutoffMs,
    'SUMMARY_FEATURE_AGE_MISMATCH');
  // Requests can observe different rows. Compare quality only for the same stored input.
  if (storedFeature?.featureVersion === 2 && feature?.inputCutoffMs != null &&
      storedFeature.inputCutoffMs === feature.inputCutoffMs) {
    const expectedQuality = ['VERIFIED','RECENT_FETCH','UNVERIFIED_TIME','STALE_INPUT','MISSING_INPUT']
      .includes(storedFeature.qualityCeiling) ? storedFeature.qualityCeiling : 'UNKNOWN';
    requireCheck(feature.quality === expectedQuality, 'SUMMARY_FEATURE_QUALITY_NOT_PRESERVED');
  }
  if (feature?.status === 'AVAILABLE') requireCheck(feature.featureVersion === 2 && feature.ageMs >= 0 &&
    feature.ageMs <= maxFeatureAgeMs && ['VERIFIED','RECENT_FETCH','UNVERIFIED_TIME'].includes(feature.quality),
    'SUMMARY_FEATURE_QUALITY_PROMOTED');
  requireCheck(['OK','NOT_FOUND','FAILED'].includes(summary.featureRead?.status), 'SUMMARY_FEATURE_READ_STATUS_MISSING');
  // Missing telemetry is unknown, never verified zero, even when missing/failed Feature is a supported response.
  assertReadMeta(summary.queryMeta?.observation);
  assertReadMeta(summary.queryMeta?.feature);
  requireCheck(summary.featureRead.status === 'OK', 'SUMMARY_FEATURE_READ_FAILED');
  requireCheck(summary.sourceQuality?.scope === 'CAPTURE_REPORTED_NOT_READ_TIME_REVALIDATED' &&
    Array.isArray(summary.sourceQuality.reasonCodes) && summary.sourceQuality.reasonCodes.every(code =>
      /^(PROGRAM|KOSPI|KOSPI200|SAMSUNG|SK_HYNIX|FUTURES|FUTURES_INVESTORS)_(STALE|MISSING|ERROR|UNVERIFIED_TIME|UNVERIFIED_MARKET_TIME)$/.test(code)),
    'SUMMARY_QUALITY_CONTRACT_INVALID');
  return {status: summary.status, serviceReleaseVersion: 3, runtimeReportedSha: summary.release.workerGitSha,
    evaluationReferenceMs: referenceMs, observationAgeMs: observation?.ageMs ?? null,
    featureAgeMs: feature?.ageMs ?? null, featureInputCutoffMs: feature?.inputCutoffMs ?? null,
    featureStatus: feature?.status, featureQuality: feature?.quality,
    pipelineStatus: observation?.pipelineStatus, sourceQuality: summary.sourceQuality.status,
    d1Writes: 0, privateCapabilities: 'UNAVAILABLE', scope: 'AUTHENTICATED_CANDIDATE_NOT_PRODUCTION_OR_SCHEDULER'};
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
      : ({'/':'ROOT','/health':'HEALTH','/state':'STATE','/features':'FEATURES','/history':'HISTORY','/summary':'SUMMARY'}[route] || 'UNKNOWN');
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
  const summaryPath = `/summary?cutoffMs=${now}&maxObservationAgeMs=180000&maxFeatureAgeMs=300000`;
  await request(summaryPath, null, 401);
  await request(summaryPath, 'deliberately-invalid-candidate-smoke-token', 401);
  const summary = assertSummary(await request(summaryPath), {
    expectedSha, referenceMs: now, maxObservationAgeMs: 180000, maxFeatureAgeMs: 300000,
    storedFeature: features.feature
  });
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
    summary, d1Writes: 0, liveMarketGate: 'UNCHANGED', deployment: 'NOT_PERFORMED'};
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
