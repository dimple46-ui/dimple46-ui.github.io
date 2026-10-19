# Consumer/fallback contract

## Implementation and deployment scope

`selectConsumerData` in cloudflare/consumer-fallback.mjs is a pure selection helper: no network, authentication, SQL, persistence or order execution. It accepts already obtained candidateState (/state), candidateFeatures (/features) and a GitHub schema3 snapshot.

`buildPublicConsumerSummary` in cloudflare/public-consumer-summary.mjs projects fixed public metadata from that helper. The separate intelligence candidate exposes it through authenticated GET /summary. Candidate release3 at647787b was deployed and authenticated on2026-10-16; its receipt is validation/candidate-summary-20261016-1411.json. The subsequent quality-preservation fix must be assessed using its own exact-SHA evidence in RESUME.md. A local-only helper is distinct from the deployed candidate handler.

There is no approved production route, connected scheduled consumer, private portfolio service, Signal runtime service, or continuous Feature2 writer implied by this contract.

## Selection and freshness

- Callers supply nowMs and separate maxObservationAgeMs/maxFeatureAgeMs. These are age policies, not portfolio rules.
- Prefer valid candidate observations; on failure/invalid/future/stale data, use valid GitHub Samsung/SK Hynix price/volume only. Empty/null-only observations are unavailable.
- Preserve null, measured0, source status, quality and pipeline degradation. Invalid numbers or future per-metric timestamps are suppressed. Observation age does not verify exchange time or individual source freshness.
- Feature age is now minus its own inputCutoffMs. It never inherits observation freshness. Missing, stale, failed, unsupported-version and future Feature remain UNAVAILABLE.
- An age-rejected Feature retains only its allowlisted original quality ceiling (VERIFIED, RECENT_FETCH, UNVERIFIED_TIME, STALE_INPUT, MISSING_INPUT); unknown values become UNKNOWN. Retaining a ceiling does not make that Feature available. Data remains null.
- GitHub fallback provides no Feature, Signal, portfolio, thesis or decision. Overall PARTIAL means an observation is selected, not whole-system success. Separate cutoffs do not imply a synchronized decision.
- Source-quality reason codes describe captured reported issues; they do not revalidate source freshness at read time.
- Candidate metric times and Feature generation must not exceed the saved response cutoff, even at a later display time. GitHub relayUpdatedAt is an observation timestamp rather than proven availability.
- Both Feature SELECTs filter input and generation times before ORDER BY/LIMIT. An eligible older row remains selectable; an ineligible pinned slot is not found. This does not establish original persistence/first-arrival proof.
- Public projections exclude accounts, holdings, balances, debt, private analysis and personal actions.

## Existing access paths

| Path | Access | Scope |
| --- | --- | --- |
| Candidate /health | Existing Bearer INTELLIGENCE_READ_TOKEN | Lightweight health by default in checker; explicit storage-growth request is separate |
| Candidate /state | Existing Bearer token | Bounded observation read |
| Candidate /features | Existing Bearer token | Stored compact Feature2, including its actual age/quality |
| Candidate /history | Existing Bearer token | Bounded fixed SELECT history |
| Candidate /summary | Existing Bearer token | At most two bounded SELECTs; whitelisted observation/Feature metadata, no generated Signal or private output |
| GitHub main market-live.json | Public | Schema3 observations; helper fallback is stock price/volume only |
| scripts/summarize-public-input.mjs | Local saved public files | Offline projection with explicit reference/age policy; no network or credential access |

Candidate origin: https://market-intelligence-read-candidate.dimple3691.workers.dev

Public fallback: https://raw.githubusercontent.com/dimple46-ui/dimple46-ui.github.io/main/market-live.json

/summary requires maxObservationAgeMs (0..900000) and maxFeatureAgeMs (0..3600000); optional cutoffMs must not be future; ticker is ALL/005930/000660. Authentication, GET-only handling, rate limiting, query deadline, fixed SELECT enforcement and response limits are shared with the existing API. D1 binding itself does not provide SELECT-only permissions.

## Validation and scheduling boundary

Existing CI and Cloudflare Builds remain the sole candidate deployment path. candidate-check.yml uses its existing Secret and emits a sanitized authenticated receipt. It verifies exact reported SHA, independent ages/cutoffs, quality for a matching stored Feature, explicit zero-write query metadata and unavailable private capabilities. An identity report plus successful provider build is not independent provider code attestation.

Historical receipts are immutable evidence for their source SHA and capture time. Local replay/synthetic tests are correctness evidence, never new live-market validation. Continuous Feature2 persistence remains inactive/unverified; old20261007 rows do not become current.

Scheduled tasks do not automatically inherit Work, Cloudflare runtime or GitHub Actions Secrets. Candidate API authentication in CI does not establish scheduler access. No scheduled connection or notification delivery is configured here. A separately approved consumer must obtain its own authenticated access, or report only the public fallback's available scope. Do not expose token values or put personal data in public artifacts.

## Roadmap links

M2/M3 history is retained. Fictional ledger/risk, one report-to-thesis/decision example, and alternative-comparison contracts exist as separate local prototypes; they are not production asset-management engines. The next integration depends on measured gaps and approved private/scheduled access, as recorded in RESUME.md. No new external source, private store, production route or execution loop is authorized by this document.
