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
Fourteen focused tests pass; a pinned public snapshot fixture prevents scheduled writes from changing the regression inputs. No authenticated KIS integration test or Cloudflare deployment was performed.

## Remaining before quality stage is complete
- Inspect deployed source/version, LIVE_SOURCE and KIS_CACHE bindings, Secret names only, and actual Cron expression in Cloudflare.
- Confirm deployment and next scheduled snapshot contain additive metadata; do not infer deployment from GitHub merge.
- Confirm the calendar API response in production. This patch now gates KIS quote collection on confirmed holidays; unknown calendars degrade the pipeline.
- Index and futures sources do not expose exchange timestamps in the current adapters. The patch uses RECENT_FETCH, marketTime:null and an explicit unverifiedMarketTimes list. Obtaining exchange timestamps remains future adapter work.
- pipelineStatus now includes missing/stale/invalid metadata. Exact KIS source failures propagate to matching records. Unmapped upstream error labels still degrade the entire pipeline without speculative per-field mapping.
- Top-level fresh is ingestion-time status; consumers must recompute age when reading a stored snapshot.
- Public /run triggers writes; review access control separately without changing existing integrations blindly.
- Then resume options/VKOSPI, overseas semiconductor sources, FX/rates, history in the agreed order.

## Follow-up quality patch
- qualityVersion: 2026-10-01.1 in payload and Worker health, while schemaVersion remains 3.
- Calendar-gated KIS collection; strict date validation; per-source SOURCE_ERROR/API_LIMIT; ingestion age recalculated after enrichment.
- Current bucket dates come from businessDate or the original estimate fetch, never from the new snapshot date.
- /market read-only request at 2026-10-01 08:50:33 KST returned errors:[] from the live source. This is not an authenticated relay deployment test.
- Cloudflare dashboard remains blocked by the previously observed security challenge. No production deployment or main merge has occurred.
