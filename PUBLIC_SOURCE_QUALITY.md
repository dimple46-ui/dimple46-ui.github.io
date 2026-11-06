# Public source-quality summary

Status: local-only additive sourceQuality field in existing schemaVersion1 public summary; no Worker/API or scheduler deployment. Existing source selection/freshness semantics stay unchanged.

reasonCodes accepts only fixed combinations of these source names: PROGRAM, KOSPI, KOSPI200, SAMSUNG, SK_HYNIX, FUTURES, FUTURES_INVESTORS. Fixed issue states are STALE/MISSING/ERROR/UNVERIFIED_TIME; known missing exchange-time paths become *_UNVERIFIED_MARKET_TIME. Raw issue paths/status/description strings are never copied. Unknown or malformed entries increment only unrecognizedEntryCount; duplicate known codes/sources are deduplicated. Counts represent unique reported issue codes/unverified sources, not independent evidence or incident counts.

Missing/malformed issue arrays produce INCOMPLETE_METADATA and null for the missing count. Explicit empty arrays mean NO_REPORTED_ISSUES only, never verified data or pipeline OK. No selected observation produces UNAVAILABLE/null counts. Rejected candidate quality cannot contaminate the selected GitHub fallback. The original pipeline state remains independent.

All diagnostics are labeled CAPTURE_REPORTED_NOT_READ_TIME_REVALIDATED. This change does not recompute source ages from market timestamps, authenticate a source, repair stale data or promote UNVERIFIED_TIME. An old stored capture must not be presented as today's live market validation.

Saved actual13:38:47 KST capture replay at13:39:41.965 KST yields PROGRAM_STALE plus four unverified time codes (KOSPI, KOSPI200, futures price/OI/Basis source, futures investor source). knownIssueCount1, unverifiedSourceCount4, unrecognizedEntryCount0, pipeline DEGRADED. The capture is reused; no new market request occurred.

Validation: new4 tests and related workflow/CLI tests13/13 PASS; final full regression141/141 PASS after the own-key/type guard. Module SHA256 c2acd1e1abbdd7dfb96780ea262dd02fca00dbbc1314010ad48b45e557ab6257. No private scenario output, production change, remote CI/deploy or live gate promotion.
