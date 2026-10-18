# Local decision evidence and price follow-up

Implemented on `feature/research-handoff`; local files only, not deployed or connected to Watch.
These helpers extend the existing two-stock pair summary. They never receive or approve research
packages, call a fixture authorizer, change Feature/Signal calculations or execute an order.

## Snapshot journal

`domain/research-decision-journal.mjs` validates the pair and both child hashes using the existing
pair display boundary, detaches/freezes the original summary and links each entry to the prior hash.
Generation time and caller-declared recording time are separate. History selection requires the
recording time to be known by the requested as-of; a late-captured summary is never backdated.
Existing stale-display suppression and unapproved/missing research states remain intact.

An exact retry of entry ID/time/content is idempotent. A changed receipt under the same ID, repeated
decision under a new ID, reordered/broken chain, decreasing receipt time, future summary, unsupported
shape or modified child is rejected. Bounds: 128 entries, 4 MiB compact journal JSON, depth32 and
200000 traversal nodes; existing per-pair/canonical-hash limits also apply and may reject sooner.

Hash agreement is not authentication, user approval, trusted timestamping or origin verification.
The journal preserves an already-produced local historical context; approval is NOT_REEVALUATED.
A caller can replace/recompute an entire chain or remove its suffix. Filesystem owners can edit files.
This is not tamper-proof, externally anchored, transactional multi-writer or private durable storage.
It does not restore an authenticated approval session or propagate revocations after restart.

## Post-record price observations

`domain/research-price-followup.mjs` binds each separate immutable record to the exact snapshot entry
hash and pair decision ID. Baseline observation must be at/after recording; the later endpoint must
follow the baseline, with baseline availability no later than the later observation. Both endpoint
availability times must be no later than the follow-up receipt. Original reasoning remains untouched.

Each endpoint has exactly these fields:

| Field | Required value |
| --- | --- |
| ticker | Same `005930` or `000660` as the requested follow-up |
| market / currency / venue | `KRX` / `KRW` / `KRX_REGULAR` |
| price_basis | `UNADJUSTED` |
| price_krw | Positive safe integer; null/zero/nonfinite rejected |
| observed_at_ms / available_at_ms | Positive supported epoch milliseconds; observation ≤ availability ≤ receipt |
| source_id | Same explicit safe ID at both endpoints |
| source_sha256 | Declared lowercase64hex source-capture reference at each endpoint |

The function reports raw price delta and percentage only. This interval is explicitly post-hoc;
it is not a preregistered forecast horizon. Source timestamps/prices/capture hashes are caller
assertions, not fetched or independently verified here. Trading-calendar/session authenticity and
corporate actions are not verified. Splits/dividends can make raw price changes misleading; total
return, portfolio return, forecast accuracy, suitability and user-action outcome remain null/unrecorded.
Descriptive supportive/adverse signals are never converted into successful/failed price predictions.
Follow-up append rejects duplicate conflicts and supports receipt-time as-of selection.

## Explicit offline CLI

```sh
# Create a NEW evidence document; '-' means no prior evidence document.
node scripts/record-research-evidence.mjs snapshot /private/pair.json - receipt:1 1792148401000 /private/evidence-v1.json
# Add a follow-up to a NEW document, preserving the original.
node scripts/record-research-evidence.mjs followup /private/followup-request.json /private/evidence-v1.json /private/evidence-v2.json
# Print only bounded historical display and price-change projections, at an explicit as-of/age limit.
node scripts/record-research-evidence.mjs history /private/evidence-v2.json 1792148407000 5000
```

All timestamps above are fictional. Follow-up request fields: `followupId`, `snapshotEntryId`,
`ticker`, `baseline`, `followup`, `recordedAtMs`. Endpoints use the table above.
Envelope fields: `schema_version:1`, `journal`, `price_followups`.
Input files must be bounded regular files; final-component symlinks are rejected. The CLI uses
exclusive new-file creation with mode0600 and fsync; existing outputs/aliases are never overwritten.
Interrupted/failed writes can leave an incomplete new file; validation rejects it. Parent directories,
backups, encryption, authentication, transactional concurrency and crash recovery are caller responsibilities.
Pretty-printed evidence documents have an additional 4.5MiB output cap. No network or SQL is used.
Write output is sanitized counts/status only; history omits report prose/URLs/private payloads.
Errors expose one fixed code without input values, paths or stack traces.

Public repository examples/tests must remain fictional. Actual financial intake and operational
approval/storage remain blocked by the existing Access/private-management gates; this local feature
does not bypass them. No provider configuration, automatic schedule, notification or order is connected.

Validation: 11 new tests; final full418/418 local PASS. Source hashes and exact code commit are recorded
in `validation/research-decision-evidence-local-20261018.json`. Remote CI/deployment are separate.
