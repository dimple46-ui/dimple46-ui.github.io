# Private local research and risk review

`domain/research-risk-review.mjs` connects the existing two-stock research/Signal pair summary to
the existing private risk workflow. It is an offline composition helper, not a new financial engine,
approval verifier, storage service, endpoint or scheduled consumer. The entire result is PRIVATE.
Never place actual inputs/results in public GitHub, CI logs, artifacts or public endpoints.

Inputs are separate: `researchContext` goes only to buildResearchPairSummary; `privateInputs` goes
only to runPrivateRiskWorkflow. Options are `researchPolicy`, `privatePolicy` (the existing workflow
options), and explicit boolean `enablePrivateEvaluation`, default false. Disabled evaluation does
not read private input properties. The private analysis reference time must equal the research
reference time; existing component/event policies retain all other validity/freshness checks.

No market fallback price becomes a verified private quote. No previous private result, cash balance,
reserve, quantity, debt rule, concentration limit or investment weight is inferred. The public pair
remains unchanged, including its unavailable private-risk fields; the new private overlay does not
grant public/Watch capabilities or change an existing stored pair decision/hash.

Each side fails independently with a fixed error code. Missing/unapproved research or stale market
Feature cannot suppress independently calculated cash risk. Missing private quotes suppress the
existing valuation/stress/concentration components while independently complete cash timing remains
available. Invalid/missing/stale cash inputs produce null cash-risk fields, never zero or resolved risk.
Supportive research cannot erase a deadline shortage or collateral restriction. Overdue obligations
and a cash shortage remain distinct. A zero known shortage does not mean the portfolio is safe.

The result preserves original research/private cutoffs and generation times, exposes a compact
cash-risk view alongside the existing private workflow result, and is detached/frozen. Existing
local event state/dedup works only if explicitly supplied; event intents are never delivery or user
actions. Overall status remains PARTIAL_LOCAL_REVIEW_ONLY. Recommendation, ranking, probability,
composite score, trade quantities and collateral clearance are null; execution is false. No genuine
approval is created or imported. No authenticated/runtime/actual financial input is connected.

Local validation: six new composition tests, targeted29/29 and full427/427 PASS at source
0ef6970ce0ea6cad8a4f1fbcbab0a256989067d6. Exact file hashes and scope are in
validation/research-risk-review-local-20261018.json. Fictional research authorizers and round-number
private fixtures only; no source truth, actual balance, deployment or live-market validation claim.
