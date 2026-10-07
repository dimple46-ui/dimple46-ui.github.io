# Market monitor v4

Production runs the Cloudflare relay, GitHub `market-live.json` snapshot (`schemaVersion: 3`) and optional D1 history (`historyVersion: 1`). The D1 History MVP was production-verified and merged through PR #2. Feature Engine 2.0 is developed separately on `feature/feature-engine-v2`; it is not a production deployment.

Run:

```bash
node --input-type=module --check < cloudflare/market-relay-worker.js
node --test tests/*.test.mjs
```

Node 24 built-in SQLite is used for integration tests. No package install is required. See
`ARCHITECTURE.md`, `SCHEMA.md`, `FEATURES.md`, `FEATURE_STORAGE.md` and `D1_SETUP.md`. No automatic
trading or BUY/SELL engine is enabled.
