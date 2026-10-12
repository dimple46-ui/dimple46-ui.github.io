# Resume — Real-time Investment Intelligence System v4

- updated_at_kst: `2026-10-13 06:54 KST`
- recovery_verified_remote_head: `1eff5d59ccb3cc4478d3740e24c11bad7ec613e2` (before this documentation checkpoint)
- current_milestone: `M2 — Operational / Storage Architecture Stabilization`
- current_branch: `feature/m2-operational-storage`
- verified_head_sha: `7a7ea50db1d7be701422275f07c817d213ccc090` (candidate pre-deploy regression gate)
- main_sha_at_checkpoint: `f4570a7d1aff08206d70934a4bb9bbaaf33e96d0` (live snapshot commit; expected to advance)
- active_pr: `#4`, Draft/Open, not merged
- last_successful_test: local full regression `72/72 PASS`; new automation tests `8/8 PASS` (synthetic only)
- last_successful_ci: full regression `38255370075` SUCCESS at `7a7ea50...`;
  candidate-check workflow `38208466333` SUCCESS at `08b32931...`;
  remote-check job disabled/not run. Full regression CI `38208469640` SUCCESS at `08b32931...`;
  prior full-suite CI `38206167262` SUCCESS at `102672c...` remains valid for unchanged runtime code.
- last_successful_deployment: isolated candidate build `3dd74257-284b-4129-8969-26520b85d8e9`, SUCCESS
- deployed_commit_sha: `d8d51330ce70b90f1f3530a0dacda2f8aa7b56cf`, exactly verified by authenticated `/health`
- latest_candidate_build: `1417e3bb-f29b-4600-aca2-004612cea6a7`, FAILED before cloning at `7a7ea50...`;
  last authenticated runtime evidence remains `d8d51330...`, not a current deployment verification
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
- production_status: production relay health at `2026-10-12 12:50:53 KST` remained schema 3 with History
  and KIS enabled; no production Worker, binding, Secret or route was changed
- candidate_status: isolated, authenticated and read-only release 2 is active. Authenticated `/health` at
  `2026-10-12 12:57:53 KST` reported exact SHA `d8d51330...`, freshness basis
  `AS_OF_MINUS_OBSERVED_AT`, nonzero age `67,655 ms`, a current `20261012` observation, and zero D1 writes.
  The old compact Feature v2 run remains from `20261007` with `STALE_INPUT`; it was not promoted to current.
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
- automation_status: existing intelligence Cloudflare Builds branch and complete deploy command confirmed
  from user screenshot/text; candidate-only Wrangler config now runs the full regression suite before
  upload. Local 72/72 PASS and GitHub CI SUCCESS. Cloudflare Build `1417e3bb-f29b-4600-aca2-004612cea6a7`
  FAILED for `7a7ea50...`; supplied provider screenshot now shows a stale build-token error before
  repository cloning. The new test gate/deploy command did not execute. Provider reports the selected
  token was deleted or rolled; its actual token lifecycle is not independently verified.
  Latest runtime identity remains unverified; last successful deployment evidence is unchanged.
  Direct API deployment, migration and rollback are NOT activated. See `CANDIDATE_AUTOMATION.md`.
- access_status: on `2026-10-13 06:54 KST`, Work token/account ID and endpoint tokens remain absent;
  GitHub Secrets existence is UNVERIFIED (connector excludes Secrets APIs). Cloudflare secure login
  was attempted; the site returned `API Request Failed` with HTTP 403. Authentication is not verified.
  Automated login stopped after this site error; no credential values were read or logged.
  Do not create/reissue existing tokens or copy credential values into chat/checkpoints.
- recovery_status: `BLOCKED_BY_USER_ACTION`; remote HEAD still `1eff5d59...`, PR #4 Draft/Open.
  Recovered the unsaved local stale-build-token diagnosis: previous GitHub write was not executed
  because automatic approval review hit a usage limit. Exact `7a7ea50...` checks rechecked:
  node-tests SUCCESS, Workers Builds FAILURE. Unchanged tests were not rerun.
- credential_scope_status: API-token UI has no Worker selector per user report. Account-wide edit
  authority was NOT approved or provisioned. This does not prove automatic deployment impossible.
  Existing Cloudflare Builds must be inspected before proposing another deployer or broader token.
- next_exact_step: open the existing intelligence candidate Settings > Build > Build Configuration
  API token selector and inspect available token names/options without saving or exposing values.
  The selected build token is `Workers ビルド - 2026-10-08 09:41`; error diagnosis is COMPLETE.
  Status BLOCKED_BY_USER_ACTION: Work has no authenticated provider credential to repair this link;
  the cloud browser login attempt was rejected with HTTP 403. User-side inspection is required.
  Do not blindly retry, replace runtime Secrets, or grant broader account permissions.
  Separate validator deployment and program replay cutoff
  `1791778965346` remain pending; the intelligence deploy does not deploy the feature validator.

Do not recreate PR #3, D1 History, `market_observations`, `feature_runs`, the candidate Worker, its Secret,
bindings, rate limiter, read endpoints, or the M3 pure-function Signal candidate.
