# Resume — Real-time Investment Intelligence System v4

- updated_at_kst: `2026-10-12 13:59 KST`
- current_milestone: `M2 — Operational / Storage Architecture Stabilization`
- current_branch: `feature/m2-operational-storage`
- verified_head_sha: `102672c34932b2f496c33407323529496571b6e6`
- main_sha_at_checkpoint: `f4570a7d1aff08206d70934a4bb9bbaaf33e96d0` (live snapshot commit; expected to advance)
- active_pr: `#4`, Draft/Open, not merged
- last_successful_test: local full regression `64/64 PASS` after source-time-aligned program acceleration
  coverage; focused Feature/Signal suites `34/34 PASS`
- last_successful_ci: GitHub Actions `38206167262`, SUCCESS at `102672c...` with `64/64 PASS`
- last_successful_deployment: isolated candidate build `3dd74257-284b-4129-8969-26520b85d8e9`, SUCCESS
- deployed_commit_sha: `d8d51330ce70b90f1f3530a0dacda2f8aa7b56cf`, exactly verified by authenticated `/health`
- latest_candidate_build: `3dd74257-284b-4129-8969-26520b85d8e9`, active runtime verified at
  `d8d51330...`; Cloudflare deployment ID/tag remain explicitly unavailable
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
- next_exact_step: deploy only `market-feature-validation` from exact code commit `102672c...`, then
  replay cutoff `1791778965346` with the existing authentication and verify program acceleration

Do not recreate PR #3, D1 History, `market_observations`, `feature_runs`, the candidate Worker, its Secret,
bindings, rate limiter, read endpoints, or the M3 pure-function Signal candidate.
