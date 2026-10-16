# Local consumer/asset comparison integration

Status: implemented/local validated only. Not deployed or connected to accounts, storage, scheduled tasks or a public result endpoint.

`domain/local-consumer-workflow.mjs` uses the existing consumer/fallback and alternative-comparison helpers; the latter uses the asset-ledger contract. Public market and explicitly supplied private fictional comparison inputs are separate.

- buildPublicConsumerSummary accepts market inputs only. It emits a fixed metadata/capability projection: source, cutoff, age, pipeline enum, separate Feature age/cutoff/quality and unavailable private services. It never copies arbitrary raw quality/error/description strings, market payloads or private results. Observation age is not proof of source freshness.
- runLocalConsumerWorkflow returns a PRIVATE_COMBINED_RESULT_DO_NOT_PUBLISH object. Only its publicResult projection is eligible for a future public consumer. The combined object and privateResult must never be sent to public GitHub, endpoints, CI logs or artifacts.
- Private calculation defaults to disabled and requires explicit boolean opt-in and separate input/policy. It does not convert market fallback prices into verified private-ledger quotes. Private failure returns a generic code without exception text and leaves publicResult unchanged.
- GitHub price/volume fallback remains PARTIAL; Feature/Signal/portfolio/decision remain UNAVAILABLE publicly, even if an independent fictional private comparison calculates successfully. This deliberately does not assert operational portfolio service readiness.

Tests use fictional round numbers and PRIVATE_SENTINEL markers to detect leakage. They exercise fallback→ledger→comparison, public independence from private changes/errors, arbitrary raw-string exclusion, separate old Feature cutoff/age, explicit opt-in and absent private-price failure. No actual personal input/output is stored.

Validation: new targeted4/4 PASS; accumulated full regression132/132 PASS with0 failures/skips. Before execution43 existing source/test/schema blobs matched parent 9377e6379e5f71ea1e8594cb0057110660fc8646; two added integration files are identified by SHA256 in validation/local-regression-20261016-workflow.json. This is local/synthetic integration evidence, not an authenticated D1/Worker/scheduled execution or live-market result.

Still unavailable: a runtime path executing this helper, private storage/account integration, scheduler credentials/result delivery and an operational decision engine. The existing candidate endpoint and public snapshot still provide only their existing data; this file does not add endpoints. No scheduling or deployment changes are authorized by these tests.


## Public-module extraction — 2026-10-16T13:58:57.531951+09:00

Public projection now lives in cloudflare/public-consumer-summary.mjs and depends only on cloudflare/consumer-fallback.mjs. The local CLI imports this public-only path. domain/local-consumer-workflow.mjs retains the exact buildPublicConsumerSummary export as a compatibility re-export, alongside its private workflow. Private-domain dependency remains solely on that private combined entry; it must not be used as a public Worker entry.

No schema, status, quality, selection or numeric semantics changed. Saved-input public output and existing callers remain compatible. The native Node module linker inspects static/re-export/transitive dependencies of public summary and CLI; the test permits only the exact public module pair and CLI's fs/url builtins, rejects dynamic loading/eval/require/Function, and never evaluates the CLI in the linker audit. This is a repository dependency guard, not a universal JavaScript sandbox.

Validation: related15/15 PASS, full143/143 PASS,0 failures/skips. New public module SHA256 39203ad45a2effa19625ca6ea44deea21043afe2c5fff20cdc75b239d8ae7a12; parent 2dbc2363b63cb2cfb094335c1108b19e70436567; remaining changed-file hashes in validation/local-regression-20261016-public-split.json. Synthetic/local evidence only, no new public capture or authenticated runtime check. No new endpoint or deployment in this task.
