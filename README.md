# Market monitor — v4 history MVP

Existing production: qualityVersion 2026-10-01.1, schemaVersion 3. The history candidate extends that tested source and is not yet deployed.

Run `node --test tests/*.test.mjs` (Node 24; built-in SQLite) and `node --input-type=module --check < cloudflare/market-relay-worker.js`.

See ARCHITECTURE.md, SCHEMA.md, FEATURES.md and D1_SETUP.md. No package install is required. No automatic trading.

Milestone 1 is NOT complete: remote D1 binding/rows, operational feature access and prior same-time averages remain unverified or unfinished. The history branch is stacked on PR #1 because GitHub main still has the pre-repair source.
