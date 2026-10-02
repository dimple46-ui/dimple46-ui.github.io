# Changelog

## v4 history candidate (2026-10-01, not deployed)
- Optional MARKET_HISTORY D1 binding; additive SQL migration.
- Immutable two-minute observations and isolated background persistence.
- First point-in-time features with explicit baseline gaps, bucket semantics and contract checks.
- 22 tests including SQLite integration, duplicate suppression, stale/missing data and failure isolation.

## qualityVersion 2026-10-01.1 (production verified)
- Deployed by user and verified at 09:06:14 KST; subsequent 09:20 snapshot retains this version.
- Source errors empty; program timestamp stale is flagged, not hidden.
- Timestamp/close fixes, holiday validation and signed/scaled additive fields.
