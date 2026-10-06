# Feature Engine

## Production baseline

D1 History MVP stores immutable two-minute observations and computes past-only 5/10/30-minute changes. Its production validation covered distinct timestamps, real `features_json`, Samsung/SK Hynix relative strength, null/stale/future rejection, stock estimate bucket semantics, futures contract rollover and D1 failure isolation.

## Feature Engine 2.0 candidate

The candidate keeps latest-snapshot `schemaVersion: 3` and raw history schema version 1. Production
`market_observations.features_json` remains v1. Candidate v2 output is stored only in the additive
`feature_runs` table after its migration and explicit write opt-in; no backfill rewrites existing
rows.

- Price: 2/5/10/30-minute and intraday returns, open/previous-close return, high/low position, cumulative intraday VWAP deviation, realized volatility and momentum acceleration.
- Volume: window delta, rate and acceleration plus 5/10/20-trading-day same-time ratio and percentile.
- Flow: market, program and futures deltas, directions and rate acceleration; OI acceleration; basis and market-basis deltas.
- Stock estimates: discrete publication-bucket delta/direction/acceleration only. Repeated buckets are `BUCKET_UNCHANGED` with a null value, never an invented zero. Quantity share of volume is available; flow/trading-value ratio is intentionally unavailable because the estimate is shares, not KRW.
- Relative strength: Samsung/SK Hynix and each stock versus KOSPI/KOSPI200 for 2/5/10/30 minutes and intraday.
- Events: price versus stock foreign/institution bucket flow, program, futures foreign flow and OI; Samsung versus SK Hynix; cash versus futures.
- Futures position classification: price/OI heuristic with supporting evidence, contrary evidence, low/medium unvalidated confidence and an explicit limitation. It is not confirmed positioning.
- Same-time history: latest usable observation at or before the same KST time, within 150 seconds, for the latest 5/10/20 observed trading days. Complete samples are required before mean, median, population standard deviation, percentile, z-score and ratio-to-mean become valid.

Every window records `generatedAt`, `inputCutoff`, `actualElapsedSeconds` and sample count. Derived values carry status and quality where applicable. `RECENT_FETCH` remains `UNVERIFIED_TIME`; missing/stale data, counter resets and futures contract changes stay null. The cutoff rejects observations or inputs that were unavailable at generation time, never interpolates from a future sample and never crosses a KST trading date.

Realized volatility is the root-sum-square of observed log-return percentages within the actual window. It is sampling-dependent and not annualized. Price return over each actual window is the short-term momentum measurement.

Known operational limit: the corrected real replay measured 69,386 bytes for the full derived
tree. Compact encoding measured 14,067 bytes (79.73% smaller) while preserving explicit status,
quality and time-basis states. D1 storage growth and Worker CPU duration still require candidate
deployment evidence before production rollout. See `FEATURE_STORAGE.md`.
