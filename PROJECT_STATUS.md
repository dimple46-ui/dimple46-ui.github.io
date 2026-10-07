# Project Status — Real-time Investment Intelligence System v4

Last updated: 2026-10-07 10:25 KST
Source-of-truth order: production evidence > GitHub `main` > Cloudflare/D1 evidence > PRs > documents.

## Current Production

- Repository: `dimple46-ui/dimple46-ui.github.io`
- Latest audited `main` head: `083a82d6605d12962efd384984ad31b55a4f8a7f` (snapshot-only; production Worker source remains PR #2)
- Latest non-snapshot Worker commit: `c88c8d03c50c5db5927f22b427b436d947691fc6` (`Add D1 history and point-in-time feature MVP (#2)`)
- Latest snapshot schema: `schemaVersion: 3`
- Snapshot at 2026-10-07 10:24:45 KST: `fresh: true`, `sourceErrors: []`, `pipelineStatus: OK`.
- Samsung/SK Hynix and KOSPI investor data were live; program age was 286 seconds and still live.
  Index/futures timestamps remained explicitly `RECENT_FETCH`/unverified rather than being treated as
  verified exchange times.
- D1: `market-history`, table `market_observations`, production observations continue to accumulate. Read-only audit at 10:34 KST found 550 rows across three trading days, all 550 stored feature rows at v1, 0 v2 rows, 20,219.3 average JSON bytes and 21,625 maximum JSON bytes. Dashboard storage was 11.56 MB.
- PR #2: merged and production-validated. D1 failure isolation and automatic recovery were validated before merge.

## Current Milestone

M1 — Feature Engine 2.0 production validation.

Status: `COMPACT_CANDIDATE_PERSISTENCE_AND_ROLLBACK_VALIDATED` in a separate authenticated
validation Worker; one controlled v2 row was inserted and verified directly in D1, and candidate
writes were disabled again with the post-write rollback gate passing. PR #3 is not merged into `main`.

## Completed

- Production collection and GitHub latest-snapshot publication.
- Data-quality/freshness metadata with explicit stale, missing and unverified-time states.
- D1 History v1 migration, binding, two-minute immutable observations and duplicate prevention.
- Feature Engine 1 point-in-time 5/10/30-minute features and Samsung/SK Hynix relative strength.
- D1 failure isolation from GitHub publication, rollback and automatic recovery validation.
- Feature Engine 2.0 implementation and local tests.
- Authenticated read-only replay deployment using exact PR #3 feature logic.
- Corrected candidate `73758483c22f7d411f25cbf940f28f7f4dd676062b5e5cd1306086467d2c3a90` deployed to the authenticated read-only validator.
- Actual corrected replay at 2026-10-06 11:04:44 KST: 63 current-day slots, observation age 94.872 seconds, Feature Engine v2 calculated against a stored v1 row without writing v2 data.
- Corrected replay passed 5/10/30-minute availability, verified Samsung/SK Hynix price returns and relative strength, program deltas where usable, and futures foreign flow/OI/Basis deltas with explicit `UNVERIFIED_TIME` quality.
- Null/stale safety passed: unchanged stock-flow buckets remained `null` with `UNCHANGED_BUCKET`, the unusable five-minute program input was not converted into a valid value, and no null metric was labeled `OK` or `VALID`.
- Corrected replay sizes were 69,386 feature bytes and 77,644 hypothetical total JSON bytes; elapsed wall time was 100 ms and is not a Worker CPU measurement.
- Additive `feature_runs` migration and authenticated candidate `POST /feature-runs` path implemented locally; it is version-keyed, immutable, explicit opt-in and never updates `market_observations`.
- Compact encoding v1 preserves null/status/quality/time-basis semantics and measured 14,067 bytes on the corrected real replay, a 79.73% reduction from the full v2 feature tree.
- Candidate responses/storage now capture D1 query/write metadata where supplied, and structured success/failure logs distinguish wall time from dashboard-only Worker CPU duration.
- Local suite after storage/rollback coverage: 32/32 tests passed.
- D1 migration `0002_feature_runs.sql` executed successfully in `market-history`; Dashboard SQL
  verification returned `feature_runs` as a table and `idx_feature_runs_version_day_slot` as an
  index at 2026-10-06 14:56 KST.
- Exact compact candidate deployed and authenticated GET validated at 2026-10-07 09:44 KST:
  source SHA-256 `39e39bb133ed90f6fa950a056948ea03d1928905de4c8dab28434a7631f0567a`,
  68,728 full bytes, 13,666 compact bytes, 80.12% reduction, and 44 ms wall time.
- The real replay exposed D1 metadata: current query 1 row read/0 written, intraday query 24/0,
  same-time query 1,686/0. All 2/5/10/30-minute windows were available; quality ceiling was
  `UNVERIFIED_TIME`, null ratio was 44.74%, and no v2 data was stored.
- Candidate rollback gate validated at 2026-10-07 10:09 KST: authenticated
  `POST /feature-runs` returned HTTP 403 with the 34-byte `FEATURE_WRITE_DISABLED` response while
  `FEATURE_V2_WRITE_ENABLED` remained absent/false. No D1 read or write path was entered.
- Real D1 pre-write query at 2026-10-07 10:11 KST confirmed `feature_runs` contains zero rows where
  `feature_version = 2`.
- One controlled candidate write at 2026-10-07 10:14 KST returned `INSERTED` for slot
  `1791335520000` (2026-10-07 10:12 KST), Feature v2, generation `SUCCESS`, engine commit
  `a8c4330c...`; Worker-side post-write read-back found the same stored identity.
- The inserted compact feature measured 14,044 bytes versus 70,195 full bytes (79.99% reduction).
  D1 write metadata reported one change; elapsed wall time was 177 ms and is not CPU duration.
- Direct D1 console verification at 2026-10-07 10:19 KST returned the exact row: slot
  `1791335520000`, Feature v2, engine commit `a8c4330c...`, `UNVERIFIED_TIME`, `SUCCESS`, and 14,044
  compact JSON characters. Generated/input-cutoff timestamps were also populated.
- Post-write rollback validated at 2026-10-07 10:25 KST: after setting
  `FEATURE_V2_WRITE_ENABLED=false`, authenticated `POST /feature-runs` again returned
  `FEATURE_WRITE_DISABLED`. The candidate is no longer write-enabled.
- Production snapshot generated at 2026-10-07 10:24:45 KST remained schema v3, fresh, pipeline OK,
  and `sourceErrors: []` during the candidate persistence/rollback validation.

## In Progress

- Correctness audit of Feature Engine 2.0 edge cases.
- Confirm the v2 row count remains exactly one after the blocked POST, then complete remaining
  isolation/observability evidence.
- Candidate evidence for actual storage growth and Worker CPU duration.
- Documentation drift repair through this source-of-truth document.

## Blocked / Not Yet Validated

- D1 count-after-rollback and explicit failure-injection isolation evidence remain to be recorded.
- Five/ten/twenty-trading-day same-time statistics: only one prior comparable trading day was available.
- Actual Worker CPU duration and account plan/usage. D1 dashboard storage was observed at 11.56 MB; per-query D1 meta is now captured, including 1,686 rows read by the same-time query.
- The corrected stock-flow bucket-transition branch has regression coverage and is deployed, but the 11:04 KST real replay contained only `UNCHANGED_BUCKET` windows, so a real changed-bucket divergence remains unexercised.
- Production fail-safe under the v2 computation/storage design.
- Long-running storage/retention and GitHub snapshot migration.

## Branch / PR / Deployment

| Item | State | Evidence / limitation |
| --- | --- | --- |
| `main` | Production | Worker source remains at PR #2 code; subsequent commits are snapshots. |
| PR #2 | `MERGED_MAIN`, `PRODUCTION_VALIDATED` | Merged 2026-10-02; production validation recorded in PR body. |
| `feature/feature-engine-v2` | Draft branch | Compact storage/observability changes are being added without changing production `main`. |
| PR #3 | Draft/Open | Not ready and not mergeable yet; compact candidate must be migrated/deployed/validated first. |
| `market-feature-validation` | Separate candidate | Authenticated GET at 09:44 KST on 2026-10-07 verified compact source hash `39e39bb1...`, D1 query metadata and no write. Writes remain disabled. |
| Production `market-relay` | Operational | Continues schema v3 snapshots and D1 observations; v2 not deployed. |

## Component Maturity Matrix

Percentages are audit estimates, not predictive-performance scores.

| Component | Functional | Operational | Status | Main gap |
| --- | ---: | ---: | --- | --- |
| Data Collection | 82% | 88% | `OPERATIONALLY_STABLE` | Index/futures exchange timestamps; external tactical sources not started. |
| Data Quality | 78% | 78% | `PRODUCTION_VALIDATED` | Source reliability tiers and confidence ceilings need formalization. |
| Latest Snapshot | 95% | 92% | `OPERATIONALLY_STABLE` | GitHub is an inefficient latest-state transport. |
| History Storage | 88% | 82% | `PRODUCTION_VALIDATED` | Retention, usage metrics and archive policy. |
| Feature Engine 1 | 92% | 85% | `MERGED_MAIN` | Operational feature delivery remains internal to stored rows. |
| Feature Engine 2 | 91% | 76% | `CANDIDATE_V2_PERSISTENCE_ROLLBACK_VALIDATED` | Count-after-rollback, real changed bucket and CPU evidence remain. |
| Same-Time Baseline | 82% | 18% | `CANDIDATE_DEPLOYED` | Needs 5/10/20 complete trading-day samples. |
| Relative Strength | 94% | 70% | `CANDIDATE_READ_ONLY_VALIDATED` | Corrected 5/10/30-minute replay passed; v2 persistence/rollout absent. |
| Divergence | 78% | 46% | `CANDIDATE_READ_ONLY_VALIDATED` | Corrected branch deployed, but a real changed stock-flow bucket and predictive validation remain. |
| Derivatives Intelligence | 76% | 52% | `CANDIDATE_DEPLOYED` | Timestamp quality and heuristic-only position classification. |
| Signal Layer | 18% | 0% | `DESIGNED` | Descriptive signal registry not implemented. |
| Options/VKOSPI | 5% | 0% | `DESIGNED` | Deferred until M1/M2. |
| US Semiconductor | 5% | 0% | `DESIGNED` | Deferred until signal foundation. |
| FX | 5% | 0% | `DESIGNED` | Source evaluation not started. |
| Rates | 5% | 0% | `DESIGNED` | Source evaluation not started. |
| Market Regime | 12% | 0% | `DESIGNED` | Requires stable descriptive signals. |
| Tactical Engine | 12% | 0% | `DESIGNED` | Interface defined, engine absent. |
| Memory/HBM | 8% | 0% | `DESIGNED` | Strategic sources absent. |
| AI Infrastructure/CAPEX | 8% | 0% | `DESIGNED` | Strategic sources absent. |
| Company Fundamentals | 8% | 0% | `DESIGNED` | Normalized company schema/source absent. |
| Earnings Revision | 5% | 0% | `DESIGNED` | Consensus history absent. |
| Valuation | 5% | 0% | `DESIGNED` | Forward/history percentile data absent. |
| Event Intelligence | 8% | 0% | `DESIGNED` | Immutable event schema absent. |
| Thesis Ledger | 10% | 0% | `DESIGNED` | Database and update rules absent. |
| Strategic Engine | 8% | 0% | `DESIGNED` | Strategic inputs absent. |
| Scenario Engine | 10% | 0% | `DESIGNED` | Probability ledger/evidence absent. |
| Portfolio Engine | 8% | 0% | `DESIGNED` | Separate private portfolio schema absent. |
| Portfolio Risk | 10% | 0% | `DESIGNED` | Concentration/leverage/liquidity model absent. |
| Stress Test | 10% | 0% | `DESIGNED` | Scenario P/L calculator absent. |
| Decision Support | 8% | 0% | `DESIGNED` | Product response contract only. |
| Alert Engine | 5% | 0% | `DESIGNED` | Multi-confirmation alerts absent. |
| Forecast Ledger | 12% | 0% | `DESIGNED` | Immutable prediction/outcome tables absent. |
| Outcome Evaluation | 5% | 0% | `DESIGNED` | Evaluation jobs/rules absent. |
| Signal Performance DB | 5% | 0% | `DESIGNED` | No signal samples yet. |
| Backtesting | 5% | 0% | `DESIGNED` | History depth and leakage-safe runner absent. |
| Calibration | 5% | 0% | `DESIGNED` | Forecast samples absent. |
| Regime-dependent Weights | 0% | 0% | `NOT_STARTED` | Requires calibrated history. |

## Aggregate Completeness

| Area | Functional | Operational |
| --- | ---: | ---: |
| Infrastructure | 84% | 81% |
| Tactical Intelligence | 39% | 21% |
| Strategic Intelligence | 8% | 0% |
| Portfolio Intelligence | 9% | 0% |
| Self-Evaluation | 7% | 0% |
| Overall | 31% | 20% |

## Known Issues / Technical Debt

1. Main documentation still says D1/history is an undeployed candidate. `README.md`, `D1_SETUP.md`, `CHANGELOG.md`, `AUDIT.md` and `DEPLOYMENT.md` are stale after PR #2.
2. PR #1 remains open although the later PR #2/main incorporated the relevant quality work.
3. A two-minute GitHub snapshot commit cadence creates roughly 331 commits per full relay day, or 82,750 commits per 250 trading days.
4. PR #3 appears 632 commits behind main even though those commits are snapshot-only; this obscures real code divergence.
5. Corrected candidate v2 response measured 69,386 full feature bytes; compact encoding measured 14,067 bytes while retaining explicit invalid/null states.
6. At 331 rows/day, compact derived JSON projects to 4.66 MB/day, 93.12 MB/20 days, 279.37 MB/60 days and 1.16 GB/250 days before SQLite/index/raw-observation overhead.
7. D1 dashboard storage was 11.56 MB at the 2026-10-06 audit; the account plan remains unverified. Official limits are 500 MB/database on Free and 10 GB/database on Workers Paid.
8. Compact candidate replay wall time was 44 ms, but wall time is not Worker CPU duration. D1 query meta was captured; the same-time query read 1,686 rows and needs cost monitoring/optimization.
9. Production program data can exceed the five-minute freshness rule; this correctly degrades the pipeline but reduces usable window features.
10. Index/futures adapters use fetch time because verified exchange timestamps are unavailable.
11. The integrated PR #3 writer cannot safely prove v2 persistence beside the production v1 writer because immutable two-minute slots and `features_json IS NULL` allow the first writer to win.

## Storage Decision

Do not persist the full 69 KB derived feature object every two minutes.

Selected candidate: retain immutable raw observations in D1 hot storage; compute the full derived tree at generation/query time; persist only a compact versioned feature summary needed for reproducibility; later add daily aggregates and optional R2 cold archive only after measured need. Existing v1 rows are retained and never rewritten or deleted during migration.

Implemented, migrated and deployed to the separate candidate with writes still disabled:

- Separate raw observation identity from versioned feature runs.
- Key derived output by `(slot_ms, feature_version)` so candidate and production do not race.
- Record engine git SHA, input cutoff and quality ceiling.
- Keep rollback additive: disable v2 writes without touching v1 observations.
- Add query meta/CPU/storage observability before rollout.

See `FEATURE_STORAGE.md` for the measured A/B/C/D comparison, encoding contract, rollout and rollback gates.

## Upgraded Architecture

1. Collection/validation writes one immutable raw observation per two-minute slot.
2. Latest state moves eventually to a read endpoint or KV while GitHub remains a temporary fallback.
3. Feature Engine reads past-only raw rows and produces versioned output.
4. Compact feature runs preserve reproducibility; large derived trees are query-time products, not duplicated in every row.
5. Daily aggregates and optional R2 archive are introduced only when measured retention requires them.
6. Signals remain descriptive and inherit the weakest input quality.
7. Tactical, strategic, portfolio and forecast domains remain separate schemas/layers.

## Milestone Roadmap

1. M1 — Feature Engine 2.0 correctness, compact-storage design and production validation.
2. M2 — Observability, retention and latest-snapshot architecture stabilization.
3. M3 — Descriptive Signal Layer and confidence ceilings.
4. M4 — Options/VKOSPI.
5. M5 — US semiconductor sources.
6. M6 — FX/rates.
7. M7 — Market Regime and Tactical Engine.
8. M8 — Memory/HBM and AI CAPEX.
9. M9 — Fundamentals, revisions and valuation.
10. M10 — Thesis and Event Intelligence.
11. M11 — Strategic and Scenario engines.
12. M12 — Portfolio/risk and stress testing.
13. M13 — Forecast Ledger and immutable outcomes.
14. M14 — Backtesting and calibration.
15. M15 — Regime-dependent weights and continuous improvement.

## Next Exact Step

Query the D1 Feature v2 row count after the blocked post and require exactly one; then record current
production snapshot/isolation evidence.

## Checkpoint — Post-write Rollback Gate Validated

- timestamp: 2026-10-07 10:25 KST
- candidate: `market-feature-validation`
- configuration: `FEATURE_V2_WRITE_ENABLED=false`
- request: authenticated `POST /feature-runs`
- result: `{"error":"FEATURE_WRITE_DISABLED"}` (HTTP 403 expected from the verified code path)
- conclusion: candidate write opt-in was successfully rolled back after real persistence
- safety: no new replay or D1 write path was entered by the blocked request
- next_exact_step: confirm the D1 Feature v2 row count remains exactly one

## Checkpoint — Direct D1 Feature v2 Row Verified

- timestamp: 2026-10-07 10:19 KST
- database/table: `market-history.feature_runs`
- slot: `1791335520000` (2026-10-07 10:12 KST)
- feature version: 2
- engine commit: `a8c4330c15c0800c8f28e329a80bc9b09245edd7`
- quality ceiling: `UNVERIFIED_TIME`
- generation status: `SUCCESS`
- generated_at_ms: `1791335649438`
- input_cutoff_ms: `1791335563661`
- compact JSON characters: 14,044
- conclusion: actual versioned compact Feature v2 persistence is verified in the real D1 database
- next_exact_step: set candidate `FEATURE_V2_WRITE_ENABLED=false` and deploy

## Checkpoint — Controlled Feature v2 Persistence Succeeded

- timestamp: 2026-10-07 10:15 KST
- candidate source SHA-256: `39e39bb133ed90f6fa950a056948ea03d1928905de4c8dab28434a7631f0567a`
- request: one authenticated `POST /feature-runs`
- result: `CANDIDATE_COMPACT_WRITE`, `INSERTED`
- identity: slot `1791335520000` (2026-10-07 10:12 KST), Feature v2
- engine commit: `a8c4330c15c0800c8f28e329a80bc9b09245edd7`
- generation: `SUCCESS`; quality ceiling `UNVERIFIED_TIME`
- storage measurement: 14,044 compact bytes versus 70,195 full bytes; 79.99% reduction
- D1 write meta: 0.5017 ms, one change; adapter reported 2 rows written
- read-back meta: 0.3756 ms, one row read; stored identity and generation status matched
- query reads: current 1, intraday 38, same-time 1,680
- timing: 177 ms wall time; not Worker CPU duration
- isolation: response states no `market_observations` row was updated
- next_exact_step: direct D1 console query for this exact row

## Checkpoint — Pre-write D1 Baseline Verified

- timestamp: 2026-10-07 10:11 KST
- database: `market-history`
- query: count `feature_runs` rows where `feature_version = 2`
- result: `v2_row_count = 0`
- conclusion: no candidate v2 feature row existed before write opt-in
- next_exact_step: set candidate `FEATURE_V2_WRITE_ENABLED=true`

## Checkpoint — Disabled Write/Rollback Gate Validated

- timestamp: 2026-10-07 10:09 KST
- candidate: `market-feature-validation`
- request: authenticated `POST /feature-runs`
- result: HTTP 403; response length 34 bytes, matching `{"error":"FEATURE_WRITE_DISABLED"}`
- configuration: `FEATURE_ENGINE_GIT_SHA` reported configured; `FEATURE_V2_WRITE_ENABLED` remained
  absent/false
- safety conclusion: write-disabled rollback gate passed before D1 replay or persistence
- persistence: no v2 write is claimed; D1 count must be checked directly next
- next_exact_step: query `feature_runs` v2 row count and require zero

## Checkpoint — Exact Compact Candidate Read-only Validated

- timestamp: 2026-10-07 09:46 KST
- branch: `feature/feature-engine-v2`
- implementation commit: `a8c4330c15c0800c8f28e329a80bc9b09245edd7`
- deployed source SHA-256: `39e39bb133ed90f6fa950a056948ea03d1928905de4c8dab28434a7631f0567a`
- completed: authenticated HTTP 200 `READ_ONLY_REPLAY`; exact compact candidate identity verified
- replay: 23 distinct current-day slots; observation at 09:44:45 KST; age 42.689 seconds
- storage measurement: 68,728 full bytes; 13,666 compact bytes; 80.12% reduction
- D1 query meta: current 1/0, intraday 24/0, same-time 1,686/0 rows read/written
- feature validation: 2/5/10/30-minute windows available; 304 leaves, 168 numeric, 136 null;
  null ratio 44.74%; quality ceiling `UNVERIFIED_TIME`
- unchanged-bucket safety: `UNCHANGED_BUCKET` remained explicit; a real changed stock-flow bucket
  was not observed (`changedBucketObserved: false`)
- persistence: no v2 row written; stored production feature version remained v1
- timing: 44 ms wall time; this is not Worker CPU duration
- next_exact_step: set `FEATURE_ENGINE_GIT_SHA` while writes stay disabled, then test the disabled POST gate

## Checkpoint — Candidate Deployment Mismatch

- timestamp: 2026-10-06 15:32 KST
- expected candidate source SHA: `39e39bb133ed90f6fa950a056948ea03d1928905de4c8dab28434a7631f0567a`
- actual authenticated response SHA: `73758483c22f7d411f25cbf940f28f7f4dd676062b5e5cd1306086467d2c3a90`
- actual replay: 195 distinct slots, observation age 18.463 seconds, 63,369 full feature bytes,
  156 ms wall time, stored feature v1
- missing evidence: `compactFeaturesBytes`, compact reduction and `queryMeta` were absent
- conclusion: the old read-only validator remained active; compact deployment is not complete
- safety: response explicitly stored no v2 row; production Worker was not changed
- next_exact_step: replace the candidate source using the immutable commit URL and deploy again

## Checkpoint — Compact Candidate Deployed, Verification Pending

- timestamp: 2026-10-06 15:28 KST
- branch: `feature/feature-engine-v2`
- deployed source: `cloudflare/feature-validation-worker.js` from implementation commit
  `a8c4330c15c0800c8f28e329a80bc9b09245edd7`
- completed: user reported successful deployment to the separate `market-feature-validation` Worker
- write state: `FEATURE_V2_WRITE_ENABLED` absent/false by default; no v2 write is authorized
- validation: authenticated GET response not yet captured; deployment identity remains unverified
- blocker: the Work browser cannot access `workers.dev`, so the existing authenticated Dashboard
  HTTP tester must provide the response evidence
- next_exact_step: authenticated GET `/` with the existing `VALIDATION_TOKEN`

## Checkpoint — D1 Compact Schema Verified

- timestamp: 2026-10-06 14:58 KST
- branch: `feature/feature-engine-v2`
- implementation commit: `a8c4330c15c0800c8f28e329a80bc9b09245edd7`
- checkpoint commit before this update: `6b06689a995442645f1a54f6f203b09796257517`
- completed: additive migration executed; `feature_runs` table and
  `idx_feature_runs_version_day_slot` index verified in the real `market-history` D1 database
- tests: 32/32 local pass; not rerun because code did not change
- deployment: compact-write candidate not yet deployed
- validation: schema objects only; v2 row count remains unverified
- next_exact_step: deploy the separate candidate with writes disabled, then validate authenticated GET

## Recovery Checkpoint

- timestamp: 2026-10-06 14:45 KST
- branch: `feature/feature-engine-v2`
- commit: `a8c4330c15c0800c8f28e329a80bc9b09245edd7`
- completed: additive versioned compact storage, authenticated candidate write path, D1 query/write
  metadata, structured Worker generation/failure logs, documentation and PR body update
- tests: 32/32 local pass; not rerun during recovery
- deployment: existing read-only validator only; compact-write candidate not deployed
- validation: corrected real replay compacted 69,386 to 14,067 bytes; production snapshot at
  2026-10-06 14:42 KST remained schema v3, fresh, pipeline OK and sourceErrors empty
- D1: migration attempt failed with an empty-query/malformed-request response; table/index status
  remains unknown and no v2 persistence is claimed
- next_exact_step: execute migration successfully, then verify table and index

## Validation Evidence

- Production snapshot audit: GitHub main file, 2026-10-06 09:48:45 KST.
- GitHub audit: main/branches/PR metadata and Worker blob SHAs, 2026-10-06.
- Candidate replay response: authenticated read-only HTTP 200, generated 2026-10-06 09:44:44 KST.
- Candidate source SHA-256: `438a8712d81edbe0a921c8e25d4a58551bf28907ed5ffb268f14c92d230f6bd4`.
- Compact-storage candidate SHA-256: `39e39bb133ed90f6fa950a056948ea03d1928905de4c8dab28434a7631f0567a` (deployed and authenticated GET validated).
- Real-response compact measurement: 14,067 bytes, 79.73% reduction, quality ceiling `UNVERIFIED_TIME`; all 2/5/10/30-minute windows available; changed stock-flow bucket still not observed.
- Tests: 32/32 local pass.
