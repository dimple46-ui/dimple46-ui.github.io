# Architecture

Naver/Npay live Worker + KIS → existing relay quality checks → existing GitHub latest snapshot.

Deployed side path: relay → ctx.waitUntil → MARKET_HISTORY D1 → market_observations → stored features_json. `HISTORY_ENABLED=false` remains the rollback switch.

The GitHub PUT path does not await D1. Caught D1 errors cannot reject GitHub publication. They are logged without credentials. Runtime/CPU exhaustion is still shared by the Worker and needs production measurement. No public history endpoint is added.

History uses first observation per two-minute UTC slot (KST offset is aligned), up to 331 slots per existing 09:00–20:00 window. Confirmed holidays are skipped. Unknown calendars retain observed data with original quality flags. No automatic archive, retention deletion, adaptive sampling or backfill is enabled.

Feature Engine 2.0 remains a candidate. Same-day reads are capped at 331 observations. Same-time comparison first limits candidates to the most recent 20 stored trading days, then selects one past-only observation per day within the time tolerance. It adds no public history endpoint and does not modify `market-live.json`.

Rollback: set HISTORY_ENABLED=false or remove only MARKET_HISTORY binding; retain the database. Existing LIVE_SOURCE, KIS_CACHE and secrets are untouched.
