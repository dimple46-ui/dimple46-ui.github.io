# Schema

Latest snapshot schemaVersion stays 3; history is a separate version 1 schema.

market_observations: slot_ms INTEGER primary key, observed_at_ms (relay build time), available_at_ms (information cutoff), trading_day (KST YYYYMMDD), schema_version, quality_version, pipeline_status, metrics_json, quality_json, features_json.

Unique slot uses INSERT ON CONFLICT DO NOTHING. Observation is immutable; features_json is filled only if null. Failure between insert and feature update leaves a recoverable row with null features. The migration is additive and explicit; no CREATE TABLE on each Cron.

Each metric retains value (null allowed), status, source marketTime, fetchedAt, timeBasis, availableAt. Missing/stale values remain in history for auditing but cannot feed changes. Source grouping comes from the metric path and existing timeBasis; the underlying payload quality flags are preserved. Only whitelisted public market data is stored, not env or personal portfolio.

Units: stocks KRW/share; stock volume and estimated flows shares; stock tradingValue and market/program flows KRW; index points use normalizedValue; futures price/basis points; futures investor flows and OI contracts. Window price returns percent; relative return percentage points; volume acceleration shares/minute change.

quality_json retains source error identifiers, dataQuality and futures contract code. Production
MVP rows continue to use Feature version 1 in `market_observations.features_json`.

Feature Engine 2.0 candidate output uses the separate additive `feature_runs` table keyed by
`(slot_ms, feature_version)`. It records engine Git/source hashes, generation and input-cutoff
times, quality ceiling, generation status, compact feature JSON and validation metadata. It does
not rewrite v1 observations. Compact `encodingVersion: 1` contains 2/5/10/30-minute windows,
same-time statistics, relative strength, divergence state and explicit null/quality states. The
latest-snapshot `schemaVersion` remains 3. See `FEATURE_STORAGE.md`.
