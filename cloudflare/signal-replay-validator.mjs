import {generateDescriptiveSignals, SIGNAL_VERSION} from './signal-engine.mjs';

const LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH'];
const STOCKS = ['samsung', 'skHynix'];
const FLOWS = ['foreignFlow', 'institutionFlow'];

function assertCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function finiteTime(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectQueryMeta(value, path = 'queryMeta', result = []) {
  if (!value || typeof value !== 'object') return result;
  if ('rowsWritten' in value || 'rows_written' in value) {
    result.push({path, rowsWritten: value.rowsWritten ?? value.rows_written});
    return result;
  }
  for (const [key, child] of Object.entries(value)) collectQueryMeta(child, `${path}.${key}`, result);
  return result;
}

function stockFlowSummary(features) {
  const result = {};
  for (const stock of STOCKS) {
    result[stock] = {};
    for (const flow of FLOWS) {
      const metric = features.bucketChanges?.[stock]?.[flow] || null;
      result[stock][flow] = metric == null ? null : {
        status: metric.status ?? null,
        delta: Number.isFinite(metric.value) ? metric.value : null,
        direction: metric.direction ?? null,
        acceleration: Number.isFinite(metric.acceleration) ? metric.acceleration : null,
        accelerationStatus: metric.accelerationStatus ?? null,
        quality: metric.quality ?? null
      };
    }
  }
  return result;
}

function assertFiniteEvidence(value) {
  if (typeof value === 'number') {
    assertCondition(Number.isFinite(value), 'NONFINITE_SIGNAL_EVIDENCE');
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) assertFiniteEvidence(child);
  }
}

function assertSignalSafety(signals, features) {
  for (const signal of signals) {
    assertCondition(Array.isArray(signal.supporting_evidence) && Array.isArray(signal.contrary_evidence),
      'INVALID_SIGNAL_EVIDENCE_SHAPE');
    assertFiniteEvidence(signal.supporting_evidence);
    assertFiniteEvidence(signal.contrary_evidence);
    assertCondition(!('probability' in signal), 'PREDICTIVE_PROBABILITY_NOT_ALLOWED');
    assertCondition(!('action' in signal), 'TRADING_ACTION_NOT_ALLOWED');
    assertCondition(!['BUY', 'SELL'].includes(signal.state), 'BUY_SELL_STATE_NOT_ALLOWED');
    const level = LEVELS.indexOf(signal.confidence?.level);
    const ceiling = LEVELS.indexOf(signal.confidence?.ceiling);
    assertCondition(level >= 0 && ceiling >= 0 && level <= ceiling, 'CONFIDENCE_CEILING_VIOLATION');
    assertCondition(signal.feature_version === 2, 'SIGNAL_FEATURE_VERSION_MISMATCH');
    assertCondition(signal.input_cutoff === features.inputCutoff, 'SIGNAL_INPUT_CUTOFF_MISMATCH');
  }
  for (const horizon of ['5m', '10m', '30m']) {
    const window = features.windows?.[horizon];
    const programInputs = [window?.metrics?.['program.totalNet'], window?.acceleration?.['program.totalNet']];
    if (programInputs.some(input => input?.quality === 'STALE_INPUT' || input?.value == null)) {
      assertCondition(!signals.some(signal => signal.horizon === horizon &&
        signal.signal_type?.startsWith('PROGRAM_')), 'STALE_PROGRAM_SIGNAL_EMITTED');
    }
  }
}

export function validateSignalReplay(replay, {engineGitSha, generatedAt} = {}) {
  assertCondition(replay?.mode === 'READ_ONLY_REPLAY', 'NOT_READ_ONLY_REPLAY');
  assertCondition(replay?.features?.version === 2, 'FEATURE_VERSION_MISMATCH');
  assertCondition(/^[0-9a-f]{7,64}$/i.test(String(engineGitSha || '')), 'INVALID_SIGNAL_ENGINE_GIT_SHA');
  const cutoffMs = finiteTime(replay.features.inputCutoff);
  const replayCutoffMs = finiteTime(replay.replayCutoffMs);
  assertCondition(cutoffMs != null && replayCutoffMs != null && cutoffMs <= replayCutoffMs,
    'FUTURE_DATA_LEAKAGE');
  const generatedAtMs = generatedAt == null ? Math.max(Date.now(), cutoffMs) : finiteTime(generatedAt);
  assertCondition(generatedAtMs != null && generatedAtMs >= cutoffMs, 'INVALID_SIGNAL_TIME');
  const generatedAtIso = new Date(generatedAtMs).toISOString();

  const queryMeta = collectQueryMeta(replay.queryMeta);
  assertCondition(queryMeta.length > 0, 'QUERY_META_MISSING');
  assertCondition(queryMeta.every(meta => meta.rowsWritten === 0), 'D1_WRITE_DETECTED');

  const options = {engineGitSha, generatedAt: generatedAtIso};
  const signals = generateDescriptiveSignals(replay.features, options);
  const repeated = generateDescriptiveSignals(replay.features, options);
  assertCondition(JSON.stringify(signals) === JSON.stringify(repeated), 'NON_DETERMINISTIC_SIGNAL_OUTPUT');
  assertSignalSafety(signals, replay.features);

  return {
    status: 'PASS',
    validationType: 'READ_ONLY_HISTORICAL_REPLAY',
    replayCutoffMs,
    inputCutoff: replay.features.inputCutoff,
    featureVersion: replay.features.version,
    signalVersion: signals[0]?.signal_version ?? SIGNAL_VERSION,
    signalCount: signals.length,
    signalTypes: [...new Set(signals.map(signal => signal.signal_type))].sort(),
    stockFlow: stockFlowSummary(replay.features),
    checks: {
      pastOnly: true,
      d1RowsWrittenZero: true,
      deterministic: true,
      confidenceCeiling: true,
      finiteNumericEvidence: true,
      staleNullSuppression: true,
      descriptiveOnly: true
    }
  };
}
