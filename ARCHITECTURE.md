# Architecture

Naver/Npay live Worker + KIS → existing relay quality checks → existing GitHub latest snapshot.

Optional side branch: relay → ctx.waitUntil → MARKET_HISTORY D1 → market_observations → stored features_json.

The GitHub PUT path does not await D1. Caught D1 errors cannot reject GitHub publication. They are logged without credentials. Runtime/CPU exhaustion is still shared by the Worker and needs production measurement. No public history endpoint is added.

History uses first observation per two-minute UTC slot (KST offset is aligned), up to 331 slots per existing 09:00–20:00 window. This does not configure or verify Cron. Confirmed holidays are skipped. Unknown calendars retain observed data with original quality flags. No automatic archive, retention deletion, adaptive sampling or backfill is enabled.

Rollback: set HISTORY_ENABLED=false or remove only MARKET_HISTORY binding; retain the database. Existing LIVE_SOURCE, KIS_CACHE and secrets are untouched.
