# Relay audit — 2026-10-01 KST

## Verified evidence
- Inspected main at 7cd48b7; latest snapshot 2026-09-30 20:00:06 KST, schemaVersion 3, sourceErrors empty.
- Both stocks, estimates (14:30 bucket), futures, OI, basis and investor groups are present. This confirms the stored snapshot, not today's live trading.
- Recent snapshot commits are two minutes apart. This is observed cadence, not confirmation of the configured Cloudflare Cron expression.
- Live /health returned ok:true, service kr-market-live-v3 at 2026-09-30T23:39:31.864Z.
- Repository has only the relay source and snapshot; no live Worker source, README, Wrangler configuration or deployment workflow was present.
- Main relay source fails parsing at `async async function getKoreaMarketCalendar`.
- Source includes calendar/dataMeta/pipelineStatus/signedChange/normalizedValue, but snapshot does not. Production is not demonstrably running this source; dashboard deployment inspection remains required.
- Snapshot Samsung change is unsigned +3000 although price minus previousClose is -3000. Existing additive signed fields address this once deployed.
- KOSPI200 raw index 108182 corresponds to futures underlyingIndex 1081.82. Existing normalized fields expose the 100x scale.

## This patch
Fix syntax; recognize CLOSE and CLOSED; reject invalid/future continuous timestamps; stop missing flow timestamps being labeled LIVE; align program freshness with 300-second analysis rule; distinguish previous-date estimates; retry delayed bucket responses instead of caching them for 36 hours; reject calendar responses that omit the requested date.

Preserves API endpoints, TR_IDs, bindings, raw fields, schemaVersion and snapshot write behavior. No production snapshot was manually changed.

## Validation
`node --input-type=module --check < cloudflare/market-relay-worker.js`
`node --test tests/relay-quality.test.mjs`
Six focused tests pass. No authenticated KIS integration test or Cloudflare deployment was performed.

## Remaining before quality stage is complete
- Inspect deployed source/version, LIVE_SOURCE and KIS_CACHE bindings, Secret names only, and actual Cron expression in Cloudflare.
- Confirm deployment and next scheduled snapshot contain additive metadata; do not infer deployment from GitHub merge.
- Calendar currently labels the session but does not gate all fetches. Validate holiday handling, calendar unavailable status, and per-source close behavior.
- Index and futures freshness still uses fetch time without exchange timestamps. LIVE must not be interpreted as verified trade freshness for these sources.
- pipelineStatus currently summarizes source errors rather than all missing/stale data. sourceErrors needs per-field propagation.
- Top-level fresh is ingestion-time status; consumers must recompute age when reading a stored snapshot.
- Public /run triggers writes; review access control separately without changing existing integrations blindly.
- Then resume options/VKOSPI, overseas semiconductor sources, FX/rates, history in the agreed order.
