# Judgment records and future forecast ledger

## Implemented local historical example

`domain/report-judgment.mjs` creates a frozen, content-hashed record and appends a new ID without overwriting prior entries. This is a local prototype, not durable append-only storage, a signed audit trail, a deployed API or a forecast engine. Git edits are not cryptographically prevented. No private data or external writes are involved.

Example: examples/samsung-q2-report-change.input.json → examples/samsung-q2-report-change.record.json. It compares two official Samsung releases for the same2026Q2 consolidated KRW period: preliminary estimate to company-reported results. This is a deliberately historical integration example, not the latest market assessment or an independent research-report consensus. The current report plus its earlier comparator count as one issuer, not two independent sources.

Original pages read2026-10-16:
- https://news.samsung.com/global/samsung-electronics-announces-earnings-guidance-for-second-quarter-2026 — dated2026-07-07; consolidated sales/operating-profit bullets (lines75–77 in retrieved text).
- https://news.samsung.com/global/samsung-electronics-announces-second-quarter-2026-results — dated2026-07-30; opening consolidated results (lines73–76).

Normalized values use KRW billion. Revenue171000→171500, change500; operating profit89400→89500, change100. These are changes from preliminary figures for the same quarter, not quarterly growth, analyst forecast revisions, or newly confirmed 2026Q3 results. Source date precision is date-only; firstSeenAtMs is today's actual collection checkpoint, so the example cannot be backdated to July as an original model prediction. Company-reported does not imply audited. No target-price, earnings-multiple or future-year decomposition is available here.

Schema records ID, generated time, input cutoff, fiscal period/scope/currency/unit, source URLs and original locations, first-seen times, explicit figure status, changes, inference, contrary evidence, invalidation, and record digest. Source facts and analyst inference remain separate. The example infers only numerical consistency with preliminary figures; it does not conclude hold/buy/sell or validate the long-term thesis. No report body is redistributed. Reading these sources does not authorize automated mass collection.

Safety tests:4/4 targeted PASS, including incompatible basis, unread sources, future/backdated evidence, missing/nonfinite metrics, zero-denominator null, deterministic output, immutable append, duplicate ID and hash-tamper rejection. Original-read flag is an upstream provenance assertion backed by the documented reading; code alone cannot attest website contents.

## Forecast/outcome work still planned

A future predictive record needs target, horizon, expiry, explicitly stated probability where justified, frozen rationale/input versions and separate post-expiry outcomes. The implemented historical example deliberately has null target/horizon/expiry/probability and NOT_APPLICABLE_NOT_A_FORECAST outcome; never score it as a successful forecast. No D1 forecast/outcome tables, prediction accuracy, backtest/calibration or actual user-action history exists from this change. Future amendments append new IDs; outcome evaluation must not rewrite the original reasoning. Parallel strategic/evidence work need not wait for every tactical feature, but must preserve its own evidence and operational status.
