# Changelog

## 2026-10-08 — Isolated intelligence candidate live validation

- Deployed only `market-intelligence-read-candidate` from PR #4 commit `2d34e739...`; GitHub Actions
  and Cloudflare build passed, and authenticated `/health` reported the exact deployed Git SHA.
- Disabled non-production branch builds so high-frequency `main` snapshot commits no longer trigger
  irrelevant candidate previews.
- Validated `/state` against production snapshots at multiple regular-session timestamps with zero D1
  writes; the exact 13:42:44 KST observation matched prices, flows, program, futures, OI and Basis.
- Replayed the existing pure M3 Signal Layer against an actual live Feature v2 input: 18 descriptive
  signals, zero confidence-ceiling violations, no stale program signal and no probability/BUY/SELL field.
- Production Worker, bindings, Secrets, routes, writers, snapshot cadence and D1 rows remain unchanged.

## 2026-10-08 — Isolated intelligence candidate hardening

- Require a provider-level Cloudflare rate-limit binding and fail closed before D1 when unavailable.
- Restrict ticker input to Samsung Electronics (`005930`) and SK Hynix (`000660`), with ticker-required
  bounded history and stock-specific metric filtering.
- Add a 5-second application query deadline, fixed-SELECT guard and consistent schema/feature/cutoff/
  freshness/quality/pipeline metadata.
- Add an isolated Wrangler deployment template with no token value, production route or scheduled trigger.
- Preserve only genuinely unvalidated production items as waiting; live read equivalence, real
  third-bucket acceleration and pure Signal behavior against captured live input are now validated.

## 2026-10-07 — M2 operational/storage candidate

- Merged validated Feature Engine 2.0 through PR #3 without changing the deployed production Worker.
- Added pure storage-growth, snapshot-pressure and non-destructive retention-policy helpers.
- Added release identity and honest JSON-only annualized growth projections to the read-only health candidate.
- Added a minimal Node test workflow and documented additive latest-state migration, rollback and archive gates.
- No production Worker, binding, Secret, Cron, GitHub snapshot cadence or D1 retention policy changed.

## 2026-10-07 — Off-market hardening and intelligence candidates

- Reject Feature v2 version/cutoff/SHA/serialization/oversize failures before compact persistence.
- Add D1 read/write, corrupt JSON, out-of-order, cross-day and GitHub failure-isolation regressions.
- Add a bounded authenticated read-only intelligence API candidate; production is unchanged.
- Add a pure descriptive Signal Layer with input-quality confidence ceilings and no BUY/SELL output.
- Full local suite: 53/53 passed.

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
