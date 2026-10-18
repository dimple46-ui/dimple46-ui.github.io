# General research admission — bounded compatibility review

Status: design reviewed; decimal preparation primitive locally tested only. No new package receiver or schema v2 is active.

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

Next implementation: a closed, local-only general research DRAFT schema/validator with explicit unsupported-consumer status. It must not modify operational receipt, approval, storage, Watch or deployment paths.
