# Candidate market corrections

- branch: feature/m2-market-corrections-20261019; review-only until a separate rollout decision.
- base: feature/m2-operational-storage at6ef8dfcdba2af7148a085c8026100d3ac184b2bf.
- origin: corrected public source from integrationdd75510f6d02aa3c5ca3625ae41d1f70eee10138; research integration continues independently onfeature/research-handoff.
- scope: saved consumer/Feature cutoffs, scheduled/historical quality propagation and explicit current-sample realized volatility. No new API, engine or schema version.
- verification: exact136-file base materialization; isolated full326/326 PASS,0fail/skip/cancelled. Separate from integration462/462 and sourceCI39205782937. Receipt: validation/m2-market-corrections-local-20261019.json.
- runtime: no rollout/provider success asserted. Existing Feature write opt-in remains false; Secrets/bindings/configuration are not changed by this source proposal.
- NEXT_EXACT_STEP: obtain one explicit approval for this bounded candidate PR to enter the existing M2 feature branch, which can start its two existing candidate Builds and enabled read-only checks. Recheck exact head/base, successful CI and unchanged candidate-only trigger targets first. Do not merge researchPR6/main or enable disabled verification, Access, writes, Secrets or Watch as part of this decision.
