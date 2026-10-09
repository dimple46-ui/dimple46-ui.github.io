import {summarizeJsonGrowth} from "./operational-storage-policy.mjs";

const API_SCHEMA_VERSION = 1;
const SUPPORTED_FEATURE_VERSION = 2;
const SERVICE_RELEASE_VERSION = 2;
const MAX_HISTORY_RANGE_MS = 12 * 60 * 60 * 1000;
const MAX_HISTORY_LIMIT = 120;
const MAX_RESPONSE_BYTES = 900000;
const DEFAULT_RATE_LIMIT = 60;
const DEFAULT_QUERY_TIMEOUT_MS = 5000;
const ALLOWED_TICKERS = Object.freeze({"005930": "samsung", "000660": "skHynix"});
const SHARED_HISTORY_PREFIXES = ["kospi.", "kospi200.", "market.", "program.", "futures."];

const rateWindows = new Map();
const runtime = {startedAtMs: Date.now(), requests: 0, failures: 0, rateLimited: 0};

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

function authenticated(request, env) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") && safeEqual(header.slice(7), env.INTELLIGENCE_READ_TOKEN);
}

function tickerScope(url, {required = false, allowAll = true} = {}) {
  const raw = url.searchParams.get("ticker");
  if (!raw) {
    if (required) throw new ApiError(400, "TICKER_REQUIRED");
    return {ticker: "ALL", metricPrefix: null};
  }
  if (allowAll && raw === "ALL") return {ticker: "ALL", metricPrefix: null};
  const metricPrefix = ALLOWED_TICKERS[raw];
  if (!metricPrefix) throw new ApiError(400, "INVALID_TICKER");
  return {ticker: raw, metricPrefix};
}

function boundedInteger(raw, {name, minimum, maximum, fallback}) {
  if (raw == null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new ApiError(400, `INVALID_${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new ApiError(400, `INVALID_${name}`);
  return value;
}

function cutoffFrom(url, now) {
  return boundedInteger(url.searchParams.get("cutoffMs"), {
    name: "CUTOFF", minimum: 1, maximum: now, fallback: now
  });
}

function enforceRateLimit(request, env, now) {
  const configured = Number(env.INTELLIGENCE_RATE_LIMIT_PER_MINUTE || DEFAULT_RATE_LIMIT);
  const limit = Number.isFinite(configured) ? Math.min(600, Math.max(1, Math.trunc(configured))) : DEFAULT_RATE_LIMIT;
  const client = request.headers.get("CF-Connecting-IP") || "unknown";
  const window = Math.floor(now / 60000);
  const key = `${client}:${window}`;
  const count = (rateWindows.get(key) || 0) + 1;
  rateWindows.set(key, count);
  if (rateWindows.size > 2048) {
    for (const existing of rateWindows.keys()) if (!existing.endsWith(`:${window}`)) rateWindows.delete(existing);
  }
  if (count > limit) {
    runtime.rateLimited++;
    throw new ApiError(429, "RATE_LIMITED");
  }
  return {limit, remaining: Math.max(0, limit - count), scope: "WORKER_ISOLATE_BEST_EFFORT"};
}

function d1Meta(result) {
  const meta = result?.meta || {};
  const finite = value => value == null || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    durationMs: finite(meta.duration), rowsRead: finite(meta.rows_read), rowsWritten: finite(meta.rows_written),
    changes: finite(meta.changes), servedBy: meta.served_by ?? null
  };
}

async function select(db, sql, parameters = []) {
  if (!db?.prepare) throw new Error("D1_UNAVAILABLE");
  const normalized = String(sql || "").trim();
  if (!/^SELECT\b/i.test(normalized) || /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA|ATTACH|DETACH)\b/i.test(normalized))
    throw new Error("READ_ONLY_SQL_REQUIRED");
  let statement = db.prepare(sql);
  if (parameters.length) statement = statement.bind(...parameters);
  const result = await statement.all();
  if (!result?.success) throw new Error("D1_READ_FAILED");
  return {rows: result.results || [], meta: d1Meta(result)};
}

function storedJson(value) {
  try {
    const parsed = JSON.parse(value || "null");
    if (!parsed || typeof parsed !== "object") throw new Error("not object");
    return parsed;
  } catch {
    throw new ApiError(409, "STORED_JSON_INVALID");
  }
}

function publicObservation(row, metricPrefix = null) {
  const allMetrics = storedJson(row.metrics_json);
  const metrics = metricPrefix ? Object.fromEntries(Object.entries(allMetrics).filter(([name]) =>
    name.startsWith(`${metricPrefix}.`) || SHARED_HISTORY_PREFIXES.some(prefix => name.startsWith(prefix)))) : allMetrics;
  return {
    slotMs: row.slot_ms, observedAtMs: row.observed_at_ms, availableAtMs: row.available_at_ms,
    tradingDay: row.trading_day, schemaVersion: row.schema_version, qualityVersion: row.quality_version,
    pipelineStatus: row.pipeline_status, metrics, quality: storedJson(row.quality_json)
  };
}

function responseMetadata({schemaVersion = API_SCHEMA_VERSION, featureVersion = null, generatedAtMs,
  inputCutoffMs, observedAtMs = null, freshnessReferenceMs = inputCutoffMs,
  quality = null, pipelineStatus = null}) {
  return {
    schema_version: schemaVersion,
    feature_version: featureVersion,
    generated_at: generatedAtMs == null ? null : new Date(generatedAtMs).toISOString(),
    input_cutoff: inputCutoffMs == null ? null : new Date(inputCutoffMs).toISOString(),
    freshness: observedAtMs == null || freshnessReferenceMs == null ? null : {
      age_ms: Math.max(0, freshnessReferenceMs - observedAtMs),
      basis: "AS_OF_MINUS_OBSERVED_AT"
    },
    quality,
    pipeline_status: pipelineStatus
  };
}

function publicFeature(row) {
  const compactFeatures = storedJson(row.compact_features_json);
  const validation = storedJson(row.validation_json);
  const valid = row.feature_version === SUPPORTED_FEATURE_VERSION &&
    compactFeatures.featureVersion === row.feature_version && validation.featureVersion === row.feature_version &&
    row.input_cutoff_ms === row.observed_at_ms && row.generated_at_ms >= row.input_cutoff_ms &&
    /^[0-9a-f]{7,64}$/i.test(String(row.engine_git_sha || "")) &&
    /^[0-9a-f]{64}$/i.test(String(row.engine_source_sha256 || ""));
  if (!valid) throw new ApiError(409, "STORED_FEATURE_INTEGRITY_ERROR");
  return {
    slotMs: row.slot_ms, featureVersion: row.feature_version, observedAtMs: row.observed_at_ms,
    tradingDay: row.trading_day, engineGitSha: row.engine_git_sha, engineSourceSha256: row.engine_source_sha256,
    generatedAtMs: row.generated_at_ms, inputCutoffMs: row.input_cutoff_ms,
    qualityCeiling: row.quality_ceiling, generationStatus: row.generation_status,
    compactFeatures, validation
  };
}

function response(payload, status = 200, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).length > MAX_RESPONSE_BYTES)
    return response({error: "RESPONSE_TOO_LARGE"}, 413);
  return new Response(body, {status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", ...extraHeaders
  }});
}

async function enforceProviderRateLimit(url, env) {
  if (!env.INTELLIGENCE_RATE_LIMITER?.limit)
    throw new ApiError(503, "PROVIDER_RATE_LIMIT_UNAVAILABLE");
  const result = await env.INTELLIGENCE_RATE_LIMITER.limit({key: `candidate-v1:${url.pathname}`});
  if (!result?.success) throw new ApiError(429, "RATE_LIMITED");
  return {scope: "CLOUDFLARE_RATE_LIMIT_BINDING"};
}

function queryTimeoutMs(env) {
  const configured = Number(env.INTELLIGENCE_QUERY_TIMEOUT_MS || DEFAULT_QUERY_TIMEOUT_MS);
  return Number.isFinite(configured) ? Math.min(10000, Math.max(100, Math.trunc(configured))) : DEFAULT_QUERY_TIMEOUT_MS;
}

function withDeadline(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new ApiError(504, "QUERY_TIMEOUT")), timeoutMs); })
  ]).finally(() => clearTimeout(timer));
}

async function health(db, now, env) {
  const [observation, feature, observationGrowth, featureGrowth] = await Promise.all([
    select(db, `SELECT slot_ms,observed_at_ms,available_at_ms,trading_day,schema_version,quality_version,
      pipeline_status,metrics_json,quality_json FROM market_observations ORDER BY slot_ms DESC LIMIT 1`),
    select(db, `SELECT * FROM feature_runs WHERE feature_version = ? ORDER BY slot_ms DESC LIMIT 1`, [SUPPORTED_FEATURE_VERSION]),
    select(db, `SELECT trading_day,COUNT(*) AS row_count,
      SUM(length(metrics_json)+length(quality_json)+coalesce(length(features_json),0)) AS json_bytes
      FROM market_observations GROUP BY trading_day ORDER BY trading_day DESC LIMIT 5`),
    select(db, `SELECT trading_day,COUNT(*) AS row_count,
      SUM(length(compact_features_json)+length(validation_json)) AS json_bytes
      FROM feature_runs WHERE feature_version = ? GROUP BY trading_day ORDER BY trading_day DESC LIMIT 5`,
      [SUPPORTED_FEATURE_VERSION])
  ]);
  const raw = observation.rows[0];
  const run = feature.rows[0];
  const quality = raw ? storedJson(raw.quality_json) : null;
  const deploymentId = env.CF_VERSION_METADATA?.id || null;
  const deploymentTag = env.CF_VERSION_METADATA?.tag || null;
  const deploymentTimestamp = env.CF_VERSION_METADATA?.timestamp || null;
  const workerGitSha = /^[0-9a-f]{7,64}$/i.test(String(env.INTELLIGENCE_WORKER_GIT_SHA || "")) ?
    env.INTELLIGENCE_WORKER_GIT_SHA : null;
  return {
    service: "market-intelligence-read-candidate", apiSchemaVersion: API_SCHEMA_VERSION, readOnly: true,
    metadata: responseMetadata({schemaVersion: raw?.schema_version ?? API_SCHEMA_VERSION,
      featureVersion: run?.feature_version ?? null, generatedAtMs: now,
      inputCutoffMs: run?.input_cutoff_ms ?? raw?.available_at_ms ?? null,
      observedAtMs: raw?.observed_at_ms ?? null, freshnessReferenceMs: now,
      quality: run?.quality_ceiling ?? null,
      pipelineStatus: raw?.pipeline_status ?? "NO_OBSERVATIONS"}),
    release: {serviceReleaseVersion: SERVICE_RELEASE_VERSION,
      supportedFeatureVersion: SUPPORTED_FEATURE_VERSION, workerGitSha, deploymentId,
      deploymentTag, deploymentTimestamp},
    nowMs: now, collectionHealth: raw ? raw.pipeline_status : "NO_OBSERVATIONS",
    latestObservation: raw ? {slotMs: raw.slot_ms, observedAtMs: raw.observed_at_ms,
      ageMs: Math.max(0, now - raw.observed_at_ms), tradingDay: raw.trading_day,
      schemaVersion: raw.schema_version, sourceErrors: quality?.sourceErrors || []} : null,
    latestFeatureRun: run ? {slotMs: run.slot_ms, featureVersion: run.feature_version,
      generationStatus: run.generation_status, qualityCeiling: run.quality_ceiling,
      inputCutoffMs: run.input_cutoff_ms, generatedAtMs: run.generated_at_ms} : null,
    storageGrowth: {scope: "LATEST_FIVE_TRADING_DAYS_JSON_ONLY",
      observations: observationGrowth.rows, featureRuns: featureGrowth.rows,
      observationProjection: summarizeJsonGrowth(observationGrowth.rows),
      featureRunProjection: summarizeJsonGrowth(featureGrowth.rows)},
    queryMeta: {observation: observation.meta, feature: feature.meta,
      observationGrowth: observationGrowth.meta, featureGrowth: featureGrowth.meta},
    runtime: {...runtime, scope: "WORKER_ISOLATE_LIFETIME"},
    limitations: ["JSON byte totals exclude SQLite pages, indexes and replication overhead",
      "Failure count is per Worker isolate; provider-level and isolate fallback rate limiting are configured"]
  };
}

async function state(db, cutoffMs, now, scope) {
  const result = await select(db, `SELECT slot_ms,observed_at_ms,available_at_ms,trading_day,schema_version,
    quality_version,pipeline_status,metrics_json,quality_json FROM market_observations
    WHERE available_at_ms <= ? ORDER BY slot_ms DESC LIMIT 1`, [cutoffMs]);
  if (!result.rows[0]) throw new ApiError(404, "STATE_NOT_FOUND");
  const row = result.rows[0];
  const state = publicObservation(row, scope.metricPrefix);
  return {apiSchemaVersion: API_SCHEMA_VERSION, inputCutoffMs: cutoffMs, scope: {ticker: scope.ticker},
    metadata: responseMetadata({schemaVersion: row.schema_version, generatedAtMs: now,
      inputCutoffMs: cutoffMs, observedAtMs: row.observed_at_ms,
      freshnessReferenceMs: cutoffMs,
      quality: state.quality?.dataQuality ?? state.quality ?? null, pipelineStatus: row.pipeline_status}),
    state, queryMeta: result.meta};
}

async function features(db, url, cutoffMs, now, scope) {
  const featureVersion = boundedInteger(url.searchParams.get("featureVersion"), {
    name: "FEATURE_VERSION", minimum: SUPPORTED_FEATURE_VERSION, maximum: SUPPORTED_FEATURE_VERSION,
    fallback: SUPPORTED_FEATURE_VERSION
  });
  const slotMs = boundedInteger(url.searchParams.get("slotMs"), {
    name: "SLOT", minimum: 1, maximum: cutoffMs, fallback: null
  });
  const result = slotMs == null ?
    await select(db, `SELECT * FROM feature_runs WHERE feature_version = ? AND input_cutoff_ms <= ?
      ORDER BY slot_ms DESC LIMIT 1`, [featureVersion, cutoffMs]) :
    await select(db, `SELECT * FROM feature_runs WHERE feature_version = ? AND slot_ms = ?
      AND input_cutoff_ms <= ? LIMIT 1`, [featureVersion, slotMs, cutoffMs]);
  if (!result.rows[0]) throw new ApiError(404, "FEATURES_NOT_FOUND");
  const feature = publicFeature(result.rows[0]);
  return {apiSchemaVersion: API_SCHEMA_VERSION, inputCutoffMs: cutoffMs, scope: {ticker: scope.ticker},
    metadata: responseMetadata({schemaVersion: API_SCHEMA_VERSION, featureVersion: feature.featureVersion,
      generatedAtMs: feature.generatedAtMs, inputCutoffMs: feature.inputCutoffMs,
      observedAtMs: feature.observedAtMs, freshnessReferenceMs: cutoffMs,
      quality: feature.qualityCeiling,
      pipelineStatus: feature.generationStatus}),
    feature, queryMeta: result.meta};
}

async function history(db, url, cutoffMs, now, scope) {
  const toMs = boundedInteger(url.searchParams.get("toMs"), {
    name: "TO", minimum: 1, maximum: cutoffMs, fallback: cutoffMs
  });
  const fromMs = boundedInteger(url.searchParams.get("fromMs"), {
    name: "FROM", minimum: 1, maximum: toMs - 1, fallback: Math.max(1, toMs - 60 * 60 * 1000)
  });
  if (toMs - fromMs > MAX_HISTORY_RANGE_MS) throw new ApiError(400, "HISTORY_RANGE_TOO_LARGE");
  const limit = boundedInteger(url.searchParams.get("limit"), {
    name: "LIMIT", minimum: 1, maximum: MAX_HISTORY_LIMIT, fallback: 30
  });
  const result = await select(db, `SELECT slot_ms,observed_at_ms,available_at_ms,trading_day,schema_version,
    quality_version,pipeline_status,metrics_json,quality_json FROM market_observations
    WHERE observed_at_ms BETWEEN ? AND ? AND available_at_ms <= ?
    ORDER BY slot_ms DESC LIMIT ?`, [fromMs, toMs, cutoffMs, limit]);
  const rows = result.rows.map(row => publicObservation(row, scope.metricPrefix)).reverse();
  const latest = rows.at(-1) || null;
  return {apiSchemaVersion: API_SCHEMA_VERSION, inputCutoffMs: cutoffMs, scope: {ticker: scope.ticker},
    metadata: responseMetadata({schemaVersion: latest?.schemaVersion ?? API_SCHEMA_VERSION,
      generatedAtMs: now, inputCutoffMs: cutoffMs, observedAtMs: latest?.observedAtMs ?? null,
      freshnessReferenceMs: cutoffMs,
      quality: latest?.quality?.dataQuality ?? latest?.quality ?? null,
      pipelineStatus: latest?.pipelineStatus ?? null}),
    range: {fromMs, toMs, limit, returned: rows.length}, rows, queryMeta: result.meta};
}

export default {
  async fetch(request, env) {
    if (!authenticated(request, env)) return response({error: "UNAUTHORIZED"}, 401);
    if (request.method !== "GET") return response({error: "METHOD_NOT_ALLOWED"}, 405);
    const now = Date.now();
    let rate;
    try {
      rate = enforceRateLimit(request, env, now);
      runtime.requests++;
      const url = new URL(request.url);
      const providerRate = await enforceProviderRateLimit(url, env);
      const cutoffMs = cutoffFrom(url, now);
      let operation;
      if (url.pathname === "/health") operation = health(env.MARKET_HISTORY, now, env);
      else if (url.pathname === "/state") operation = state(env.MARKET_HISTORY, cutoffMs, now, tickerScope(url));
      else if (url.pathname === "/features") operation = features(env.MARKET_HISTORY, url, cutoffMs, now, tickerScope(url));
      else if (url.pathname === "/history") operation = history(env.MARKET_HISTORY, url, cutoffMs, now,
        tickerScope(url, {required: true, allowAll: false}));
      else throw new ApiError(404, "NOT_FOUND");
      const payload = await withDeadline(operation, queryTimeoutMs(env));
      return response(payload, 200, {
        "X-RateLimit-Limit": String(rate.limit), "X-RateLimit-Remaining": String(rate.remaining),
        "X-RateLimit-Scope": `${providerRate.scope}+${rate.scope}`
      });
    } catch (error) {
      if (error instanceof ApiError) return response({error: error.code}, error.status,
        error.status === 429 ? {"Retry-After": "60"} : {});
      runtime.failures++;
      console.error(JSON.stringify({event: "INTELLIGENCE_READ_FAILURE", path: new URL(request.url).pathname}));
      return response({error: "INTELLIGENCE_READ_FAILED"}, 503);
    }
  }
};
