# Closed private provider candidate

Status: source preparation only. This is not private intake, operational research approval,
provider durability evidence or an enabled service.

`private/cloudflare-candidate.mjs` exports the `PrivateRiskStore` Durable Object and a
Worker entry. Both fetch handlers return an empty, non-cacheable404 for every request.
The Worker never resolves a namespace or instantiates an actor. The actor keeps its
transaction store in a JavaScript private field and exposes no storage/bootstrap/SQL/RPC
method. No credential, request body, key, owner, policy or input is interpreted.

`private/durable-transaction-store.mjs` binds the platform SQLite cursor and synchronous
transaction methods to the existing fixed-SQL transaction store. Construction performs
no SQL, DDL, owner/head creation, key/nonce registration or restore transition. Existing
scope/revision/idempotency and frozen-state checks remain in the reused store.

The candidate example TOML declares a SQLite class migration and one candidate binding.
It has no D1, route, Cron, sender, credential or Secret configuration; workers.dev and
preview ingress are disabled. This source change does not modify existing deployment
commands. External Build selection/watch paths are not established by local checks.
Applying the template is a remote namespace/migration/binding/configuration operation,
not a local test. Verify target existence, current migration tag, account capabilities,
cost and the applicable authorization before applying it. Do not repurpose a public
Build with private credentials. Do not delete a created namespace as an assumed rollback.

Local checks use Node SQLite and a minimal `cloudflare:workers` base-class double in the
test process only. They verify receiver binding, transaction rollback/replay, no implicit
initialization and closed ingress. They do not verify actual Cloudflare module loading,
RPC access, transaction/crash/restore behavior, schema/bootstrap, rate limits or routing.
Cloudflare runtime validation remains required; no fixture authorizer or codec is used
by the candidate entry.

Next provider gates remain explicit: reviewed owner/schema bootstrap, independent trusted
identity/decision source, durable nonce authority, key custody and restore epochs, admission
and persisted activation/receipt readback. Access deferral, real input/approval and delivery
boundaries in existing contracts remain in force. This entry must stay closed until those
separate gates are satisfied.

References: [SQLite storage/transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[DO base class](https://developers.cloudflare.com/durable-objects/api/base/),
[SQLite class migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).
