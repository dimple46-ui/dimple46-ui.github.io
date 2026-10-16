export const SIGNAL_VERSION = 2;
const FEATURE_VERSION = 2;
const CONFIDENCE_LEVELS = ["NONE", "LOW", "MEDIUM", "HIGH"];
const QUALITY_ORDER = [
  "VERIFIED", "RECENT_FETCH", "UNVERIFIED_TIME", "UNKNOWN",
  "STALE_INPUT", "MISSING_INPUT", "UNUSABLE_INPUT"
];

const STOCKS = {
  samsung: {ticker: "005930", name: "Samsung Electronics"},
  skHynix: {ticker: "000660", name: "SK Hynix"}
};

function qualityOf(value) {
  return value?.quality || "UNKNOWN";
}

function worstQuality(values) {
  let rank = 0;
  for (const value of values) {
    const quality = typeof value === "string" ? value : qualityOf(value);
    const index = QUALITY_ORDER.indexOf(quality);
    rank = Math.max(rank, index < 0 ? QUALITY_ORDER.indexOf("UNKNOWN") : index);
  }
  return QUALITY_ORDER[rank];
}

function confidenceCeiling(quality) {
  if (quality === "VERIFIED") return "HIGH";
  if (quality === "RECENT_FETCH" || quality === "UNVERIFIED_TIME") return "MEDIUM";
  if (quality === "UNKNOWN" || quality === "STALE_INPUT") return "LOW";
  return "NONE";
}

function cappedConfidence(base, quality) {
  const ceiling = confidenceCeiling(quality);
  const level = CONFIDENCE_LEVELS[Math.min(CONFIDENCE_LEVELS.indexOf(base), CONFIDENCE_LEVELS.indexOf(ceiling))];
  return {level, ceiling, meaning: "DESCRIPTIVE_EVIDENCE_CONFIDENCE_NOT_PREDICTIVE_PROBABILITY"};
}

function usableMetric(metric, statuses = ["OK", "VALID", "BUCKET_DELTA", "BUCKET_CHANGE_ONLY"]) {
  return metric && typeof metric.value === "number" && Number.isFinite(metric.value) &&
    statuses.includes(metric.status) && confidenceCeiling(qualityOf(metric)) !== "NONE" && qualityOf(metric) !== "STALE_INPUT";
}

function strengthFrom(current, acceleration = null) {
  const denominator = Math.max(Math.abs(current), 1);
  const ratio = acceleration == null ? 0 : Math.abs(acceleration) / denominator;
  if (ratio >= 1) return "STRONG";
  if (ratio >= 0.25) return "MODERATE";
  return "WEAK";
}

function stableSignalId({inputCutoff, ticker, horizon, signalType}) {
  return `s${SIGNAL_VERSION}:${inputCutoff}:${ticker}:${horizon}:${signalType}`;
}

function flowSignalType(prefix, currentDelta, acceleration) {
  const previousDelta = currentDelta - acceleration;
  if (Math.sign(previousDelta) !== 0 && Math.sign(currentDelta) !== 0 &&
    Math.sign(previousDelta) !== Math.sign(currentDelta)) return `${prefix}_FLOW_REVERSAL`;
  if (currentDelta > 0 && acceleration > 0) return `${prefix}_BUYING_ACCELERATING`;
  if (currentDelta < 0 && acceleration < 0) return `${prefix}_SELLING_ACCELERATING`;
  if (currentDelta < 0 && acceleration > 0) return `${prefix}_SELLING_DECELERATING`;
  if (currentDelta > 0 && acceleration < 0) return `${prefix}_BUYING_DECELERATING`;
  return null;
}

function createSignal(context, definition) {
  const quality = worstQuality(definition.qualityInputs || []);
  if (["STALE_INPUT", "MISSING_INPUT", "UNUSABLE_INPUT"].includes(quality)) return null;
  const baseConfidence = definition.supportingEvidence.length >= 3 && definition.contraryEvidence.length === 0 ? "HIGH" :
    definition.supportingEvidence.length >= 2 ? "MEDIUM" : "LOW";
  const signal = {
    signal_id: stableSignalId({inputCutoff: context.inputCutoff, ticker: definition.ticker,
      horizon: definition.horizon, signalType: definition.signalType}),
    generated_at: context.generatedAt,
    input_cutoff: context.inputCutoff,
    ticker: definition.ticker,
    horizon: definition.horizon,
    signal_type: definition.signalType,
    state: "ACTIVE",
    strength: definition.strength,
    confidence: cappedConfidence(baseConfidence, quality),
    supporting_evidence: definition.supportingEvidence,
    contrary_evidence: definition.contraryEvidence,
    invalidation: definition.invalidation,
    data_quality: {ceiling: quality, feature_quality_inputs: (definition.qualityInputs || []).map(qualityOf)},
    feature_version: FEATURE_VERSION,
    signal_version: SIGNAL_VERSION,
    engine_git_sha: context.engineGitSha
  };
  return signal.confidence.level === "NONE" ? null : signal;
}

function addStockFlowSignals(signals, features, context) {
  for (const [stock, identity] of Object.entries(STOCKS)) {
    for (const [flowName, prefix] of [["foreignFlow", "FOREIGN"], ["institutionFlow", "INSTITUTION"]]) {
      const flow = features.bucketChanges?.[stock]?.[flowName];
      if (!usableMetric(flow, ["BUCKET_DELTA"]) || !Number.isFinite(flow.acceleration)) continue;
      if (!Number.isFinite(flow.value - flow.acceleration)) continue;
      const signalType = flowSignalType(prefix, flow.value, flow.acceleration);
      if (!signalType) continue;
      const previousDelta = flow.value - flow.acceleration;
      const reversal = signalType.endsWith("FLOW_REVERSAL");
      signals.push(createSignal(context, {
        ticker: identity.ticker, horizon: "BUCKET", signalType,
        strength: strengthFrom(flow.value, flow.acceleration), qualityInputs: [flow],
        supportingEvidence: reversal ? [
          {metric: `${stock}.${flowName}PreviousDelta`, value: previousDelta},
          {metric: `${stock}.${flowName}CurrentDelta`, value: flow.value}
        ] : [
          {metric: `${stock}.${flowName}Delta`, value: flow.value},
          {metric: `${stock}.${flowName}Acceleration`, value: flow.acceleration}
        ],
        contraryEvidence: [], invalidation: reversal ?
          ["NEXT_BUCKET_RETURNS_TO_PREVIOUS_DIRECTION", "INPUT_QUALITY_BECOMES_UNUSABLE"] :
          ["NEXT_BUCKET_ACCELERATION_CHANGES", "INPUT_QUALITY_BECOMES_UNUSABLE"]
      }));
    }
  }
}

function addProgramSignals(signals, features, context, horizon) {
  const window = features.windows?.[horizon];
  const flow = window?.metrics?.["program.totalNet"];
  const acceleration = window?.acceleration?.["program.totalNet"];
  if (!usableMetric(flow) || !usableMetric(acceleration)) return;
  let signalType = null;
  if (flow.value > 0 && acceleration.value > 0) signalType = "PROGRAM_BUYING_ACCELERATING";
  else if (flow.value < 0 && acceleration.value < 0) signalType = "PROGRAM_SELLING_ACCELERATING";
  if (!signalType) return;
  signals.push(createSignal(context, {
    ticker: "MARKET", horizon, signalType, strength: strengthFrom(flow.value, acceleration.value),
    qualityInputs: [flow, acceleration], supportingEvidence: [
      {metric: "program.totalNetDelta", value: flow.value},
      {metric: "program.totalNetAcceleration", value: acceleration.value}
    ], contraryEvidence: [], invalidation: ["PROGRAM_ACCELERATION_CHANGES_SIGN", "PROGRAM_INPUT_BECOMES_UNUSABLE"]
  }));
}

function addFuturesSignals(signals, features, context, horizon) {
  const window = features.windows?.[horizon];
  const position = window?.futuresPosition;
  if (!position || position.status !== "VALID" || !position.state || ["MIXED_OR_FLAT"].includes(position.state)) return;
  const qualityInputs = [position];
  const stateMap = {
    NEW_LONG_CANDIDATE: "OI_NEW_LONG_CANDIDATE",
    NEW_SHORT_CANDIDATE: "OI_NEW_SHORT_CANDIDATE",
    SHORT_COVER_CANDIDATE: "OI_SHORT_COVER_CANDIDATE",
    LONG_LIQUIDATION_CANDIDATE: "OI_LONG_LIQUIDATION_CANDIDATE"
  };
  const signalType = stateMap[position.state];
  if (!signalType) return;
  const supporting = position.supportingEvidence || [];
  const contrary = position.contraryEvidence || [];
  signals.push(createSignal(context, {
    ticker: "KOSPI200_FUTURES", horizon, signalType,
    strength: supporting.length >= 3 && contrary.length === 0 ? "STRONG" : "MODERATE",
    qualityInputs, supportingEvidence: supporting, contraryEvidence: contrary,
    invalidation: ["PRICE_OR_OPEN_INTEREST_DIRECTION_CHANGES", "FUTURES_CONTRACT_CHANGES"]
  }));
  const riskType = ["NEW_LONG_CANDIDATE", "SHORT_COVER_CANDIDATE"].includes(position.state) ? "FUTURES_RISK_ON" : "FUTURES_RISK_OFF";
  signals.push(createSignal(context, {
    ticker: "KOSPI200_FUTURES", horizon, signalType: riskType,
    strength: supporting.length >= 3 && contrary.length === 0 ? "STRONG" : "MODERATE",
    qualityInputs, supportingEvidence: supporting, contraryEvidence: contrary,
    invalidation: ["FUTURES_POSITION_CLASSIFICATION_CHANGES", "FUTURES_INPUT_BECOMES_UNUSABLE"]
  }));
}

function addRelativeStrengthSignal(signals, features, context, horizon) {
  const window = features.windows?.[horizon];
  const samsung = window?.momentumAcceleration?.samsung;
  const hynix = window?.momentumAcceleration?.skHynix;
  if (!usableMetric(samsung) || !usableMetric(hynix)) return;
  const difference = samsung.value - hynix.value;
  if (!Number.isFinite(difference) || difference === 0) return;
  signals.push(createSignal(context, {
    ticker: "005930/000660", horizon,
    signalType: difference > 0 ? "RELATIVE_STRENGTH_IMPROVING" : "RELATIVE_STRENGTH_WEAKENING",
    strength: strengthFrom(difference), qualityInputs: [samsung, hynix],
    supportingEvidence: [{metric: "samsung.momentumAcceleration", value: samsung.value},
      {metric: "skHynix.momentumAcceleration", value: hynix.value},
      {metric: "relativeMomentumAcceleration", value: difference}],
    contraryEvidence: [], invalidation: ["RELATIVE_MOMENTUM_ACCELERATION_CHANGES_SIGN"]
  }));
}

function addDivergenceSignals(signals, features, context, horizon) {
  const divergences = features.windows?.[horizon]?.divergences || {};
  for (const [name, value] of Object.entries(divergences)) {
    if (!value || value.status !== "VALID" || !value.state || ["CONFIRMING", "MIXED_OR_FLAT"].includes(value.state)) continue;
    const cashFutures = name === "cashVsFutures";
    const ticker = name.startsWith("skHynix") ? "000660" : name.startsWith("samsung") ? "005930" : "MARKET";
    signals.push(createSignal(context, {
      ticker, horizon, signalType: cashFutures ? "CASH_FUTURES_DIVERGENCE" : "PRICE_FLOW_DIVERGENCE",
      strength: value.strength == null ? "MODERATE" : strengthFrom(value.strength), qualityInputs: [value],
      supportingEvidence: value.supportingEvidence || [{metric: name, state: value.state}],
      contraryEvidence: value.contraryEvidence || [], invalidation: ["DIVERGENCE_RETURNS_TO_CONFIRMING", "INPUT_QUALITY_BECOMES_UNUSABLE"]
    }));
  }
}

function addAbnormalVolumeSignals(signals, features, context) {
  const window = features.sameTimeHistorical?.windows?.["5d"];
  for (const [stock, identity] of Object.entries(STOCKS)) {
    const metric = window?.metrics?.[`${stock}.volume`];
    if (!usableMetric(metric, ["VALID"]) || metric.value < 0) continue;
    const percentile = Number.isFinite(metric.percentile) && metric.percentile >= 0 && metric.percentile <= 100
      ? metric.percentile : null;
    const zScore = Number.isFinite(metric.zScore) ? metric.zScore : null;
    if (!((percentile != null && percentile >= 95) || (zScore != null && zScore >= 2))) continue;
    signals.push(createSignal(context, {
      ticker: identity.ticker, horizon: "SAME_TIME_5D", signalType: "ABNORMAL_VOLUME", strength: "STRONG",
      qualityInputs: [metric], supportingEvidence: [
        {metric: `${stock}.volume`, value: metric.value}, {metric: "sameTimePercentile", value: percentile},
        {metric: "sameTimeZScore", value: zScore}
      ], contraryEvidence: [], invalidation: ["SAME_TIME_PERCENTILE_FALLS_BELOW_95_AND_ZSCORE_BELOW_2"]
    }));
  }
}

export function generateDescriptiveSignals(features, {engineGitSha, generatedAt} = {}) {
  if (features?.version !== FEATURE_VERSION) throw new Error("FEATURE_VERSION_MISMATCH");
  if (!/^[0-9a-f]{7,64}$/i.test(String(engineGitSha || ""))) throw new Error("INVALID_SIGNAL_ENGINE_GIT_SHA");
  const inputCutoffMs = Date.parse(features.inputCutoff);
  const generatedAtMs = generatedAt == null ? Date.now() : Date.parse(generatedAt);
  if (!Number.isFinite(inputCutoffMs) || !Number.isFinite(generatedAtMs) || generatedAtMs < inputCutoffMs)
    throw new Error("INVALID_SIGNAL_TIME");
  const context = {inputCutoff: new Date(inputCutoffMs).toISOString(), generatedAt: new Date(generatedAtMs).toISOString(), engineGitSha};
  const signals = [];
  addStockFlowSignals(signals, features, context);
  for (const horizon of ["5m", "10m", "30m"]) {
    addProgramSignals(signals, features, context, horizon);
    addFuturesSignals(signals, features, context, horizon);
    addRelativeStrengthSignal(signals, features, context, horizon);
    addDivergenceSignals(signals, features, context, horizon);
  }
  addAbnormalVolumeSignals(signals, features, context);
  return signals.filter(Boolean).filter((signal, index, all) =>
    all.findIndex(candidate => candidate.signal_id === signal.signal_id) === index);
}

