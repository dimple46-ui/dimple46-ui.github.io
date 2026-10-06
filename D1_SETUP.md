# D1 operations

Status: `market-history`, migration `0001_market_history.sql`, `MARKET_HISTORY` binding, real observation accumulation, Feature MVP generation, fail-safe behavior and automatic recovery were production-verified before PR #2 merged. Do not recreate, remigrate or clear the database for Feature Engine 2.0.

Feature Engine 2.0 full-tree persistence is not enabled. The additive candidate design adds
`migrations/0002_feature_runs.sql` and reuses the existing `MARKET_HISTORY` binding. It requires no
new database or Secret. Do not apply this migration until the code/design review is complete;
after it is applied, deploy only the separate authenticated validation Worker and verify real
version-2 rows before deciding whether to update production.

Candidate rollback variable: `FEATURE_V2_WRITE_ENABLED=false`. This is checked before D1 reads
on `POST /feature-runs`; no row deletion or migration rollback is required.

Optional rollback variable: HISTORY_ENABLED=false. No database deletion needed. Existing GitHub JSON must continue updating even if a D1 query fails.

Verify in SQL console after several scheduled runs:

```sql
SELECT slot_ms, observed_at_ms, available_at_ms, trading_day,
       pipeline_status, features_json IS NOT NULL AS features_ready
FROM market_observations ORDER BY slot_ms DESC LIMIT 5;
```

Require at least three distinct increasing slot_ms values; verify quality flags and feature baselines, not just a nonzero row count. Check Worker health historyVersion:1 and historyEnabled:true. Neither health nor local tests alone proves storage success.

## Capacity estimate

The corrected real replay measured 69,386 bytes for the full derived tree and 14,067 bytes for
compact encoding v1, a 79.73% reduction. At 331 samples/day this projects to 4.66 MB/day for the
compact derived JSON alone, before SQLite/index and raw-observation overhead. Actual production
payload size, database growth and Worker CPU duration must be measured before rollout. Same-day
reads are capped at 331 rows; same-time reads are bounded to the latest 20 stored trading days.
See `FEATURE_STORAGE.md` for the alternatives, schema, rollback and observability gates.

Cloudflare limits and pricing can change, and the existing account plan/usage is unknown. Check the current account dashboard before relying on any capacity estimate. No automatic deletion is implemented. Worker CPU limits and `ctx.waitUntil` lifetime must be validated in the candidate. R2 archival and daily compaction remain future work, not a promised zero-cost unlimited history.
