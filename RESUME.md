# Resume — Real-time Investment Intelligence System v4

- updated_at_kst: `2026-10-12 12:58 KST`
- current_milestone: `M2 — Operational / Storage Architecture Stabilization`
- current_branch: `feature/m2-operational-storage`
- verified_head_sha: `d8d51330ce70b90f1f3530a0dacda2f8aa7b56cf`
- main_sha_at_checkpoint: `f4570a7d1aff08206d70934a4bb9bbaaf33e96d0` (live snapshot commit; expected to advance)
- active_pr: `#4`, Draft/Open, not merged
- last_successful_test: local `63/63 PASS` after Signal v2 stock-flow classification coverage
- last_successful_ci: GitHub Actions `38119570471`, SUCCESS at `d8d51330...` with `63/63 PASS`
- last_successful_deployment: isolated candidate build `3dd74257-284b-4129-8969-26520b85d8e9`, SUCCESS
- deployed_commit_sha: `d8d51330ce70b90f1f3530a0dacda2f8aa7b56cf`, exactly verified by authenticated `/health`
- latest_candidate_build: `3dd74257-284b-4129-8969-26520b85d8e9`, active runtime verified at
  `d8d51330...`; Cloudflare deployment ID/tag remain explicitly unavailable
- last_successful_validation: candidate `/state` and production snapshot matched at the 13:42:44 KST
  observation with one D1 row read/zero written; M3 live-input Signal replay also passed with 18 signals
  and zero confidence-ceiling violations
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
- waiting_for_live: current-day continuous Feature v2 persistence remains unvalidated and is not enabled
  in production; D1 provider-byte growth still needs the planned 20-trading-day measurement window
- blocked_actions: main merge, production Worker/binding/Secret/route changes and destructive D1 work require
  separate approval; authenticated candidate/validator requests require the existing Dashboard-held Secrets
- approved_scope: isolated read-only candidate code, tests, candidate deploys, documentation and validation
- next_exact_step: fetch authenticated candidate `/state` during the current regular session and compare
  its exact observation identity, values and quality with the corresponding production snapshot

Do not recreate PR #3, D1 History, `market_observations`, `feature_runs`, the candidate Worker, its Secret,
bindings, rate limiter, read endpoints, or the M3 pure-function Signal candidate.
