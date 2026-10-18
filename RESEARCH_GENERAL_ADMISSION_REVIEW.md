# General research admission — bounded compatibility review

Status: design reviewed; decimal primitive and separate local-only schema v2 DRAFT validator implemented. No operational receiver or schema v2 consumer is active.

## Preserve existing behavior

Schema v1, hashes, immutable source packages, receipt/approval binding and existing consumers remain unchanged. Never reinterpret a v1 approval as approval for a derived package or newer schema. Its report comparison remains the existing same-period preliminary-to-company-reported operation.

## Next contract boundary

A separately versioned general research contract should permit a single original source and make report comparison optional. Source count is not independent corroboration. An unavailable comparison produces unavailable comparison output; it does not block unrelated, explicitly sourced research or create a zero delta. Do not pass an absent comparison through existing consumers expecting a v1 report judgment.

Represent exact financial quantities as bounded decimal strings with explicit metric, currency, unit, scope, fiscal period and preliminary/reported status. `domain/research-decimal.mjs` preserves lexical precision and uses scaled integers for equality/order. It accepts at most 18 integer digits and 9 fractional digits, rejects numeric inputs, exponents, separators and negative zero. It performs no unit conversion, arithmetic recommendation or financial inference. No automatic decimal-to-v1 integer conversion is allowed.

Maintain publication date, declared acquisition precision and actual engine receipt/verification time separately. Date-only acquisition cannot be silently assigned midnight or an inferred intraday instant. Unknown historical availability excludes historical replay; a current verification does not backdate knowledge. Hash match, schema acceptance, original-source read, content approval and operational admission are distinct facts.

## Required next acceptance tests

- Existing v1 outputs and approvals retain their exact semantics.
- One-source research can be reviewed without a fabricated baseline/current pair.
- Missing or incompatible report comparison remains unavailable.
- Decimal quantities retain exact value, unit and period across hashing and validation.
- Future/unknown acquired-at evidence cannot leak into historical decisions.
- New/derived content requires its own package/version/hash approval; fixtures cannot authorize real research.
- New general research is rejected by legacy consumers until an explicit version-aware adapter exists.

## Implemented local DRAFT review

`schemas/research-general-draft.schema.json` and `prepareGeneralResearchDraft` in `domain/research-general-draft.mjs` accept a closed schema2 GENERAL_RESEARCH_DRAFT body. This is a new review envelope, not a renamed v1 package. It supports one to eight sources, exact monetary decimal strings, four financial metrics (revenue, operatingProfit, netIncome, netCash), consolidated KRW billion/trillion quantities and optional same-period report comparison. Broad industry percentages, EPS, forecasts across arbitrary units, portfolio alternatives and monitoring-rule execution are outside this first validator.

Every acquisition explicitly declares INSTANT, DATE_ONLY (Asia/Seoul) or UNKNOWN; irrelevant time fields must be null. Publication, cutoff and generation are checked; unknown/date-only precision never receives an invented instant. Even declared exact instants do not enable historical replay, because this pure helper cannot independently attest knowledge or receipt. `checked_at_ms` is a caller-supplied review reference, not an engine receipt or trusted acquisition proof.

The canonical hash covers the entire unchanged draft body, including decimal lexical precision, and excludes review execution time. No input digest is accepted or repaired. The output always says REVIEW_REQUIRED, NOT_RECORDED approval/receipt, UNSUPPORTED_BY_LEGACY_CONSUMER and NOT_WATCH_READY. It preserves expired/review-due status. Declared source access is never independent verification; text and URLs are inert input. Extra authority/private fields, invalid links, numeric coercion, ambiguous precision, unsafe URLs and oversized/accessor inputs reject. Validation cannot prove free text contains no private information or that source statements are true; those remain explicit manual review requirements.

Next implementation: an explicit local conversion manifest for a concrete research input, recording field mappings, unsupported claims and provenance without changing the original or creating approval. Operational adapters/receipt/approval/storage/Watch remain separate and unconnected.
