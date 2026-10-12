# Candidate automation — staged activation

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

## Current blocker

On 2026-10-12 the Work execution environment had no Cloudflare token/account ID or GitHub CLI token.
The GitHub connector does not expose Secrets endpoints. The cloud browser showed Cloudflare's
sign-in page, not an authenticated account. GitHub Secret existence and actual Cloudflare settings
remain `NEEDS_EXTERNAL_VERIFICATION`, not absent. Authentication is the next step; do not create
another Worker, binding or token. Existing intelligence Cloudflare Builds must be inspected and reused,
not raced by a second deployer. Feature validator deployment is still pending.

## Deployment activation gate (not implemented/executed yet)

After authenticated inspection, reuse Cloudflare Builds or add a candidate-only Wrangler job,
whichever preserves the existing setup. Pin Wrangler (registry version observed: 4.149.0), verify
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
