# Local consumer/fallback contract

Status: implemented and locally tested; not deployed, connected to a consumer, or available to scheduled tasks.

`selectConsumerData` in cloudflare/consumer-fallback.mjs accepts already obtained candidateState (/state), candidateFeatures (/features), and a GitHub schema3 snapshot. It performs no network, authentication, SQL, persistence or order execution. Callers must supply nowMs and separate maxObservationAgeMs/maxFeatureAgeMs; these are data-age policies, not approved portfolio limits.

- Prefer valid candidate observations; on failure/invalid/future/stale data, use valid GitHub price/volume for Samsung and SK Hynix only. Empty/null-only observations cannot satisfy availability.
- Preserve null, measured0, raw source status, quality and pipeline degradation. Invalid numeric or future per-metric timestamps are suppressed. Ingestion age does not certify exchange/source freshness; individual fields retain their status, which consumers must inspect.
- Feature age is now minus its own inputCutoffMs, independently of observation age. Missing, stale, failed, unsupported-version or future features remain UNAVAILABLE. Even a fresh Feature carrying UNVERIFIED_TIME stays UNVERIFIED_TIME.
- GitHub fallback cannot supply features, signals, portfolio, thesis or decisions. Overall status remains PARTIAL whenever an observation is selected; no whole-system success claim. Each feature/observation cutoff is explicit; do not treat them as a synchronized combined decision.
- Response projection excludes accounts, holdings, balances, debt and personal actions. Do not add those fields to public endpoints/artifacts. Private asset work uses fictional fixtures until a safe private path is separately approved.

## Actual access paths and scheduling boundary

Existing isolated candidate: https://market-intelligence-read-candidate.dimple3691.workers.dev/state and /features; existing Bearer INTELLIGENCE_READ_TOKEN authentication is required. Work does not provide token values, and scheduled tasks do not automatically inherit Work/runtime/GitHub Secrets. Historical candidate authentication is evidence for its deployed SHA, not evidence that a scheduled task has access today.

Existing public fallback: https://raw.githubusercontent.com/dimple46-ui/dimple46-ui.github.io/main/market-live.json ; no authentication, schema3. It contains observations, not this helper's result or a private portfolio calculation.

No persisted consumer-result endpoint/file or scheduled consumer connection is implemented by this change. A scheduler must obtain approved authenticated access separately or explicitly report price/volume-only fallback. It must not claim feature/signal/portfolio availability from a successful snapshot fetch.

## Validation and next track

New helper targeted tests5/5 PASS. Previous full107/107 at b9e7adf is historical unchanged-core evidence, not a full run including this helper. No current live/remote deployment validation. Local source SHA256: 7b1229e54dd276cd413e5b6c8931963713b7f8a90f8f1565821994b444d082f6.

Existing M2/M3 milestones remain intact. Independent next priorities: (1) fictional private ledger/risk contract and tests; (2) one accessible report's changes linked to thesis and immutable decision record; (3) minimal existing-holding/new-candidate comparison; (4) a result path actually accessible to scheduled execution. These are priorities, not implemented engines.
