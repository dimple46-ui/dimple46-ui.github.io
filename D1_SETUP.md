# D1 operations

Status: `market-history`, migration `0001_market_history.sql`, `MARKET_HISTORY` binding, real observation accumulation, Feature MVP generation, fail-safe behavior and automatic recovery were production-verified before PR #2 merged. Do not recreate, remigrate or clear the database for Feature Engine 2.0.

Feature Engine 2.0 changes Worker computation only. It requires no new binding, Secret, table or migration. Deploy it only as a candidate after branch review and local test success, then verify real version-2 rows before deciding whether to update production.

Optional rollback variable: HISTORY_ENABLED=false. No database deletion needed. Existing GitHub JSON must continue updating even if a D1 query fails.

Verify in SQL console after several scheduled runs:

```sql
SELECT slot_ms, observed_at_ms, available_at_ms, trading_day,
       pipeline_status, features_json IS NOT NULL AS features_ready
FROM market_observations ORDER BY slot_ms DESC LIMIT 5;
```

Require at least three distinct increasing slot_ms values; verify quality flags and feature baselines, not just a nonzero row count. Check Worker health historyVersion:1 and historyEnabled:true. Neither health nor local tests alone proves storage success.

## Capacity estimate

At 331 samples/day, mock Feature Engine 2.0 rows measure roughly 72 KB of JSON each, approximately 24 MB per full relay day before SQLite/index overhead. Actual production payload size, database growth and Worker CPU duration must be measured before rollout. Same-day reads are capped at 331 rows; same-time reads are bounded to the latest 20 stored trading days. Inserts/index maintenance and feature updates remain subject to production measurement.

Cloudflare limits and pricing can change, and the existing account plan/usage is unknown. Check the current account dashboard before relying on any capacity estimate. No automatic deletion is implemented. Worker CPU limits and `ctx.waitUntil` lifetime must be validated in the candidate. R2 archival and daily compaction remain future work, not a promised zero-cost unlimited history.
