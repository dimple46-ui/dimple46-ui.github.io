# Changelog

## Feature Engine 2.0 candidate (2026-10-02, not deployed)
- Add 2-minute, intraday/VWAP, volatility, momentum/volume/flow acceleration and explicit feature-quality metadata.
- Add 5/10/20-day same-time statistics with strict complete-sample activation and past-only cutoffs.
- Expand relative strength, descriptive divergence events and evidence-based futures price/OI classification.
- Preserve schemaVersion 3, history schema 1, bucket semantics, futures rollover checks and D1/GitHub fail-safe isolation.
- 25 tests pass, including SQLite integration, insufficient/stale/future data and repeated-bucket checks.

## D1 History MVP production completion (2026-10-02)
- Production observations and 5/10/30-minute features verified, including recovery after a synthetic D1 failure.
- PR #2 merged to main after production validation.

## v4 history candidate (2026-10-01, not deployed)
- Optional MARKET_HISTORY D1 binding; additive SQL migration.
- Immutable two-minute observations and isolated background persistence.
- First point-in-time features with explicit baseline gaps, bucket semantics and contract checks.
- 22 tests including SQLite integration, duplicate suppression, stale/missing data and failure isolation.

## qualityVersion 2026-10-01.1 (production verified)
- Deployed by user and verified at 09:06:14 KST; subsequent 09:20 snapshot retains this version.
- Source errors empty; program timestamp stale is flagged, not hidden.
- Timestamp/close fixes, holiday validation and signed/scaled additive fields.
