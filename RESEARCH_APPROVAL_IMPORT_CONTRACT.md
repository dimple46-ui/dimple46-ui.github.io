# Research approval import — bounded local staging contract

Status: CODE_IMPLEMENTED / LOCAL_TESTED, synthetic only. No real identity, persistent store,
engine approval adapter, endpoint or Watch connection is implemented. This module prepares
and checks metadata; it cannot authorize analysis, orders, deployment or portfolio limits.

## Existing implementation reused

- `canonicalJson`, `opaqueId`, timestamps, owner/authorization/policy/restore scope checks from
  `private/storage-contract.mjs`.
- `validateResearchPackage` and canonical hashes from `domain/research-handoff.mjs`.
- Existing `createResearchHandoffSession` is unchanged and remains ephemeral. Its requirement
  that approval time follow engine package receipt is preserved.
- `private/transaction-store.mjs` already defines synchronous transaction, expected revision,
  idempotent request receipt, sealed state/version and outbox patterns. Any later persistence
  adapter must reuse those boundaries; no new production schema/store is created here.

## Trust and time model

`createResearchApprovalImportPlanner({clock,resolveDecision})` has no default resolver.
`resolveDecision` is installed by trusted application code, never supplied in a research body,
query parameter or uploaded conversation record. It must authenticate an actual decision source,
check the USER_APPROVER role and exact owner/authorization/policy/restore epochs, and retrieve the
exact package ID/revision/digest/decision/receipt. `expectedScope` comes from that trusted server
context, not from the submitting client. A schema-valid object with `verified:true` is not proof
unless this dependency has done its job. Tests use an explicitly fictional resolver.

Three times are retained: original user decision, original source recording and local import.
Decision must not predate package generation; decision <= source recording <= import. Future
input, asynchronous clock rollback and a review deadline crossed during lookup fail closed.
New approvals are blocked once review/expiry is due. Withdrawal may still be staged afterwards.
Source acquisition time remains the separately declared/verified research property.

A conversation approval file can preserve human content approval, but it is not an authenticated
resolver result. This module does not load conversation records or mint USER_APPROVER proofs
from them. A future source adapter must corroborate provenance before engine admission.

An approval received before a new engine session cannot be backdated into that session or have
its original decision time overwritten to satisfy `decide()`. The eventual activation/recovery
contract must retain both the original content approval and the actual engine recording event.
Until that contract and authenticated persistence are validated, imported plans remain
`STAGING_ONLY_NOT_ENGINE_APPROVAL` and cannot be passed off as engine grants.

## Journal proposal and recovery

`proposeApprovalImportAppend` returns an immutable proposal, never a database commit.
The bounded 128-event journal preserves prior events. Receipt reuse with identical source proof
and binding returns DUPLICATE_NO_APPEND even if a retry's local import timestamp differs.
Conflicting receipt reuse, same package/revision with changed digest, older source decisions and
reactivation after withdrawal of the same revision fail. A new revision needs its own approval.

`inspectApprovalImportJournal` checks sequence, predecessor hashes, plan hashes, scope, monotone
import times and an expected tail anchor. The anchor must come from trusted storage independent
of the journal bytes; accepting both from an uploaded file defeats truncation detection.
Hash chains detect inconsistency against that anchor, not user identity, authority or origin.
Changing the entire chain and its client-provided anchor is not cryptographic authentication.

As-of visibility uses local import time. An old source approval is never treated as known before
actual local import. JSON serialization/reload tests check deterministic history and withdrawal
retention; they are not evidence of durable provider storage or crash recovery.

## Required persistence/engine gates — NOT IMPLEMENTED

1. Authenticate owner/role/epochs and decision source independently of package contents.
2. Load the verified journal plus trusted anchor from sealed private storage under one snapshot.
3. Build the proposal locally. Commit event, idempotency receipt, sealed state and new anchor in
   one existing transaction with expected revision/head checked inside that transaction.
4. On stale head reload once only when inputs actually changed; never append a competing old
   proposal. On unknown write outcome read/replay the same request/receipt; do not mint a new ID.
5. Test fail-before-commit, failure between event/head writes, response loss, concurrent withdrawal,
   restore-epoch changes and restart rollback against actual atomic storage.
6. Connect engine selection only after authenticated commit/read-back and the explicit activation
   time contract. Imported content approval alone does not enable Feature freshness, private risk,
   Watch output or notification.

No actual credentials/resources/SQL migration are needed for this local unit. Real persistence,
identity source connection, private data intake and production/main changes retain their existing
approval gates. Public approval metadata writes remain blocked pending explicit disclosure scope.

## Local validation and next gate

Run `node --test tests/research-approval-import.test.mjs` from the existing source checkout.
No network, provider or actual approval file is used. The separate
`tests/research-approval-storage-protocol.test.mjs` reuses the existing transaction store in an
isolated memory SQLite DB. Its marker codec is a synthetic double, not encryption. It verifies
rollback after version/head/receipt writes, idempotent response-loss replay and a competing
withdrawal's expected-revision conflict. Recreating a store handle on that same fixture is not
process/provider restart proof. No operational storage adapter is exported by those tests.

Next gate: review and implement an authenticated source resolver and durable private adapter
only when an approved identity/storage context is available. Provider crash/restart, actual
sealed-state recovery and restore-epoch rollback remain unverified. Keep real approval files
outside synthetic tests and public source/CI. No pending user approval may be fabricated.
