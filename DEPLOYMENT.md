# Relay deployment and verification

This branch is a tested candidate, not proof of the running Cloudflare version.

## Required production evidence

In Cloudflare, select the existing `market-relay` Worker under Workers & Pages.

1. Open its code editor and compare/download the currently deployed source. The main repository snapshot was produced without metadata that already exists in main; do not overwrite unknown production-only changes.
2. Record the current deployment version for rollback.
3. Inspect Settings/Bindings and Variables and Secrets by NAME ONLY: LIVE_SOURCE, GITHUB_TOKEN, REPO_FULL_NAME, KIS_APP_KEY, KIS_APP_SECRET, optional KIS_CACHE. Do not reveal or copy Secret values.
4. Inspect the Cron expression under Triggers/Trigger Events (the dashboard label may vary). Recent commits suggest a two-minute cadence, but do not establish the configured expression.

No new environment variables are required by this patch. No Secret values belong in source control.

## Apply after comparing deployed source

Use `cloudflare/market-relay-worker.js` from this PR in the existing Worker. Retain any verified production-only changes. Deploy using the existing deployment process. A GitHub merge alone is not evidence of a Cloudflare deployment.

## Verify without manually overwriting market-live.json

- Worker health should include `qualityVersion: "2026-10-01.1"` and `schemaVersion: 3`.
- During the existing weekday 09:00–20:00 KST relay window, wait for the next configured Cron run.
- Read market-live.json through GitHub and verify its new timestamp and qualityVersion.
- Check stocks.samsung, stocks.skHynix, stockFlowEstimates, futures and futuresInvestors against the prior shape.
- Inspect sourceErrors, dataMeta and dataQuality. A response or fresh:true alone is insufficient.
- Calendar UNKNOWN or KIS failures must yield DEGRADED. Confirmed holidays must not label old values LIVE.
- Check signedChange/signedChangeRate for direction and normalizedValue for index points; legacy raw fields remain unchanged.
- Recompute age when reading a saved snapshot. The stored fresh flag refers only to ingestion time.

## Status interpretation

| Status | Meaning |
| --- | --- |
| LIVE | A provided market timestamp is within the configured age limit |
| RECENT_FETCH | Fetch is recent, but exchange timestamp is unavailable |
| CURRENT_BUCKET | Estimate matches the latest due bucket, with existing five-minute publication allowance |
| NOT_DUE | No estimate bucket is due yet |
| CLOSED / HOLIDAY | Explicit source-close evidence / confirmed same-date calendar holiday |
| UNKNOWN / MISSING | Insufficient timing evidence / required value absent |
| STALE / STALE_BUCKET / HISTORICAL | Continuous timestamp too old / outdated bucket / older estimate business date |
| INVALID_TIME | Invalid or excessively future timestamp |
| SOURCE_ERROR / API_LIMIT | Source failed / explicit HTTP 429 |
| DISABLED | KIS credentials are not configured |

`pipelineStatus: OK` does not certify exchange-time freshness for RECENT_FETCH sources. `dataQuality.unverifiedMarketTimes` makes that limitation explicit.

## Rollback

If deployment fails or scheduled output regresses, roll back to the recorded Cloudflare deployment version. Do not paste the pre-patch GitHub main file: that audited version contains a syntax error.
