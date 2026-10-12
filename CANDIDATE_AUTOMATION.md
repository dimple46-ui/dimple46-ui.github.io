# Candidate automation — staged activation

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

`.github/workflows/candidate-check.yml` runs synthetic local tests on the M2 branch. Remote checks
are disabled unless repository variable `CANDIDATE_CHECKS_ENABLED=true`. Disabled checks are **not**
remote PASS. Existing `test.yml` remains the full regression gate. The remote job uses existing
secret names `CLOUDFLARE_API_TOKEN`, `INTELLIGENCE_READ_TOKEN`, `VALIDATION_TOKEN` and existing
variable or Secret `CLOUDFLARE_ACCOUNT_ID`; `INTELLIGENCE_DEPLOYED_SHA` is a non-secret expected SHA.
Do not enable it until these values' presence and intended scope are verified. Worker-held secrets
are not automatically GitHub Secrets and cannot be recovered by reading their metadata.
`workflow_dispatch` may require the workflow to exist on the default branch; the branch push
trigger is provided without requiring or authorizing a main merge.

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
automated sign-in stopped. Candidate build-token inspection therefore still needs user-side access.

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
