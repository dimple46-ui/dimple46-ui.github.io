# Single-request candidate storage trial

This optional local Mac tool exercises the existing candidate POST/readback contract. It does
not deploy Worker code or change any schema. Actual execution needs separate approval for the
temporary candidate write flag, at most one immutable shared-D1 row, and local in-memory use
of the existing credentials. A CLI switch records operator intent; it is not research approval
or an authenticated approval service.

`node scripts/trial-feature-storage.mjs --plan` is the default: it performs no network or
credential access. No login, credential extraction, live POST, or settings change is part of
local tests or CI. The runtime engine expected by the trial remains the previously validated
handler revision, independent of this local-tool commit.

## Approved execution only

Run from the reviewed source tree, in one Mac terminal, with no competing candidate writer
or configuration change. Do not copy the command from an unreviewed branch or use a different
candidate. Node 24 is supported; Wrangler is pinned to 4.151.2.

```
node scripts/trial-feature-storage.mjs --execute --approved-one-feature-row
```

The tool prompts for the existing candidate validation token with terminal echo disabled.
This input does not enter shell history or a child process. It reads the existing Wrangler OAuth
credential through the documented `auth token --json` command with child output captured into
memory, forcing the keychain backend. It rejects configured API-token/key alternatives and
non-OAuth output. It does not print tokens or write them to a file, GitHub, a Secret or another
service. OAuth may refresh through the existing approved login; no new login or scope is added.
OAuth is sent only to the fixed Cloudflare management API for the fixed candidate. The candidate
credential is sent only to that candidate's HTTPS origin. Redirects are rejected.

The sequence reads current candidate settings, requires the expected engine SHA, database
binding, and disabled flag, then performs an authenticated read-only replay. It rechecks settings,
patches only the write flag while inheriting unrelated bindings, confirms enable, makes exactly
one POST, and validates the POST's immutable stored-row readback. Finally it sets the flag false
using current settings and separately reads it back. Ctrl+C/SIGTERM request cancellation of the
work phase; restoration uses independent request timeouts. No automatic POST retry occurs.

A partial PATCH response is not readback evidence. A successful flag readback proves the
control-plane setting is false; it does not prove global runtime propagation or an independently
tested 403. A second POST is deliberately excluded. There is no server-side one-shot lease or
lock: the one-request/one-row limit applies to this process, not other authorized callers while
the flag is enabled. Run only in an exclusive controlled window.

## Evidence and limits

- `INSERTED` requires exactly one insertion and the expected engine/core identities.
- `EXISTS` preserves the older immutable row and is not evidence of a newly inserted row.
- Unknown write counts remain unknown. A network failure after POST is ambiguous; do not retry.
- This validates persistence only. Current POST uses the current cutoff and cannot be redirected
  to a historical replay. Closed/stale observations retain their original quality and cannot
  establish live-market freshness, continuous persistence, or Watch integration.
- There is no independent D1-admin query here. The stored-row proof is the existing handler's
  verification SELECT returned in the POST response.
- The core hash is not an attestation of the complete deployed Worker. Management deployment
  evidence is recorded separately; the trial checks reported identities and contract consistency.
- Keep the result in the existing private operational checkpoint; no tokens or raw responses in
  public issues, commits, logs or artifacts. Ordinary CI uses fictional transport responses only.

## Recovery

Power loss, SIGKILL, suspended execution or loss of connectivity can prevent the `finally`
restore. Exit code 2 / `RECOVERY_REQUIRED` means the disabled state is not established. Even a
failed enable response may have applied remotely. Stop other work and recover the candidate
flag; do not repeat the storage request. Once connectivity and approved management access are
available, the same reviewed tool can perform only disable and setting readback:

```
node scripts/trial-feature-storage.mjs --disable-only --approved-candidate-recovery
```

This mode does not request the candidate token, enable writes, or send any candidate POST. It
uses the same OAuth/keychain path and preserves unrelated bindings. A failed recovery is reported
as unresolved, never as successful rollback. It does not roll back Worker code or delete rows.

The trial excludes Production relay changes, main merge, research admission, personal financial
input, Secrets/permissions, Access/payment, and existing Watch/BMW/schedules.

Official credential behavior:
https://developers.cloudflare.com/workers/wrangler/commands/general/#auth-token
