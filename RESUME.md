# Resume — Real-time Investment Intelligence System v4

- updated_at_kst: `2026-10-13 12:07 KST` (recovered local work; authenticated evidence from 09:09 KST)
- recovery_verified_remote_head: `20e28d990f21225d34c20d71bf8288563d5b78e2` (before this checkpoint)
- current_milestone: `M2 — Operational / Storage Architecture Stabilization`
- current_branch: `feature/m2-operational-storage`
- verified_head_sha: `7a7ea50db1d7be701422275f07c817d213ccc090` (candidate pre-deploy regression gate)
- main_sha_at_checkpoint: `f4570a7d1aff08206d70934a4bb9bbaaf33e96d0` (live snapshot commit; expected to advance)
- active_pr: `#4`, Draft/Open, not merged
- last_successful_test: changed validator tests `9/9 PASS`, including source-identity guard that failed
  before artifact regeneration and passed afterward; prior full regression `72/72 PASS` reused for
  unchanged runtime logic. No claim that all current tests were rerun; CI skipped to avoid unrelated deploy.
- last_successful_ci: full regression `38325024034` SUCCESS at `c6cc50c...`;
  prior full regression `38255370075` SUCCESS at `7a7ea50...`;
  candidate-check workflow `38208466333` SUCCESS at `08b32931...`;
  remote-check job disabled/not run. Full regression CI `38208469640` SUCCESS at `08b32931...`;
  prior full-suite CI `38206167262` SUCCESS at `102672c...` remains valid for unchanged runtime code.
- last_successful_deployment: provider Workers Builds check SUCCESS for isolated build
  `78d97dcd-c63d-4499-9599-11fc3f3cb773`, exact SHA `c6cc50c69f6cf5d6e793c407aeab12d034f0a35e`,
  completed `2026-10-13T00:00:33Z`; user-supplied authenticated /health verified at `00:09:27.598Z`
- deployed_commit_sha: `c6cc50c69f6cf5d6e793c407aeab12d034f0a35e`, exact build and authenticated
  /health release.workerGitSha match; provider deployment ID/tag remain unavailable
- latest_candidate_build: `78d97dcd-c63d-4499-9599-11fc3f3cb773`, SUCCESS;
  `DEPLOYED_HEALTH_VALIDATED`; other route checks/validator deployment are separate gates
- latest_unauthenticated_validation: direct candidate GET /health with no token and deliberately
  invalid token both returned HTTP 401 with UNAUTHORIZED after build success; no D1 write requested
- last_successful_validation: replay at input cutoff `2026-10-12T04:22:45.140Z` had verified program
  quality and a real 30-minute delta of `-78,889,655,137`; it exposed the observation/source-time
  alignment gap while preserving zero D1 writes and all safety checks
- current_live_validation: candidate D1 `/state` exactly matched production `market-live.json` at
  `2026-10-12 13:02:45 KST` for observation identity, both stocks, market/program flows, futures/OI/Basis,
  quality and pipeline; one D1 row read, zero written. Three real stock-flow buckets are available.
- latest_feature_replay: read-only replay at input cutoff `2026-10-12T02:26:43.839Z` passed the local
  Signal v2 validator with all D1 writes zero, deterministic output and confidence ceilings. All
  2/5/10/30m windows were available. Samsung foreign/institution deltas were `-245,000/-171,000`
  with accelerations `-69,000/-261,000`; SK Hynix deltas were `-59,000/-30,000` with accelerations
  `+19,000/-74,000`. Program remained honestly stale; futures/OI/Basis retained `UNVERIFIED_TIME`.
- production_status: main snapshot at `2026-10-13 12:06:42.790 KST` is schema 3, trading/open day Y,
  sourceErrors empty and DEGRADED due to program STALE. Regular session is open at recovery.
  No production Worker, binding, Secret or route was changed.
- candidate_status: user authenticated /health at `2026-10-13 09:09:27.598 KST` matches `c6cc50c...`,
  release 2; latest observation age 44,293 ms, day 20261013, all four query rowsWritten/changes zero.
  Same-time main snapshot `b301759c...` has exact evaluatedAt `00:08:43.305Z` matching observedAtMs;
  DEGRADED is due to program MISSING. Both stock prices LIVE, stock flows NOT_DUE; indexes/futures
  remain RECENT_FETCH/unverified-time. Stored v2 is still 20261007 STALE_INPUT, not current-day v2.
- known_observability_limits: provider deployment ID/tag null, timestamp `0001-01-01T00:00:00Z`;
  runtime.startedAtMs is 0, so isolate start/uptime evidence is unavailable. These are not CPU evidence.
- validator_artifact: regenerated with existing builder; only stale CANDIDATE_SHA256 header changed.
  Expected source hash `b28192c567c764f5868e01bb6f5f376161be4e36929a1628b6126c584d7c0733`;
  core matched before regeneration. Source-identity regression guard added; TESTED_NOT_DEPLOYED.
- off_market_validation: `scripts/validate-signal-replay.mjs` now checks captured read-only Feature v2
  replays for past-only cutoffs, zero D1 writes, deterministic Signal output, confidence ceilings,
  stale/null suppression and descriptive-only semantics; it does not fetch, persist or deploy data
- signal_candidate: pure-function Signal version 2 adds foreign-flow reversal and institution flow
  acceleration/deceleration with one mutually exclusive classification per verified changed bucket;
  relative-strength reversal remains unimplemented until prior comparable relative-strength state exists
- waiting_for_live: the source-time alignment correction is `TESTED_NOT_DEPLOYED` and needs an isolated
  candidate replay; continuous Feature v2 persistence remains disabled, and D1 provider-byte growth still
  needs the planned 20-trading-day measurement window
- blocked_actions: main merge, production Worker/binding/Secret/route changes and destructive D1 work require
  separate approval; authenticated candidate/validator requests require the existing Dashboard-held Secrets
- approved_scope: isolated read-only candidate code, tests, candidate deploys, documentation and validation
- automation_status: existing branch integration reused successfully after user saved a new build token.
  Build `78d97dcd...` and GitHub CI both SUCCESS at exact `c6cc50c...`; no new deployer was installed.
  The configured pre-upload regression gate remains enabled. The earlier stale-token build failed
  before cloning; this retry succeeded. Authenticated /health identity and zero-write D1 reads verified;
  full authenticated smoke remains unavailable to Work without existing endpoint credentials.
  Direct API deployment, migration and rollback are NOT activated. See `CANDIDATE_AUTOMATION.md`.
- access_status: on `2026-10-13 06:54 KST`, Work token/account ID and endpoint tokens remain absent;
  GitHub Secrets existence is UNVERIFIED (connector excludes Secrets APIs). Cloudflare secure login
  was attempted; the site returned `API Request Failed` with HTTP 403. Authentication is not verified.
  Automated login stopped after this site error; no credential values were read or logged.
  Do not create/reissue existing tokens or copy credential values into chat/checkpoints.
- recovery_status: prior unsaved diagnosis persisted at `4ac1895...`; PR #4 remains Draft/Open.
  User repaired the build token and Work triggered/verified one existing Builds run via `c6cc50c...`.
  No local regression rerun; existing local evidence reused, remote CI/predeploy gate run automatically.
- credential_scope_status: API-token UI has no Worker selector per user report. Account-wide edit
  authority was NOT approved or provisioned. This does not prove automatic deployment impossible.
  Existing Cloudflare Builds must be inspected before proposing another deployer or broader token.
- build_token_recovery: user screenshot confirms new `Workers 빌드 - 2026-10-13 08:57` selected;
  user reported Save completed at 08:58 KST. No token value was read. Permission scope remains
  unverified; selection/save is not proof of successful authentication or deployment.
- next_exact_step: separate existing candidate-check.yml intelligence smoke from provider settings
  audit and validator replay so minimum endpoint credentials suffice independently. Do not activate
  remote jobs or add a deployer without verified credential availability. Provider configuration and
  replay access remain BLOCKED_BY_AUTH; do not repeat the rejected Cloudflare login.
  Later inspect existing validator Builds settings/write-disabled/bindings before deployment;
  separate source-time program replay cutoff `1791778965346` remains pending.

Do not recreate PR #3, D1 History, `market_observations`, `feature_runs`, the candidate Worker, its Secret,
bindings, rate limiter, read endpoints, or the M3 pure-function Signal candidate.
