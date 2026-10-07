# Feature Engine 2 compact storage

Status: `CANDIDATE_PERSISTENCE_VALIDATED_WRITES_DISABLED` as of 2026-10-07 14:26 KST.

This design is additive. It does not rewrite or delete `market_observations`, does not change
`market-live.json`, and does not enable Feature Engine 2 writes in the production relay. The
first deployment target is the separate authenticated `market-feature-validation` Worker.

## Decision

Use option C now: retain immutable raw observations and store a separate compact, versioned
feature run. Reconsider option D only after measured retention and query usage require daily
aggregates or cold archive.

| Option | Shape | Measured derived bytes/row | 331 rows/day | Decision |
| --- | --- | ---: | ---: | --- |
| A | Full v2 JSON in `market_observations.features_json` | 69,386 | 22.97 MB | Reject: v1/v2 writer race and coupled rollback |
| B | Full v2 JSON in separate versioned rows | 69,386 | 22.97 MB | Reject: version-safe but unnecessarily large |
| C | Compact v2 JSON in `feature_runs` | 14,067 | 4.66 MB | Selected and candidate-validated |
| D | C plus daily aggregates/R2 archive | 14,067 hot-row input plus aggregate/archive cost | To measure | Deferred; no retention deletion yet |

Measurements use the corrected real replay captured at 2026-10-06 11:04 KST. The compact
encoding reduced the 69,386-byte full feature tree by 79.73%. Estimates exclude SQLite page,
index, raw-observation, and replication overhead.

Compact-derived retention projection before database overhead:

| Trading days | Full v2 derived JSON | Compact v2 derived JSON |
| ---: | ---: | ---: |
| 1 | 22.97 MB | 4.66 MB |
| 20 | 459.34 MB | 93.12 MB |
| 60 | 1,378.01 MB | 279.37 MB |
| 250 | 5,741.69 MB | 1,164.04 MB |

These are sizing projections, not a retention promise. Three controlled real rows measured
14,044, 13,936 and 13,884 compact JSON characters. This proves row-level reduction but is not
enough to establish long-running page/index growth; M2 must measure retention growth.

## Schema and immutability

Migration `migrations/0002_feature_runs.sql` creates `feature_runs` with primary key
`(slot_ms, feature_version)` and a restrictive foreign key to the raw observation. Each row
records:

- observation identity and trading day;
- feature version, engine Git SHA, and generated Worker source SHA-256;
- generation time and exact input cutoff;
- weakest input quality (`quality_ceiling`) and generation status;
- compact feature JSON and validation/observability JSON.

`INSERT ... ON CONFLICT DO NOTHING` makes retries idempotent. An existing versioned result is
never overwritten by a later deployment or retry. Disabling writes leaves every v1 observation
and every previously written feature run intact.

## Compact encoding contract

`encodingVersion: 1` is independent from `featureVersion: 2`. The payload carries ordered field
dictionaries, value codebooks and tuple schemas so repeated metric names, states, quality labels,
time bases and object keys are not duplicated.
It preserves the values, status, quality, bucket timing, stock-flow bucket changes, intraday
features, 2/5/10/30-minute windows, relative strength, divergence state, futures position, and
same-time statistics needed for validation. The full tree can always be recomputed from the
immutable raw observation history using the recorded engine revision and cutoff.

The compact row is not a byte-for-byte archive of the query-time feature tree. Diagnostic
arrays such as divergence supporting evidence and repeated units are intentionally omitted;
their source observations and deterministic engine version remain authoritative.

## Candidate write path and rollback

- `GET /` stays authenticated and read-only. It returns the full replay, compact preview, byte
  counts, quality summary and D1 query metadata.
- `POST /feature-runs` is authenticated and writes only when
  `FEATURE_V2_WRITE_ENABLED=true` and `FEATURE_ENGINE_GIT_SHA` is a valid 7–64 character hex SHA.
- The opt-in and SHA checks run before any D1 query. Setting
  `FEATURE_V2_WRITE_ENABLED=false` therefore stops candidate reads and writes immediately.
- The candidate never updates `market_observations`, never publishes to GitHub, and cannot race
  with the production v1 writer.
- Migration rollback is logical: disable the flag and retain the additive table. Do not drop the
  table or delete rows during validation.

## Observability contract

Each replay captures D1 metadata for the current-row, intraday, and same-time queries. A write
also captures insert and verification-query metadata. Where Cloudflare supplies them, the
response and stored `validation_json` expose duration, rows read, rows written, changes and
serving location.

The Worker emits structured `FEATURE_RUN_WRITE` and `FEATURE_RUN_FAILURE` log events without
credentials. Responses include end-to-end `elapsedWallMs`; this is not Worker CPU time. Cloudflare dashboard evidence over the audited 24-hour window recorded 72 invocations, zero
errors, zero CPU-limit exceedances, CPU P50/P90/P99 of 0.52/3.97/8.28 ms, and memory
P50/P90/P99 of 1.57/2.51/3.48 MB. These are deployment-level percentiles, not the CPU time of one
specific write. Long-running database growth remains an M2 measurement.

Expected bounded query shape per candidate generation:

- one current-observation query;
- up to 331 same-day rows;
- up to 20 prior-day same-time rows;
- one idempotent insert and one verification read.

The D1-reported `rows_read` can exceed returned row counts depending on the query plan, so only
actual candidate metadata is accepted as production evidence.

## Candidate gate results

1. **Passed:** migration `0002_feature_runs.sql`, table and index verified without modifying v1 rows.
2. **Passed:** separate authenticated candidate deployed with writes disabled by default.
3. **Passed:** exactly three distinct Feature v2 slots persisted and directly verified in D1:
   `1791335520000`, `1791350040000`, and `1791350280000`.
4. **Passed:** real 2/5/10/30-minute features, VWAP, realized volatility, acceleration, relative
   strength, divergence, futures/OI/Basis and explicit null/stale/unverified-time handling.
5. **Passed with stated limitation:** D1 read/write metadata, wall time and dashboard CPU/error/memory
   percentiles captured. Long-running page/index storage growth moves to M2.
6. **Passed:** a real changed stock-flow bucket preserved actual delta, direction and acceleration;
   unchanged buckets remained null.
7. **Passed:** candidate D1 binding failure returned a controlled 503 while production GitHub
   publication continued normally; binding recovery also passed.
8. **Passed:** write rollback returned `FEATURE_WRITE_DISABLED`; production at 14:24:47 KST remained
   schema v3, fresh, pipeline OK and `sourceErrors: []`.

PR #3 is Ready/Open and unmerged. Merging and production deployment are separate decisions; neither
is automatic. Off-market payload integrity and failure-injection regressions bring the full local suite
to 53/53 after the additive read API and pure Signal Layer candidates.
The relay's production persistence remains Feature v1 by default. The separate validator is the
only validated compact Feature v2 writer; do not enable the relay's experimental full-tree v2 flag
as a substitute for compact integration.
