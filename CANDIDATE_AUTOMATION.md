# Candidate automation — staged activation

## Latest result (2026-10-13)

After the user saved a new build token, Work triggered the existing branch integration with
documentation commit `c6cc50c69f6cf5d6e793c407aeab12d034f0a35e`. GitHub CI `38325024034` and
Cloudflare Build `78d97dcd-c63d-4499-9599-11fc3f3cb773` both succeeded at that exact commit.
No duplicate deployer or runtime/config change was introduced. The pre-upload test gate remains enabled.
Authenticated `/health` supplied at 2026-10-13 09:09:27.598 KST confirms this exact SHA,
Feature version 2 and zero writes in all four query metadata entries. This is DEPLOYED_HEALTH_VALIDATED,
not full route/live validation. Provider deployment ID/tag remain null and its timestamp is a sentinel.
Stored v2 remains the stale 2026-10-07 run; continuous v2 persistence is not enabled.
Existing endpoint tokens are not available in Work.

## Existing Cloudflare Builds reused (2026-10-12)

User-provided candidate Settings screenshot and complete deploy command confirm:

- repository `dimple46-ui/dimple46-ui.github.io`, branch `feature/m2-operational-storage`
- Disable builds OFF, root `/`, watch include `*`, separate build command empty
- existing deploy command:

```sh
npx wrangler deploy --config wrangler.intelligence-candidate.example.toml --var INTELLIGENCE_QUERY_TIMEOUT_MS:5000 --var INTELLIGENCE_RATE_LIMIT_PER_MINUTE:60 --var INTELLIGENCE_WORKER_GIT_SHA:$WORKERS_CI_COMMIT_SHA
```

The candidate-only Wrangler file now includes `[build] command = "node --test tests/*.test.mjs"`.
The existing command therefore runs the regression suite before upload. This avoids racing GitHub
CI completion with an unchecked Cloudflare deployment; it does not install a second deployer.
Local regression: 72/72 PASS. Code/config commit: `7a7ea50db1d7be701422275f07c817d213ccc090`.
No Worker target, binding, Secret, route or runtime source is changed by this config patch.
GitHub Tests run `38255370075` succeeded. Cloudflare Build
`1417e3bb-f29b-4600-aca2-004612cea6a7` failed at that same commit; GitHub check `114832470208`
provides no error text or annotations. The subsequent user screenshot identifies a stale build-token
error before repository cloning: the provider reports its selected token was deleted or rolled.
The test gate/deploy command was not reached. This is BUILD_FAILED, not DEPLOYED_VALIDATED.
Inspect existing candidate Build Configuration > API token choices before repairing the link;
do not confuse this build credential with the runtime `INTELLIGENCE_READ_TOKEN` Secret.
Reference: https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/#stale-api-token

Configuration evidence is not a successful build or authenticated deployment receipt. Work still
cannot perform authenticated post-deploy checks without the existing endpoint credential being
available in an approved executor. Worker runtime Secrets are not automatically build-time Secrets.
Never extract or print them. The deploy command remains unpinned as currently configured; a
Wrangler version pin and rollback activation remain follow-up work after provider build evidence.
The separate feature validator is not deployed by this intelligence configuration.

Reference: https://developers.cloudflare.com/workers/wrangler/custom-builds/

## Implemented, not deployment-validated

`scripts/check-candidate.mjs` performs bounded GET-only authenticated smoke checks on the two
existing, hard-coded candidate origins. It checks no/wrong token rejection, runtime-reported
intelligence SHA, Feature version, cutoff, honest freshness, quality preservation, bounded history,
invalid parameters and zero D1 writes. Validator mode checks the relay source SHA-256 and reuses
the existing historical Signal validator. It does not claim a validator runtime commit from a source
hash, nor claim predictive/live validation from successful replay. No POST write probe is sent.

`scripts/audit-candidate-access.mjs` only GETs settings for the two existing candidate Workers.
It reports Secret names/presence, never their values, and only proves read access. It does not
prove deployment permission. Unknown/missing credentials fail closed. API rejection is not retried
with broader authority. Production is not an allowed target.

`.github/workflows/candidate-check.yml` keeps independent opt-in jobs:

| Job | Repository variable | Credential |
| --- | --- | --- |
| Intelligence smoke | `CANDIDATE_CHECKS_ENABLED=true` | Existing `INTELLIGENCE_READ_TOKEN` GitHub Secret |
| Validator replay | `VALIDATOR_CHECKS_ENABLED=true` | Existing `VALIDATION_TOKEN` GitHub Secret |
| Provider settings audit | `CANDIDATE_ACCESS_AUDIT_ENABLED=true` | Existing `CLOUDFLARE_API_TOKEN` and account ID |

Intelligence smoke no longer depends on Cloudflare management access or validator credentials.
On a branch push, `scripts/wait-candidate-build.mjs` uses the built-in read-only GitHub token to wait
at most four minutes for the exact push SHA's existing Cloudflare check. Check name, provider app
identity and SHA must match; the newest matching check must succeed. Failure, skipped check,
403 or timeout cannot reuse an older successful build. Only then is authenticated smoke run against
the same expected SHA. No second deployer is introduced. Non-secret receipts are retained for seven
days as Actions artifacts. A failed smoke records failure; automatic rollback is not activated.

Local automation tests: 14/14 PASS; integration regression: 79/79 PASS. This workflow change is
TESTED_NOT_ACTIVATED. Remote credential existence and flags remain UNVERIFIED; disabled jobs are
NOT_EXECUTED, not PASS. Do not enable a job until its existing credential availability is verified.
Cloudflare runtime Secrets and GitHub Actions Secrets are separate stores; metadata does not reveal
or transfer their values. The immediate next step is to check only whether the GitHub repository
Secret name `INTELLIGENCE_READ_TOKEN` exists. No new token is requested.

Existing `test.yml` and the Cloudflare pre-upload full-suite gate remain intact. `workflow_dispatch`
requires default-branch availability; the branch push trigger avoids a main merge dependency.
Manual dispatch uses `INTELLIGENCE_DEPLOYED_SHA`; push validation always uses `github.sha`.
This checkpoint uses `[skip ci]` to avoid redeploying an unchanged intelligence Worker. No remote
validation success or deployment is claimed for the new automation commit.

## Direct-access blocker

On 2026-10-12 the Work execution environment had no Cloudflare token/account ID or GitHub CLI token.
The GitHub connector does not expose Secrets endpoints. The cloud browser showed Cloudflare's
sign-in page, not an authenticated account. GitHub Secret existence and actual Cloudflare settings
remain `NEEDS_EXTERNAL_VERIFICATION`, not absent. Do not create another Worker, binding or token.
The existing intelligence Builds branch/command was subsequently confirmed as documented above.
Its configured deployment path can be triggered through GitHub without placing a new Cloudflare
token in Work. Direct settings inspection and authenticated API checks still require access.
Feature validator deployment is still pending.

On 2026-10-13, credential presence remained unchanged. A secure Cloudflare browser login was
attempted, but the site returned HTTP 403 for its login API. No authenticated session was verified;
automated sign-in stopped. Direct provider-settings access remains blocked. The build-token repair and successful deployment
were subsequently verified above; do not repeat that repair.

## Additional deployment controls (not activated)

Reuse the confirmed Cloudflare Builds path; do not add a competing Wrangler job.
After authenticated inspection, pin Wrangler (previous registry version observed: 4.149.0), verify
the exact tested commit, and rebuild the generated validator using the existing build script.
The hand-edited generated file must not be accepted as source identity without regeneration.
Inspect actual settings before adopting the example Wrangler config as authoritative. Preserve
existing Secrets and bindings; do not assume `--keep-vars` preserves all non-variable settings.

Use only required candidate Worker editing access, scoped to the selected Workers where available.
Do not request account administration, production Worker edit, or D1 edit merely to deploy/read a
bound Worker. A D1 binding exposes database operations: it is **not** a SELECT-only ACL. The
intelligence handler's fixed SELECT allowlist and GET-only routing enforce application-level read-only
behavior. The feature validator has an opt-in write route; keep its write flag disabled and verify
that fact from settings before deployment. Do not describe that Worker as incapable of writes.

For deployment: record the active provider version; reject unexpected bindings or split traffic;
serialize deployers; upload a version, verify identity/settings, then activate candidate traffic.
Run these smoke checks after activation. On failure mark FAILED, not DEPLOYED_VALIDATED. Restore
the exact previous candidate version only if no intervening deployment has occurred and its bindings
are still valid. Recheck after restoration. Rollback does not restore D1 data. Never blindly roll back
"previous" if another build has run. Missing deployment identity is a blocker, not a placeholder ID.

## Intentionally excluded

- No deployment, Secret provisioning, production routing or migration command in this workflow.
- Shared `market-history` migrations require separate reviewed handling; candidate deploy credentials
  must not silently gain migration authority. Existing migrations/tables must not be reapplied.
- No production-equivalence, CPU, memory or provider rate-limit enforcement claim from synthetic tests.
- No change to `WAITING_FOR_LIVE_MARKET_VALIDATION` or stale stored Feature v2 quality.

Official references:
- https://developers.cloudflare.com/workers/authorization/workers/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1/


## Validator Builds preparation — 2026-10-13 14:28 KST

User confirms FEATURE_V2_WRITE_ENABLED=false. Screenshot shows a repository-connection dialog
with main/default `npx wrangler deploy`, not a completed Git link; instructed Cancel, user acknowledged.
GitHub CLOUDFLARE_API_TOKEN is absent per user. Do not request token recreation or use intelligence
credentials to manage provider settings.

Prepared `wrangler.feature-validation.example.toml`: fixed existing validator target, generated entry,
write flag false, existing market-history database ID, full pre-upload tests. TOML parsed and safety
fields checked locally. NOT_DEPLOYED; this template is not proof of current bindings/runtime date.
Next inspect actual MARKET_HISTORY binding and additional bindings; compare compatibility date before
using the template. Do not connect with main or the generic deploy command. Existing provider Secret
VALIDATION_TOKEN is never copied into source. keep_vars preserves Dashboard variables, not arbitrary
bindings; do not claim it prevents all configuration changes.

After those checks, use the existing Worker Git integration (one deployer per Worker), branch
feature/m2-operational-storage, root /, candidate-specific configuration. Planned command, NOT YET
AUTHORIZED TO RUN BEFORE PREFLIGHT: `npx wrangler deploy --config wrangler.feature-validation.example.toml`.
The write flag remains false; no FEATURE_ENGINE_GIT_SHA override is needed for read-only replay.
Reusing the existing test gate also checks validator source hash. Successful upload must still be
followed by authenticated read-only replay1791778965346 and zero-write evidence. Workflow validator
checks remain disabled until existing VALIDATION_TOKEN is available in its GitHub Secret store.
Reference: https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth


## Summary-aware validation — 2026-10-16T14:10:07.772888+09:00

Existing check-candidate.mjs now performs no-token/wrong-token rejection and one authenticated bounded GET /summary after the existing health/state/features checks. It checks exact runtime-reported SHA, source release3/API1/Feature2, explicit cutoff/age policy, independent Feature freshness, quality code allowlist and unavailable private capabilities. Receipts include only selected metadata, no source payload/token/private scenario. Runtime SHA remains reported identity, not independent provider code attestation.

Both observation and Feature query telemetry must explicitly report rowsWritten0 and finite rowsRead; missing/null telemetry never becomes a0-write PASS. Stale Feature may correctly be UNAVAILABLE with successful reads. Missing/corrupt/read-failed Feature is a supported partial handler response, but cannot satisfy strict remote validation when query metadata is missing; failures remain failures, not deployment success. The existing standalone /features check also still requires a stored row.

Existing workflow/build/credential/artifact path reused. New public modules/summary tests are included in watch paths, local-checks adds the new checker tests. Validator and management-provider jobs require workflow_dispatch plus existing opt-in flags, so candidate push cannot retry those blocked external paths. No flags, Secrets, bindings, account access or competing deployer added. One variable-readback attempt was unavailable; no credentials/values read or repeated request.

Local evidence: checker/actual-handler targeted17/17 PASS; full154/154 PASS; final workflow-gate targeted22/22 PASS. Mocked/local evidence only. This meaningful code commit intentionally allows the existing isolated candidate Builds and CI path to run once. Build started/success and authenticated runtime outcome remain pending until actual checks/artifact prove them. Production is excluded.
