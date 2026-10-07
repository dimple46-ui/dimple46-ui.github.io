# Changelog

## Compact versioned Feature Engine storage candidate (2026-10-07, candidate-validated)
- Add immutable `feature_runs` rows keyed by observation slot and feature version; retain every v1 observation.
- Add authenticated, explicit-opt-in candidate writes that cannot race with the production v1 writer.
- Add compact tuple/codebook encoding, engine revision/cutoff/quality metadata and D1 query/write observability.
- Corrected real replay compacted 69,386 feature bytes to 14,067 bytes (79.73% reduction).
- Migration `0002_feature_runs.sql` is applied. Three distinct real Feature v2 rows were persisted,
  verified directly in D1, and writes were disabled again; production schema v3 publication remained
  fresh and pipeline OK. Production relay persistence remains Feature v1 by default. The current
  local suite passes 36/36 tests.

## Feature Engine 2.0 candidate (2026-10-02, separate validator deployed; production unchanged)
- Add 2-minute, intraday/VWAP, volatility, momentum/volume/flow acceleration and explicit feature-quality metadata.
- Add 5/10/20-day same-time statistics with strict complete-sample activation and past-only cutoffs.
- Expand relative strength, descriptive divergence events and evidence-based futures price/OI classification.
- Preserve schemaVersion 3, history schema 1, bucket semantics, futures rollover checks and D1/GitHub fail-safe isolation.
- 36 tests pass, including SQLite integration, insufficient/stale/future data, repeated-bucket checks,
  authenticated historical replay, compact persistence and rollback.

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
