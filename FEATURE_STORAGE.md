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

The POST receipt and write log describe the row read back from storage, including its original
engine/source identifiers, generation/cutoff times, quality/status and stored payload byte count.
The current recomputation is separate under `computed`; an `EXISTS` retry never upgrades the
stored row to the current engine, quality or generation time. Top-level metadata and `stored`
refer to `metadataScope: STORED_FEATURE_RUN`. Existing response keys remain; their values now
correctly describe persistence. `candidateSha256` still identifies the executing relay Feature core,
not the stored row or a complete Worker deployment attestation. Missing stored size diagnostics
remain null rather than borrowing the new computation's values.

`INSERTED`/`EXISTS` require explicit positive/zero D1 changes (or rows-written fallback).
If neither count is known, successful readback yields `STORED_WRITE_OUTCOME_UNKNOWN`, not a
fabricated insertion result. No row is overwritten or extra write performed by this correction.

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

Authenticated `GET /write-control` is an additive read-only runtime binding contract (schemaVersion1):
`writeEnabled`, `engineGitSha`, `candidateSha256`, and scope `RUNTIME_BINDINGS_ONLY`. It returns
no token or market timestamp and performs no D1 access. The local controlled-trial tool must observe
runtime enable before its only POST, and runtime disable after restoring the setting. This is not
a global propagation guarantee; previous read/replay and immutable write contracts are unchanged.
See FEATURE_STORAGE_TRIAL.md for bounded observations and emergency-recovery evidence limits.

- `GET /` stays authenticated and read-only. It returns the full replay, compact preview, byte
  counts, quality summary and D1 query metadata.
- `POST /feature-runs` is authenticated and writes only when
  `FEATURE_V2_WRITE_ENABLED=true` and `FEATURE_ENGINE_GIT_SHA` is a valid 7–64 character hex SHA.
- The opt-in and SHA checks for POST run before any D1 query. Setting
  `FEATURE_V2_WRITE_ENABLED=false` blocks POST reads/writes; authenticated GET replay remains read-only and available.
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

## Default-disabled relay integration source

The existing relay history path can optionally append compact Feature v2 after raw observation
and legacy Feature persistence succeed. This is source preparation only; it creates no Worker,
Cron, binding or migration and changes no collection/publication cadence.

- `FEATURE_COMPACT_WRITE_ENABLED` must be the exact string `true`; absent/false leaves the prior
  query/write/return path unchanged and does not require `feature_runs` to exist.
- The opt-in requires non-secret `FEATURE_COMPACT_ENGINE_GIT_SHA` (40 hex) and
  `FEATURE_COMPACT_ENGINE_SOURCE_SHA256` (64 hex), supplied and verified as release metadata at a
  separately approved rollout. These identifiers are provenance, not authentication or independent
  code attestation. This source change registers no runtime variable or Secret.
- `FEATURE_ENGINE_V2_ENABLED=true` is the older experimental full-tree legacy-column path. It
  conflicts with compact opt-in and is never silently used as a compact migration. Production
  compact rollout must preserve legacy v1; no existing raw/legacy data is overwritten for migration.
- The compact path reuses `historyFeatures`, `buildCompactFeatureRun`, bounded20-prior-day/
  same-time queries, size-limited serialization, and the existing immutable INSERT/readback contract.
  Every cutoff uses the immutable stored observation, including on a later same-slot retry.
- Returned compact metadata comes from the stored row, not a retry's new engine, clock or quality.
  An existing row is retained; no history update/delete or retention change occurs. Original quality
  remains attached, including unusable/stale data; this storage path does not manufacture Signals.
- Compact failure is caught after successful raw/legacy persistence and reported as derived failure.
  It cannot reject that raw result or independently scheduled GitHub publication. An ambiguous
  compact insert failure may have stored a row; idempotent future handling must never overwrite it.

### Optional bounded compact trial (source only)

`FEATURE_COMPACT_TRIAL_SLOT_MS` and `FEATURE_COMPACT_TRIAL_EXPIRES_AT_MS` may be supplied
together with the separately authorized compact opt-in and release metadata. Both must be
canonical positive decimal safe-integer millisecond strings, and expiry must follow the slot.
Partial or invalid configuration fails closed for compact while raw/v1 persistence remains intact.
Only the exact stored observation slot is eligible. Expiry is checked before compact history reads
and again immediately before starting the immutable INSERT. Other slots or expired trials are
reported as SKIPPED with their reason; no clock relabels the stored observation.

This limits this compact path to one `(slot_ms, feature_version=2)` key under the existing
immutable primary key, including retries/concurrent invocations with the same fixed configuration.
It is not a one-request lock, scan/read quota, global database write budget, or automatic flag reset.
An INSERT already in flight can complete after expiry. Raw/v1 writes and other database writers
remain independent. Neither limit supplied preserves the existing continuous opt-in behavior.
Actual use requires a separately approved future source deployment, fixed slot/expiry and release
identity, verified effective bindings, and explicit disable/readback recovery. The retained deployed
version23 does not contain these new checks. No bindings, schedules or deployment are changed here.

Changing the relay source changes its full-file SHA even when Feature calculations are unchanged.
The generated validator is rebuilt for source consistency, but this is not permission to redeploy it.
Existing candidate runtime receipts and pinned local trial commands refer to their earlier exact
release; keep their identities separate from this un-deployed relay integration source.

Production deployment, actual opt-in, release variables, sustained database growth and authorized
consumer rollout remain separate operational gates. No real financial ledger, research admission,
Watch/BMW schedule or retention policy is changed by this implementation.

## Legacy production-base source preparation

`cloudflare/legacy-compact-preparation.mjs` prepares an optional compact hook against a separately
verified legacy raw/v1 source instead of replacing that Worker with an entire newer relay branch.
It performs no I/O, authentication, upload or deployment. The caller must independently pin and
verify the exact base module hash and obtain authorization to handle that source privately.

The preparer requires the known legacy Feature call and return contract, preserves every byte
outside the history function, and adds the validated compact core/helper in a separate lexical
scope. Legacy helper names, publication, scheduled handlers and the existing v1 call remain in
place. Default-off behavior has no derived table dependency; explicit compact behavior follows
the existing release-metadata and immutable readback contract. Unknown bases and repeat patching
fail rather than broad source replacement.

Local tests prove source-boundary preservation, lexical isolation, unchanged legacy v1 and real
SQLite compact insertion on fictional input. They do not establish that a complete live module
has been exported, prepared or deployed. Do not transmit complete production source or a large
patch through external tooling without specific source-handling authorization. Existing source,
compatibility, bindings, schedules and rollback version require independent predeployment review.
