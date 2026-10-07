# Architecture

Naver/Npay live Worker + KIS → existing relay quality checks → existing GitHub latest snapshot.

Deployed side path: relay → ctx.waitUntil → MARKET_HISTORY D1 → market_observations → stored features_json. `HISTORY_ENABLED=false` remains the rollback switch.

The GitHub PUT path does not await D1. Caught D1 errors cannot reject GitHub publication. They are logged without credentials. Runtime/CPU exhaustion is still shared by the Worker and needs production measurement. No public history endpoint is added.

History uses first observation per two-minute UTC slot (KST offset is aligned), up to 331 slots per existing 09:00–20:00 window. Confirmed holidays are skipped. Unknown calendars retain observed data with original quality flags. No automatic archive, retention deletion, adaptive sampling or backfill is enabled.

Feature Engine 2.0 remains a candidate. Same-day reads are capped at 331 observations. Same-time comparison first limits candidates to the most recent 20 stored trading days, then selects one past-only observation per day within the time tolerance. It adds no public history endpoint and does not modify `market-live.json`.

The separate authenticated validation Worker owns the candidate write path. It can add one
immutable compact `feature_runs` row per `(slot_ms, feature_version)` only when explicitly
enabled. It never updates `market_observations` or GitHub, so it cannot race with the production
v1 writer. Query/write D1 metadata and structured generation/failure events provide candidate
observability; Worker dashboard CPU duration remains a deployment-time evidence gate.

Rollback: set HISTORY_ENABLED=false or remove only MARKET_HISTORY binding; retain the database. Existing LIVE_SOURCE, KIS_CACHE and secrets are untouched.

## Additive latest-state target

- GitHub remains code, documentation, release history and an emergency/compatibility snapshot fallback.
- D1 remains immutable raw observations plus compact versioned feature runs.
- `cloudflare/intelligence-read-worker.mjs` is a separate, read-only candidate for current state,
  bounded history, compact features and machine-readable health.
- R2 is deferred until measured retention pressure justifies cold archive. No deletion or archive
  migration is authorized.

The candidate does not remove or slow the two-minute GitHub publication path. Migration is staged:
deploy separately, validate authenticated reads and provider rate limiting, opt consumers in, reduce
GitHub cadence only after compatibility evidence, and roll back by disabling only the read candidate.

Feature, Signal, Regime and Tactical layers remain separate. `signal-engine.mjs` is a pure descriptive
transform over Feature v2 and has no database, publication, alert or portfolio side effects.
