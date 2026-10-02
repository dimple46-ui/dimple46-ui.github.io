# D1 activation — one user action at a time

Status: code and migration tested locally; no remote database or binding is verified. Cloudflare dashboard access from the agent browser was blocked by a security challenge.

First user action: Cloudflare dashboard → Storage & databases → D1 SQL Database → Create database. Name: market-history. If that name already exists, inspect it instead of creating a duplicate. No Secret is requested.

Later, separately: execute migrations/0001_market_history.sql in that database's SQL console, then add a D1 binding to the existing market-relay Worker, variable name MARKET_HISTORY, database market-history. Deploy the candidate only after migration/binding verification. No full Wrangler config is supplied because production binding IDs/Cron are not yet known.

Optional rollback variable: HISTORY_ENABLED=false. No database deletion needed. Existing GitHub JSON must continue updating even if a D1 query fails.

Verify in SQL console after several scheduled runs:

```sql
SELECT slot_ms, observed_at_ms, available_at_ms, trading_day,
       pipeline_status, features_json IS NOT NULL AS features_ready
FROM market_observations ORDER BY slot_ms DESC LIMIT 5;
```

Require at least three distinct increasing slot_ms values; verify quality flags and feature baselines, not just a nonzero row count. Check Worker health historyVersion:1 and historyEnabled:true. Neither health nor local tests alone proves storage success.

## Capacity estimate

At 331 samples/day, mock full feature rows measured about 18.5 KB JSON each: approximately 6.1 MB/day or 1.53 GB/250 days before SQLite/index overhead. Plan roughly 25 KB/row for initial capacity budgeting (~8.3 MB/day); measure actual D1 storage after activation. Max indexed day query is 331 rows, roughly 55k row visits/day under a full-session growing history, plus PK lookups. Inserts/index maintenance and feature updates are on the order of 1,000 row writes/day, subject to D1 measurement.

Free tier: 5M rows read/day, 100k written/day, 5GB account-wide, but only 500MB PER DATABASE. Paid: 10GB/database, usage allowances and overage charges per official docs. Existing account usage is unknown. With this design a free DB requires archive/retention planning well before roughly 60 full trading days; no automatic deletion is implemented. Workers CPU limits and ctx.waitUntil lifetime must be validated in production. R2 archival and daily compaction are future work, not a promised zero-cost unlimited history.
