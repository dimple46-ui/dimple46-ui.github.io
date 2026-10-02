# Schema

Latest snapshot schemaVersion stays 3; history is a separate version 1 schema.

market_observations: slot_ms INTEGER primary key, observed_at_ms (relay build time), available_at_ms (information cutoff), trading_day (KST YYYYMMDD), schema_version, quality_version, pipeline_status, metrics_json, quality_json, features_json.

Unique slot uses INSERT ON CONFLICT DO NOTHING. Observation is immutable; features_json is filled only if null. Failure between insert and feature update leaves a recoverable row with null features. The migration is additive and explicit; no CREATE TABLE on each Cron.

Each metric retains value (null allowed), status, source marketTime, fetchedAt, timeBasis, availableAt. Missing/stale values remain in history for auditing but cannot feed changes. Source grouping comes from the metric path and existing timeBasis; the underlying payload quality flags are preserved. Only whitelisted public market data is stored, not env or personal portfolio.

Units: stocks KRW/share; stock volume and estimated flows shares; stock tradingValue and market/program flows KRW; index points use normalizedValue; futures price/basis points; futures investor flows and OI contracts. Window price returns percent; relative return percentage points; volume acceleration shares/minute change.

quality_json retains source error identifiers, dataQuality and futures contract code. Production MVP rows use Feature version 1. Feature Engine 2.0 candidate rows use `features_json.version: 2` and add 2/5/10/30-minute windows, same-time statistics, compact relative-strength locations, descriptive divergence events and explicit limitations. This is an additive JSON evolution; table schema and latest-snapshot schemaVersion remain unchanged.
