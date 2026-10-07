# Project Status — Real-time Investment Intelligence System v4

Last updated: 2026-10-08 06:53 KST
Source-of-truth order: production evidence > GitHub `main` > Cloudflare/D1 evidence > PRs > documents.

## Current Production

- Repository: `dimple46-ui/dimple46-ui.github.io`
- PR #3 merge commit: `2b188d15f9b2d2888ff656f3aa8ea03f842c87ae`; subsequent main changes are docs-only checkpoints.
- Deployed production Worker baseline remains PR #2 commit `c88c8d03c50c5db5927f22b427b436d947691fc6`.
  GitHub main now contains PR #3 code, but no Cloudflare Worker deployment was performed.
- Latest snapshot schema: `schemaVersion: 3`
- Final snapshot at 2026-10-07 20:01:17 KST: `fresh: true`, `sourceErrors: []`, `pipelineStatus: OK`.
- Samsung/SK Hynix source time was 20:00:00 KST and both were correctly marked `CLOSED`. Program and
  futures were also closed. The relay stopped after the final snapshot, leaving a stable main head.
- D1: `market-history`, table `market_observations`, production observations continue to accumulate. The additive `feature_runs` table now contains exactly three Feature v2 rows across three distinct slots; production v1 observations were not updated. Earlier storage audit measured 11.56 MB.
- PR #2: merged and production-validated. D1 failure isolation and automatic recovery were validated before merge.

## Current Milestone

M2 — Operational / Storage Architecture Stabilization.

Status: `M2_POLICY_AND_READ_API_CODE_COMPLETE_NOT_DEPLOYED`.

M1 — Feature Engine 2.0 production validation is `COMPLETE`: correctness, real changed-bucket
semantics, three-slot compact persistence, rollback, provider CPU evidence, D1 failure isolation,
production isolation and documentation all passed. PR #3 merged to main as `2b188d15...` after a
53/53 pre-merge test pass. The production Cloudflare Worker was not replaced.

M3 — Descriptive Signal Layer is `PURE_FUNCTION_CANDIDATE`: deterministic signal generation,
quality confidence ceilings and synthetic correctness tests are implemented, but no production endpoint,
alert or investment action consumes the signals.

## RECOVERY_CHECKPOINT — 2026-10-08 06:53 KST

- timestamp: `2026-10-08 06:53 KST`
- market_state: `PRE_MARKET`
- branch: local `m2-operational-storage-local`; remote `feature/m2-operational-storage`
- HEAD: local `ab53b4147066490961632511ecc15f9d81980609` plus the recovered candidate work described below
- main_HEAD: `5c6acef4f38baf8c3bebb64f929fadc41c8a4976`
- PR_3_status: `MERGED`; merge commit `2b188d15f9b2d2888ff656f3aa8ea03f842c87ae`
- last_completed_commit: remote PR #4 head `4f6a0fe4cdaaaec5e47853eb5408a61db29c4333`;
  recovered local documentation checkpoint `ab53b4147066490961632511ecc15f9d81980609`
- last_completed_test: recovered hardening plus current additions pass `58/58`; prior remote PR #4 GitHub
  Actions run `37622785642` passed at `4f6a0fe4...`
- last_completed_deployment: separate Feature validator only; the read-only intelligence candidate has
  not been deployed and the production Worker remains the PR #2 baseline
- last_completed_validation: Feature v2 has three immutable D1 rows in three distinct slots; rollback,
  changed-bucket semantics, failure isolation and production continuity were already validated
- intelligence_candidate_status: `PARTIAL` — isolated Worker routes, mandatory provider limiter,
  ticker/range/version/cutoff bounds, timeout, metadata, tests and Wrangler dry-run are complete; Worker,
  Secret and bindings do not yet exist
- M1_status: core Feature Engine validation remains complete; the separate 2026-10-08 live operational
  revalidation below remains `WAITING_FOR_LIVE_MARKET_VALIDATION`
- waiting_for_live: actual 2026-10-08 state/Feature/flow/program/futures/OI/basis/relative-strength/
  divergence/acceleration/quality and Signal behavior
- next_exact_step: obtain the existing `market-history` D1 Database ID, replace the zero UUID in the
  candidate-only Wrangler configuration, commit/push the recovered candidate checkpoint, then deploy
  the separate Worker without changing production

## 2026-10-08 Work Classification

### COMPLETED_OFF_MARKET

- Recovered the exact local/remote/main/PR state without recreating PR #3, D1 History, Feature Engine or
  `feature_runs`.
- Hardened the intelligence candidate to accept only `005930`, `000660` or an explicit combined scope;
  ticker-specific history is mandatory and bounded to 12 hours/120 rows.
- Made the Cloudflare provider rate-limit binding mandatory and fail-closed before D1; retained the
  secondary per-isolate limit as defense-in-depth.
- Added a fixed-SELECT guard, 5-second query deadline, stable response metadata and stock-specific
  history filtering without coercing null/stale data.
- Added a candidate-only Wrangler template with no Secret value, production route, Cron or production
  binding. Wrangler 4.148 dry-run bundled 19.76 KiB and identified only the candidate D1, rate-limit,
  version-metadata and non-secret variable bindings.
- Local regression suite: `58/58 PASS`.

### WAITING_FOR_LIVE_MARKET_VALIDATION

- Keep every item in `NEXT LIVE MARKET VALIDATION` below open until actual 2026-10-08 regular-session
  evidence exists. Synthetic tests, off-market snapshots and historical replay cannot close these gates.

### BLOCKED_BY_USER_ACTION

- Candidate deployment needs the existing `market-history` Database ID. The repository contains only an
  intentional zero-UUID placeholder and no Secret value.
- After the Database ID is supplied and the candidate is deployed, the user must enter the new
  `INTELLIGENCE_READ_TOKEN` directly as a Cloudflare Secret. Its value must never be returned or recorded.

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
- Direct D1 count after the blocked post returned one Feature v2 row and one distinct slot, proving
  the rollback request did not create or duplicate data.
- Cloudflare Worker metrics over the audited 24-hour window reported 72 invocations, zero errors,
  zero CPU-limit exceedances, CPU P50/P90/P99 of 0.52/3.97/8.28 ms, actual-time P50/P90/P99 of
  0.85/24.33/61.73 ms, and memory P50/P90/P99 of 1.57/2.51/3.48 MB.
- Candidate D1 failure injection passed: removing only its `MARKET_HISTORY` binding caused
  authenticated GET to return HTTP 503 `FEATURE_VALIDATION_FAILED`, while production at
  2026-10-07 10:44:44 KST remained schema v3, fresh, pipeline OK, sourceErrors empty and both stocks
  live.
- Candidate recovery passed after restoring `MARKET_HISTORY -> market-history`: authenticated GET
  returned `READ_ONLY_REPLAY` for the exact candidate hash with a 16.518-second-old observation,
  61 distinct slots, all 2/5/10/30-minute windows, and zero query writes.
- Final PR safety review found that the candidate branch could otherwise make production persist the
  full Feature v2 tree after a later Worker deployment. Production persistence now defaults to the
  unchanged Feature v1 contract; Feature v2 requires an explicit, controlled opt-in and the separate
  validator remains the compact-write path. A new regression test raises the local suite to 36/36.
- Off-market M1 hardening now rejects feature-version mismatch, invalid source SHA/input cutoff,
  compact serialization failure and compact payloads above 64 KiB before D1 persistence. D1 read/write
  failure, corrupt stored JSON, out-of-order rows, cross-day contamination and GitHub-write isolation
  regression tests raise the suite from 36 to 41 tests.
- M2 bounded read-only intelligence API candidate implemented with authenticated fixed routes
  `/health`, `/state`, `/features` and `/history`; all SQL is fixed and parameter-bound. Cutoffs, a
  12-hour history range, 120-row limit, 900 KB response limit, stored-feature integrity and generic
  failure responses are enforced. No candidate deployment, binding or Secret was created.
- M3 pure descriptive Signal Layer candidate implemented for stock-flow acceleration/reversal,
  program acceleration, futures/OI classification, relative momentum, divergence and abnormal volume.
  Confidence is categorical, never a probability, and cannot exceed input quality. Full suite: 53/53.

## In Progress

- M2 work continues on `feature/m2-operational-storage`; production remains unchanged.
- The read-only intelligence API is approved for an isolated candidate and its local code/configuration
  gates pass. Deployment is pending the existing D1 Database ID and direct Secret entry; production
  routing, bindings and Worker remain outside the approval scope.
- M3 signals remain pure-function outputs pending historical replay and next-session live behavior validation.

## Blocked / Not Yet Validated

- The metrics page provides deployment-level CPU percentiles, not an exact per-request CPU value for
  the one controlled persistence call.
- Five/ten/twenty-trading-day same-time statistics: only one prior comparable trading day was available.
- Actual Worker CPU duration and account plan/usage. D1 dashboard storage was observed at 11.56 MB; per-query D1 meta is now captured, including 1,686 rows read by the same-time query.
- Per-request Worker CPU is not exposed by the captured dashboard percentile view.
- Long-running storage/retention and GitHub snapshot transport redesign belong to M2.
- No GitHub CI workflow/status checks are configured; local tests are the current automated gate.
- Secure intelligence API deployment requires a new `INTELLIGENCE_READ_TOKEN`; it has not been created.
  The provider-level rate-limit binding is now mandatory in code/configuration but not yet deployed.
- Signal tests are development correctness evidence, not predictive accuracy or live production validation.

## Branch / PR / Deployment

| Item | State | Evidence / limitation |
| --- | --- | --- |
| `main` | Production repository | PR #3 merged as `2b188d15...`; deployed Cloudflare Worker remains unchanged pending separate approval. |
| PR #2 | `MERGED_MAIN`, `PRODUCTION_VALIDATED` | Merged 2026-10-02; production validation recorded in PR body. |
| `feature/feature-engine-v2` | Merged branch | Merged to main through PR #3. |
| PR #3 | `MERGED_MAIN` | Merge commit `2b188d15f9b2d2888ff656f3aa8ea03f842c87ae`; no production deployment implied. |
| `feature/m2-operational-storage` | Development branch | Additive M2 policy/observability/CI work; not deployed. |
| PR #4 | Draft/Open | M2 commit `82851309548a6d0a8e7d64aaef6696219624ab0a`; 56/56 local and GitHub Actions passed. |
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
| Feature Engine 2 | 98% | 95% | `M1_COMPLETE_MERGE_READY_CANDIDATE` | Production rollout remains a separate explicit decision. |
| Same-Time Baseline | 82% | 18% | `CANDIDATE_DEPLOYED` | Needs 5/10/20 complete trading-day samples. |
| Relative Strength | 94% | 70% | `M1_VALIDATED` | Real-D1 2/5/10/30-minute replay and three-slot compact v2 persistence passed; production rollout remains separate. |
| Divergence | 78% | 46% | `M1_VALIDATED` | Real changed stock-flow bucket semantics passed; predictive validation remains future work. |
| Derivatives Intelligence | 76% | 52% | `CANDIDATE_DEPLOYED` | Timestamp quality and heuristic-only position classification. |
| Signal Layer | 42% | 0% | `PURE_FUNCTION_CANDIDATE` | Historical/live replay integration and endpoint delivery remain. |
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
| Infrastructure | 86% | 81% |
| Tactical Intelligence | 42% | 21% |
| Strategic Intelligence | 8% | 0% |
| Portfolio Intelligence | 9% | 0% |
| Self-Evaluation | 7% | 0% |
| Overall | 32% | 20% |

## Known Issues / Technical Debt

1. Main documentation still says D1/history is an undeployed candidate. `README.md`, `D1_SETUP.md`, `CHANGELOG.md`, `AUDIT.md` and `DEPLOYMENT.md` are stale after PR #2.
2. PR #1 remains open although the later PR #2/main incorporated the relevant quality work.
3. A two-minute GitHub snapshot commit cadence creates roughly 331 commits per full relay day, or 82,750 commits per 250 trading days.
4. PR #3 was 1,249 snapshot commits behind main at the 19:34 KST audit; the high-frequency snapshot history obscures real code divergence.
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

Implemented, migrated and deployed to the separate candidate; three controlled rows were persisted and writes are disabled again:

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

Get the existing `market-history` D1 Database ID, replace the intentional zero UUID in the isolated
candidate Wrangler configuration, commit/push the 58-test checkpoint to Draft PR #4, then deploy the
separate candidate. Do not modify the production Worker, route, bindings or Secrets.

## NEXT LIVE MARKET VALIDATION

Status: `PLANNED_FOR_2026-10-08_REGULAR_MARKET`.

This is the first operational task for the next regular session. It does not reopen the already passed
M1 candidate gates and must not trigger new feature development before live evidence is collected.

| Validation item | Required live data | Method | PASS | FAIL |
| --- | --- | --- | --- | --- |
| Production health | Current Samsung/SK Hynix snapshot, freshness, pipeline and source errors | Audit `main:market-live.json` at two or more distinct live timestamps | Schema v3 continues, timestamps advance, quality is honest, no unexplained source error | Frozen timestamp, publication failure, or stale/error data labeled live |
| Past-only windows | Current-day D1 observations after enough elapsed time | Authenticated candidate read-only replay | 2/5/10/30m use rows at or before `input_cutoff`; no later row is read | Any future row or later publication enters a baseline |
| Stock-flow bucket semantics | Samsung/SK Hynix foreign and institution buckets | Compare previous/current bucket and generated feature | Changed bucket has delta/direction/acceleration; unchanged bucket remains null with `UNCHANGED_BUCKET` | Unchanged bucket becomes zero or changed delta uses the same bucket |
| Program/futures/OI/basis | Live program, futures flow, OI, OI change, basis and market basis | Compare raw observation to candidate evidence | Numeric output only when inputs are usable; closed/stale/unverified quality propagates | Stale/closed/unverified input is promoted to verified live data |
| Relative strength/divergence | Both stocks plus KOSPI/KOSPI200 and flows | Inspect 2/5/10/30m candidate output | Direction and magnitude match raw returns/flows; contrary evidence is retained | One stock omitted, null coerced to zero, or sign mismatch |
| Compact Feature v2 | Candidate generation; production rollout only after explicit approval | Read-only generation by default; query `feature_runs` only if an approved write/rollout occurs | Version/SHA/cutoff/quality/status are complete and immutable; production v1 remains isolated | Write occurs while disabled, metadata missing, or v1 row is rewritten |
| Rollback/fail-safe | Candidate write flag disabled and production publication active | Confirm blocked POST behavior only when needed; observe production independently | Disabled path rejects writes and production continues | Candidate/D1 failure interrupts GitHub publication |
| Descriptive signals | Live Feature v2 flow/program/futures/relative-strength/divergence inputs | Run the pure Signal Layer against the authenticated live replay | Signal types, evidence, invalidation and confidence ceiling match inputs; no BUY/SELL or probability | Null/stale becomes active, quality ceiling is exceeded, sign/evidence mismatch, or an actionable signal appears |

Same-time 5/10/20-day baselines remain `INSUFFICIENT_HISTORY` until enough real trading days exist.
No synthetic sample may be used to pass this gate.

## Checkpoint — PR #3 Merged / M2 Policy Candidate

- timestamp: 2026-10-07 21:31 KST
- main merge: PR #3 merged with expected head `4284c9b2b219cc92f5a58c4ea8085a59cbd4def4`
- merge commit: `2b188d15f9b2d2888ff656f3aa8ea03f842c87ae`; tree
  `e3b6824f0777b540b8ab479a5d0bad3de7afb28e` matches the tested branch tree
- branch: `feature/m2-operational-storage`
- milestone: M1 complete; M2 operational/storage stabilization in progress
- completed: PR/main verification, additive storage-growth policy, honest JSON-only projections,
  release metadata, non-destructive retention gates, CI workflow and operational migration/rollback plan
- remote commit: `82851309548a6d0a8e7d64aaef6696219624ab0a`; Draft PR #4
- tests: 56/56 local pass; GitHub Actions `Tests` run `37622209013` completed successfully
- deployment: none; production Worker, bindings, Secrets, Cron, D1 rows and publication cadence unchanged
- production validation: final `market-live.json` remains schema v3, fresh, pipeline OK and sourceErrors empty
- waiting_for_live: 2026-10-08 live Feature/Signal checklist remains mandatory; no synthetic M2 test
  changes its status
- remaining: measure at least 20 trading days of provider storage growth; separate approval is required
  before a read-only candidate deployment or any production change
- next_exact_step: request approval only if deploying the separate read-only candidate; otherwise keep
  PR #4 Draft and begin the 2026-10-08 live validation checklist at regular-market open

## Checkpoint — Stable-main Synchronization Complete

- timestamp: 2026-10-07 21:15 KST
- branch: `feature/feature-engine-v2`
- commit: `27c16c720701114d3d800c6586cd64eb4e3539d3`
- milestone: M1 complete; M2 code candidate; M3 pure-function candidate
- completed: merged final production snapshot base `e856a4b963df6be56c6d07256beb73f8854cdd68`
  into the feature branch; main itself was not changed
- branch comparison: 54 commits ahead, 0 behind; stable main is the merge base
- tests: post-sync 53/53 local pass
- merge validation: local `git merge-tree --write-tree` succeeded; GitHub completed recalculation and
  now reports `mergeable: true`, `mergeable_state: clean`
- production impact: none; no main merge, Worker deployment, D1 write, binding, Secret or Cron change
- waiting_for_live: 2026-10-08 Feature/Signal checklist remains mandatory
- blocked: main merge requires explicit user approval; read API deployment separately requires a new
  Secret, read-only binding and provider-level rate-limit approval
- next_exact_step: request explicit approval before PR #3 main merge; keep production deployment separate

## Checkpoint — Off-market M1/M2/M3 Development

- timestamp: 2026-10-07 20:55 KST
- branch: `feature/feature-engine-v2`
- commits: `f64d5601903f9411f842cd8f40692b6b7f27d125` M1 hardening;
  `1318dee546f2d9f3accc728f43ad47f9b2fbf5ae` M2 read API;
  `3eac555fe4c64ba8662f2a11bcb6a9d3d20107c1` M3 pure signals
- milestone: M1 remains complete; M2 code candidate and M3 pure-function candidate added independently
- completed: payload integrity/size guards, failure tests, authenticated bounded read API, machine-readable
  health, storage/query metadata, descriptive Signal schema and quality confidence ceilings
- tests: 53/53 local pass; no GitHub CI is configured
- validation: synthetic/SQLite correctness only for new M2/M3 code; prior real-D1 M1 evidence unchanged
- production impact: none; no main merge, Worker deployment, D1 write, binding, Secret or Cron change
- waiting_for_live: 2026-10-08 live Feature/Signal behavior checklist above
- remaining: stable-main synchronization, post-sync tests/merge-tree, explicit approval before main merge;
  separate approval and new Secret before any intelligence API deployment
- next_exact_step: synchronize the Ready PR branch with stable main, rerun tests and verify PR mergeability

## Checkpoint — 2026-10-07 After-hours Recovery

- timestamp: 2026-10-07 19:38 KST
- branch: `feature/feature-engine-v2`
- commit before this checkpoint: `e60ba95ef404ea32322d478549f3a21035b9c157`
- PR #3: Ready/Open, unmerged; GitHub reported mergeable at audit time
- production main: `a80869dafaacc9cf798d627e374a2c2f8a81b549`; 19:36:45 KST snapshot
- production validation: schema v3, fresh, pipeline OK, sourceErrors empty; Samsung/SK Hynix live
  in the NXT after-hours window; program/futures correctly closed
- D1/Feature v2: prior direct evidence remains three immutable v2 rows across three slots; writes disabled
- tests: local `node --test tests/*.test.mjs` passed all four test files; documented suite remains 36/36
- completed: actual-state recovery, production/PR/schema/safety re-audit, next live-market gate definition
- remaining: relay still moves during the NXT window; do not synchronize or merge against a moving base
- next_exact_step: after the relay stops, re-audit stable `main`, synchronize PR #3, rerun tests and
  merge-tree; request explicit approval before any main merge

## Checkpoint — M2 Read-only Operational/Storage Audit

- timestamp: 2026-10-07 14:41 KST
- production code: every relay run performs GitHub Contents API GET then PUT for the same
  `market-live.json`, creating a commit with the snapshot timestamp
- observed commit volume: 331 snapshot commits on 2026-10-06; 170 more through 14:38 KST on
  2026-10-07; recent history confirms approximately two-minute cadence
- annualized design pressure: 331 commits per full relay day equals about 82,750 commits per 250
  trading days, before non-snapshot development commits
- repository consumers: code search found no checked-in UI/application consumer of
  `market-live.json`; only relay/deployment documentation references it. External consumers remain
  unknown and must be preserved with a fallback during migration
- D1: immutable observations exist, but no retention deletion, archive policy, daily aggregate or
  automated storage-growth monitor is implemented
- initial M2 direction: introduce an optional dedicated latest-state path and read endpoint, retain
  GitHub as a compatibility fallback/checkpoint at reduced frequency, and define measured D1
  retention/archive gates before deletion is considered
- safety: audit only; no production code, Worker, binding, Secret, Cron, D1 row or GitHub main file changed
- blocker: M2 implementation branch must wait for the after-hours PR #3 synchronization/merge decision
- next_exact_step: after the relay window, stabilize the branch base; merging code remains separate from Cloudflare deployment

## Checkpoint — M1 Complete / PR #3 Merge-ready Candidate

- timestamp: 2026-10-07 14:38 KST
- branch head: `f75cffb417ecdc2cf6724a144947a919fcdbb6b7`
- PR #3: Ready/Open, unmerged; GitHub mergeability is transient while `main` receives snapshots
- tests: 36/36 local pass; GitHub has no configured CI statuses or workflow runs
- merge audit: current feature branch is behind the continuously moving snapshot base, but local
  `git merge-tree --write-tree` completed without conflicts and GitHub reports mergeable
- production safety: Feature v1 persistence is the default; no production variable or Worker was changed
- D1 evidence: exactly three Feature v2 rows at three distinct slots; all `SUCCESS`; compact sizes
  14,044, 13,936 and 13,884 characters; candidate writes disabled after verification
- production evidence: 2026-10-07 14:36:45 KST snapshot remained schema v3, fresh and
  `sourceErrors: []`; stocks/KOSPI investors live; pipeline `DEGRADED` only because program input
  was explicitly stale
- conclusion: M1 feature/storage validation is complete; PR #3 is Ready/Open but its after-hours
  synchronization and merge remain an operational gate
- next_exact_step: after the relay window, re-check production and synchronize the PR against a stable main head

## Checkpoint — Final PR Production Safety Guard Tested

- timestamp: 2026-10-07 14:33 KST
- branch: `feature/feature-engine-v2`
- audit finding: the candidate relay source could store the full Feature v2 tree in
  `market_observations.features_json` if deployed after merge, contrary to the compact-storage
  decision and the production-v1 preservation requirement
- fix: production persistence defaults to Feature v1; Feature v2 full-tree persistence requires the
  explicit `FEATURE_ENGINE_V2_ENABLED=true` experimental opt-in and is not part of the rollout plan
- candidate: the separate authenticated validator continues to calculate Feature v2 and write only
  compact/versioned `feature_runs` rows under its independent write flag
- tests: 36/36 local pass, including a new regression proving the absent/false production flag stores
  Feature v1
- deployment: none; production Worker and variables are unchanged
- next_exact_step: commit/push the guard and repeat final PR metadata/merge review

## Checkpoint — Three-slot Feature v2 Persistence Gate Passed

- timestamp: 2026-10-07 14:26 KST
- branch: `feature/feature-engine-v2`
- candidate: `market-feature-validation`; source SHA-256 `39e39bb133ed90f6fa950a056948ea03d1928905de4c8dab28434a7631f0567a`
- controlled identities: `1791335520000`, `1791350040000`, `1791350280000`; all Feature v2
- direct D1 count: 3 rows and 3 distinct slots; first/last slots matched the controlled identities
- engine commit: all rows `a8c4330c15c0800c8f28e329a80bc9b09245edd7`
- generation: all `SUCCESS`; quality ceilings preserved as two `UNVERIFIED_TIME` and one `STALE_INPUT`
- compact JSON characters: 14,044; 13,936; 13,884; no full 69–70 KB derived tree was persisted
- last write response: 13,884 compact bytes versus 68,594 full bytes, 79.76% reduction; D1 reported
  one insert and successful read-back; no `market_observations` row was updated
- rollback: `FEATURE_V2_WRITE_ENABLED=false`; subsequent authenticated POST returned
  `FEATURE_WRITE_DISABLED`
- production after gate: snapshot 2026-10-07 14:24:47 KST remained schema v3, fresh, pipeline OK,
  sourceErrors empty; stock and KOSPI investor feeds live
- conclusion: actual compact/versioned persistence, distinct-slot identity, quality preservation,
  rollback and production isolation passed
- next_exact_step: update supporting docs and inspect the final PR #3 diff/checks/mergeability

## Checkpoint — Fixed Cutoff Rollback Verified

- timestamp: 2026-10-07 14:06 KST
- candidate: `market-feature-validation`
- authenticated GET `/`: `replayCutoffMs=1791349487432`, matching request time rather than the
  temporary historical cutoff
- selected observation: 2026-10-07 14:04:44.645 KST; age 2.875 seconds; 153 distinct slots
- D1 query writes: current/intraday/same-time all zero
- production snapshot: 2026-10-07 14:04:44.645 KST, schema v3, fresh, pipeline OK,
  sourceErrors empty; both stocks and KOSPI investor feed live
- conclusion: temporary cutoff is removed; candidate is latest-by-default and read-only again
- M1 audit: all correctness gates now pass; documented three-slot Feature v2 persistence gate still
  has one slot and requires two additional distinct controlled slots
- next_exact_step: enable candidate-only Feature v2 writes for the next controlled slot

## Checkpoint — Real Changed-Bucket Correctness Gate Passed

- timestamp: 2026-10-07 13:59 KST
- branch: `feature/feature-engine-v2`
- request: authenticated candidate GET `/` with temporary read-only default cutoff `1791340050000`
- selected observation: 2026-10-07 11:26:46.820 KST; stored production Feature v1; 74 distinct slots
- validation: Feature v2 windows 2/5/10/30 minutes all available; `changedBucketObserved=true`
- Samsung foreign: +145,000 shares, `INCREASING`, acceleration -728,000, `VALID`
- Samsung institution: +116,000 shares, `INCREASING`, acceleration +237,000, `VALID`
- SK Hynix foreign: -52,000 shares, `DECREASING`, acceleration -7,000, `VALID`
- SK Hynix institution: -10,000 shares, `DECREASING`, acceleration +37,000, `VALID`
- all four changes appeared as verified `BUCKET_CHANGE_ONLY` values in 2/5/10/30-minute windows;
  no unchanged bucket was converted to zero
- observability: current/intraday/same-time query rows read 75/75/1,686; all wrote zero rows
- compact storage: 71,940 full bytes versus 14,286 compact bytes, 80.14% reduction
- quality: ceiling `STALE_INPUT` because program inputs were explicitly stale; null ratio 36.51%
- rollback commits: handler `868f3fee1d3e6ecd1a54f47e065e14a31cf78641`, generated Worker
  `cefd0f3ef34a58c7ce6faee75c2fad2f51d7233f`, tests `b2faa46e50af58da230a2f5bc0a336d757cceff3`
- rollback tests: 35/35 local pass; fixed default removed, URL/header/path replay support retained
- production check: main snapshot remained schema v3, fresh, sourceErrors empty; pipeline `DEGRADED`
  reflected data quality rather than a candidate/D1 failure
- next_exact_step: deploy rolled-back candidate Worker and verify GET `/` returns request-time cutoff

## Checkpoint — Temporary Fixed Read-only Cutoff Ready

- timestamp: 2026-10-07 13:51 KST
- branch: `feature/feature-engine-v2`
- commits: handler `47b66d47514da4cb231c71d98690c0fd0928377b`, generated Worker
  `56a2289fb3ea2c923a9ba4146a80bd7dc1021591`, test `b2dbf99ce38ffb48153114f6982609dd144c628a`
- latest path attempt: replay returned request-time cutoff `1791348463446`, observation at
  13:46:45 KST and zero query writes; requested historical cutoff was not applied
- temporary fix: authenticated GET `/` defaults to `1791340050000` and exposes validator build
  `forced-read-only-cutoff-20261007`; URL/header/path overrides remain supported
- scope: separate candidate only, GET read-only, POST continues to use latest observation, v2 writes
  remain disabled, Production Worker and D1 rows are unchanged
- rollback: restore the default GET cutoff to `Date.now()` and redeploy immediately after evidence
- tests: 35/35 local pass
- deployment: fixed-cutoff candidate not yet deployed
- next_exact_step: deploy generated candidate Worker, then authenticated GET `/`

## Checkpoint — Cloudflare Tester Cutoff Path Fallback Ready

- timestamp: 2026-10-07 13:44 KST
- branch: `feature/feature-engine-v2`
- commits: handler `735d70fd0f530e0e1575aec22d83898ea6dceb8d`, generated Worker
  `18e4bda991db09f3181ecacff26bf43e74746fe2`, test `a1531023bfba9ce0f5c21dde1cdf0915e31db0c6`
- observed header result: authenticated replay returned `replayCutoffMs=1791348130022` and the
  13:40:54 KST observation instead of requested `1791340050000`; no historical cutoff was applied
- interpretation: the Dashboard tester preserved Authorization but did not forward the added cutoff
  header; production and D1 were unaffected, and GET wrote zero rows
- fix: authenticated read-only GET now accepts `/replay/<cutoffMs>` while preserving URL and header
  methods; invalid/future values still fail before D1 access and POST semantics are unchanged
- tests: 35/35 local pass
- production/D1 impact: none; candidate-only code, no migration, no write, v2 writes remain disabled
- deployment: path-enabled candidate not yet deployed
- next_exact_step: deploy the generated candidate Worker, then authenticated GET
  `/replay/1791340050000`

## Checkpoint — Cloudflare Tester Cutoff Header Fallback Ready

- timestamp: 2026-10-07 13:35 KST
- branch: `feature/feature-engine-v2`
- commits: handler `79ceabc7b53145c80de72c3ff52574b6193b56a5`, generated Worker
  `1928ac7e13dcbbb3ef111f6a255951a42a0c3b98`, test `329460e529a26153e2a2a1146e9ad9e4a7f2a32e`
- observed deployment evidence: candidate response included `replayCutoffMs`, proving the cutoff-aware
  source was active, but returned request time instead of `1791340050000`; the Dashboard tester did
  not forward the query parameter entered in its path field
- fix: authenticated GET accepts `X-Replay-Cutoff-Ms` as a fallback while preserving URL
  `cutoffMs`; invalid/future values still fail before D1 access and POST remains latest-only
- tests: 34/34 local pass
- production/D1 impact: none; candidate-only code, no migration, no write, v2 writes remain disabled
- deployment: header-enabled candidate not yet deployed
- next_exact_step: deploy the generated candidate Worker, then GET `/` with existing Authorization
  header plus `X-Replay-Cutoff-Ms: 1791340050000`

## Checkpoint — Real Bucket Transition Observed; Cutoff Replay Implemented

- timestamp: 2026-10-07 11:36 KST
- branch: `feature/feature-engine-v2`
- code commits: `80be8ecdb24a41b1b89b9c6f40b3ee2888a131d7`,
  `911ff28d4677b8b360030412ab15ce73bbf5440c`, `37473857bdeaeb176fbfcba06b70eec9eeb45cee`
- actual source transition: 10:00 to 11:20 KST, captured by production D1 observations
- actual window deltas: Samsung foreign +145,000 and institution +116,000 shares;
  SK Hynix foreign -52,000 and institution -10,000 shares
- window evidence: the same real deltas appeared as `BUCKET_CHANGE_ONLY` in 5/10/30-minute
  Feature v2 metrics and fed the descriptive divergence layer
- observation safety: a later 11:31 replay correctly returned the event-only `bucketChanges` fields
  to `BUCKET_UNCHANGED` with null values; no repeated delta or artificial zero was emitted
- identified validation gap: latest-only GET can miss the first two-minute observation of a new bucket,
  so it cannot always expose the event's direction and acceleration after the fact
- fix: authenticated GET now accepts a validated past-only `cutoffMs`; invalid/future cutoffs return
  HTTP 400 before D1 access; POST always uses the latest observation
- tests: 33/33 local pass
- deployment: cutoff-enabled candidate not yet deployed; production Worker and D1 rows unchanged
- next_exact_step: redeploy the generated candidate Worker with writes disabled, then GET
  `/?cutoffMs=1791340050000`

## Checkpoint — Candidate D1 Failure Isolation and Recovery Validated

- timestamp: 2026-10-07 11:02 KST
- injection: removed only candidate `MARKET_HISTORY` binding; writes already disabled
- candidate failure result: authenticated GET HTTP 503 `FEATURE_VALIDATION_FAILED`
- production during failure: generated 2026-10-07 10:44:44 KST; schema v3; fresh; pipeline OK;
  sourceErrors empty; Samsung/SK Hynix live
- recovery: restored `MARKET_HISTORY -> market-history`
- candidate recovery result: authenticated HTTP 200 `READ_ONLY_REPLAY`
- recovered observation: 2026-10-07 11:00:56 KST; age 16.518 seconds; 61 distinct slots
- recovered validation: 2/5/10/30-minute windows available; 176 numeric and 128 null leaves;
  null ratio 42.11%; quality ceiling `UNVERIFIED_TIME`
- recovered storage: 68,881 full bytes; 13,823 compact bytes; 79.93% reduction
- recovered query meta: current 1/0, intraday 62/0, same-time 1,680/0 rows read/written
- recovered wall time: 74 ms; not Worker CPU duration
- write state: `FEATURE_V2_WRITE_ENABLED=false`; GET stored no v2 row
- stock-flow correctness: real changed bucket still not observed; four bucket metrics remained null
  with `BUCKET_UNCHANGED`, direction null and acceleration null
- next_exact_step: wait for the next actual source bucket and re-run authenticated GET

## Checkpoint — Cloudflare Worker CPU Evidence Captured

- timestamp: 2026-10-07 10:36 KST
- scope: `market-feature-validation`, all deployed versions, last 24 hours
- invocations: 72
- errors: 0
- CPU-limit exceedances: 0
- CPU time: P50 0.52 ms; P90 3.97 ms; P99/P999 8.28 ms
- actual time: P50 0.85 ms; P90 24.33 ms; P99/P999 61.73 ms
- request duration: P50 0.78 ms; P90 24.24 ms; P99/P999 61.66 ms
- memory: P50 1.57 MB; P90 2.51 MB; P99/P999 3.48 MB
- interpretation: provider CPU metrics are now distinct from the 177 ms response wall time; the
  dashboard does not isolate the exact controlled-write request's CPU value
- next_exact_step: controlled D1 binding failure injection on the candidate only

## Checkpoint — Post-rollback D1 Row Stability Verified

- timestamp: 2026-10-07 10:27 KST
- query result: Feature v2 row count 1; distinct Feature v2 slots 1
- baseline before opt-in: 0 rows
- controlled insert: 1 row
- after write disabled and blocked POST: still 1 row/1 slot
- conclusion: rollback caused no extra persistence or duplicate row
- production: schema v3 snapshot remained fresh, pipeline OK and sourceErrors empty
- next_exact_step: capture actual candidate Worker CPU evidence from Cloudflare observability

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
- Tests: 36/36 local pass.
