# Private asset-ledger contract — local prototype

## Optional life-goal cash funding — schema1

`domain/life-goal-funding.mjs` connects a declared `goalPlan` to the existing ledger and dated-cash schedule. `buildPrivateRiskSummary` / `runPrivateRiskWorkflow` accept it as an optional input. The first supported funding source is **current declared withdrawable KRW cash only**. No future salary, asset sale, account transfer, borrowing, return, inflation or tax assumption is introduced. A life goal is not an operating approval or an approved asset-allocation policy.

The strict schema is:

| Object | Required fields |
| --- | --- |
| goalPlan | schemaVersion=1, positive revision, currency=KRW, ledgerAsOfMs, sourceRef, verifiedAtMs, coverageComplete=true, accounts, goals, allocations |
| accounts[] | accountRef, protectedCashKrw |
| goals[] | goalRef, positive revision, purpose, amountKrw, amountAsOfMs, dueAtMs, essential, priority, deferrable |
| allocations[] | allocationRef, goalRef, accountRef, amountKrw, obligationRef |

IDs are nonempty strings of at most128 UTF-16 code units. Amounts are nonnegative safe integer nominal KRW. Purpose is HOUSING, EDUCATION, RETIREMENT, FAMILY or OTHER. Unknown amount/deadline/essential/priority/deferrable must be explicit null; priority otherwise is a nonnegative safe integer. Priority/flexibility are retained as declared metadata, never used to choose allocations. Goal amount basis dates are not automatically restated for inflation. A declared timestamp must be a valid positive millisecond instant; amountAsOfMs must not exceed the ledger cutoff. A past deadline is explicitly overdue, not proof of timely funding.

The plan must name exactly the cash schedule's accounts and share the ledger cutoff. Plan verification is no later than that cutoff and obeys the caller's existing maxLedgerAgeMs. The existing cash validator independently verifies ledger/schedule scope, coverage, obligation identity/timing and reconciliation to additionalOutflowsKrw. Complete declared scope is not proof that the user supplied every real account or life goal. Bounds are32accounts,64goals,256allocations and262144bytes for the standalone combined input; the existing private transport request defaults to131072bytes (a trusted HTTP configuration may lower it). The16384 limit is per string, not the default whole request body.

Every declared OPEN obligation is protected, including after a goal's deadline. Per-account additional earmarks cannot exceed `withdrawable - all declared obligations - protectedCash`, floored at0. Accounts are not netted or automatically transferred. Protected cash is explicit for every account; if legacy reserveKrw is also supplied, its total must exactly reconcile to those amounts. A reserve is not deducted twice. The result's unallocatedCashKrw is a current-cash remainder, **not** trading or broker clearance.

Account rows also retain cashProtectionShortfallKrw: any gap between current withdrawable cash and all declared payments plus protected cash. A positive amount does not become zero because another account has surplus. A calculated goal snapshot is not an all-clear for those payments; independent cash timing stays visible, and the optional goal-aware alternative comparison blocks funding while any such protection shortfall remains.

An existing obligation may instead be linked once by obligationRef. Account, whole amount and deadline must exactly match the goal/allocation. It remains deducted by the cash schedule once; linking does not deduct it again. It cannot be called funded if all declared payments plus protected cash exceed that account's withdrawable cash. Partial/split obligation links and future funding sources are unsupported. Different allocation IDs do not create additional funding capacity; both per-goal and per-account bounds apply with exact BigInt sums.

Known goals return required/earmarked/shortfall amounts and the current ledger cutoff as availableAtMs for existing earmarked cash. This is not a settlement-calendar or actual withdrawal verification. Unknown target/deadline returns PARTIAL with null shortfall and unavailable complete goal aggregates. Invalid scope, stale metadata, unsupported currency, over-allocation or unsafe sums block only the goal component; valid independent cash-shortage calculations/events remain visible.

When goalPlan is present, legacy investableCash is always unavailable/null: that older formula does not subtract goal earmarks. Other valuation totals retain their original declared-asset meaning. No goal input preserves the former summary shape and behavior.

The existing schema1 private input request accepts the additive optional goalPlan field; old requests/envelopes remain readable. Older receivers reject that new field, so this is a coordinated receiver capability change, not silent cross-version compatibility. No research-package schema, authentication, encryption, database schema, event lifecycle or public market response changes. The existing encrypted input/provenance tag covers the goal plan, and atomic revision/idempotency storage is reused.

Direct local calculators still treat goal IDs/revisions as caller declarations and report CALLER_DECLARED_NOT_CONTENT_BOUND_OR_MONOTONICALLY_VERIFIED. The existing private input adapter additionally uses `private/goal-version-history.mjs` to bind material goal/plan content against the complete existing sealed revision lineage before admitting a goal calculation. No new journal, DB table, migration, key, identity, authorization grant or operating connection is introduced.

`readInputHistoryPage` reads revisions1..the captured head with fixed SQL, four rows per synchronous transaction. Every page rechecks owner/authorization/policy/restore scope, revision and head times. Missing/interleaved/out-of-range rows, inconsistent record times, mixed stored policy/restore epochs, oversized pages or unreadable ciphertext are not an empty or complete history. The validator opens both INPUT and ANALYSIS with the existing exact context, validates existing provenance/policy HMAC, and recomputes the original request tag to bind the decoded input. It validates stored contract/clock linkage without recalculating historical finances using the current clock. No old epoch/key context is guessed; private_versions lacks historical authorizationEpoch metadata, so old-auth ciphertext may be unverifiable and must block goal admission.

First support is bounded to128 prior revisions,2097152 encrypted bytes per page and8388608 total encrypted bytes. Exceeding a bound yields UNAVAILABLE, never a latest-only fallback or incomplete successful result. These are technical resource limits, not financial limits or a full-scale operating retention policy. Historical external rollback/fork detection, cross-epoch migration and unbounded incremental indexing remain unsupported; do not claim those guarantees from a local complete-lineage check.

Within that verified lineage, the same goalRef/revision must retain identical declared definition, including amount basis date, deadline and flexibility/priority fields. A plan revision binds sourceRef, currency, coverage, account protections, goals and allocations. Array order is normalized; ledgerAsOfMs/verifiedAtMs refresh alone is not a material goal-plan change. Increasing revisions may retain unchanged content, but prior plan/goal revisions cannot be restored. Explicit deletion via a newer plan and empty/removed goals retains the old goal identity: reappearance requires a newer goal revision. A goal input cannot supply the trusted history decision.

The resulting version-history decision is sealed inside the existing analysis envelope with the checked prior revision. ACCEPTED content is rechecked when later replaying history; authenticated REJECTED attempts never become version baselines. Legacy declared goal rows are checked as a complete sequence without rewriting them; inconsistent old declarations make the new guarantee unavailable. Omitting goalPlan after a previously accepted plan is not withdrawal or deletion and cannot silently release earmarks. It blocks the goal component and legacy investable cash, while valid independent cash calculations/events can still commit.

Successful internal admission reports CONTENT_CHECKED_IN_COMPLETE_STORED_LINEAGE; authorized saved aggregates retain that evidence and goalHistoryThroughRevision only from a consistent sealed internal decision. Old records/direct calculators remain declared-only. Stale reads suppress financial metrics while retaining historical evidence labels. Content checking is not actual user authentication, personal policy approval, external storage attestation, current account verification or runtime readiness. Goal-specific automatic alerts and actual user execution history remain unsupported. Evidence: `validation/goal-history-local-20261020.json`.

The authorized saved-analysis path exposes only fixed goal totals (planRevision, goalCount, requiredKrw, allocatedKrw, shortfallKrw, unallocatedCashKrw, earliestUnfundedDueAtMs), never raw goal/account/allocation IDs. It retains the stored cutoff and release provenance without recalculation; stale reads suppress goal metrics/capability. Inconsistent investment clearance or unsupported goal versions/scope/currency fail the read. Goal-specific automatic alerts, actual financial connections, external persistence/runtime authentication and Watch adoption are not established by local tests.

Evidence: `validation/life-goal-funding-local-20261020.json`. Fictional local request → workflow → sealed memory SQLite → authorized HTTP aggregate read/reconstructed reader/replay only; no operating deployment or actual personal finances.

Status: implemented/local validated with fictional fixtures only. No private storage, public API, scheduled consumer, account connection or deployment.

## Scope

`domain/asset-ledger-contract.mjs` accepts ledger schema1, KRW only, an explicit asOfMs, declared accounts and separate quotes. All totals cover only declared accounts; they do not attest that every account or asset has been supplied. Local input validation does not verify brokerage statements or authorize a trade.

Each account requires a nonempty accountRef/sourceRef, verifiedAtMs and explicit completeness flags for holdings/cash/debts/obligations. Holdings require six-digit ticker and integer nonnegative quantity. Cash requires both balanceKrw and withdrawableKrw; debts require principalKrw; additionalOutflowsKrw covers obligations not already reflected in withdrawable cash (avoid double counting). Explicit covered empty lists and measured0 are allowed; missing/null data never means0.

Quotes require positive integer priceKrw, KRW currency, VERIFIED quality, sourceRef and observedAtMs no later than ledger asOfMs. Separate caller-supplied ledger/price maximum ages apply against nowMs; stale/unverified/missing/future quotes block calculation. These policies are data-validation parameters, not approved portfolio thresholds.

## Distinct outputs

| Field | Meaning |
| --- | --- |
| securitiesValueKrw | Sum of declared quantity times validated price |
| grossAssetsKrw | Securities plus cash balance; excludes undeclared/property assets |
| debtPrincipalKrw | Declared debt principal; excludes unprovided accrued interest |
| netAssetsKrw | Gross assets minus declared principal; may be negative |
| withdrawableCashKrw | Explicit withdrawable amounts, independent of portfolio valuation |
| additionalOutflowsKrw | Additional cash obligations not already reflected in withdrawable cash |
| cashHeadroomAfterReserveKrw | Withdrawable minus additional outflows minus explicit reserve; signed |
| investableCashKrw | Nonnegative cash-only remainder; no sale proceeds/new borrowing assumed |
| cashShortfallKrw | Absolute amount of negative headroom, independently visible |

An explicit reserveKrw is required for the last three outputs. It is never defaulted from a remembered preference or invented cash floor. Missing reserve produces PARTIAL with null investable cash, while valid account totals remain available. Invalid/incomplete account inputs produce BLOCKED and all totals null, preventing misleading partial-account totals. Errors contain generic paths/codes, no raw input amounts. No logging/network/storage is performed.

## Privacy and remaining work

Never import this module into the public market Worker or place actual inputs/outputs in GitHub, CI logs or public artifacts. Tests contain fictional references and round-number values only. A new private storage/access connection requires separate approval.

Cost basis, lots/transactions/corporate actions, settlement calendars, obligation deadlines, interest/maturity, collateral conditions, FX, concentration, tax law and personal adjustments are not implemented. This module cannot attest account-wide collateral safety or calculate a tax result. No legal threshold or investment policy is encoded. Additional-outflow completeness is a caller assertion, not a reconstructed accounting ledger.

Tests:6/6 targeted PASS, synthetic correctness only. Existing core107/107 and consumer5/5 retained as historical results, not rerun or combined into a current full-suite claim. Module SHA256: 7ff964d172aef9752e6c6b739716a9b34fa8641c72128a65e652cfab4b0379b0.


## Private local price-shock scenario contract

`domain/asset-stress-contract.mjs` reuses the ledger validation above. Only fictional fixtures have been evaluated; no private storage, account connection, endpoint, scheduler or production integration exists.

The caller supplies schemaVersion1, a scenario id and an explicit integer basis-point shock for every held nonzero ticker. Missing shocks are unknown and block all scenario totals; an explicit0 is valid. The numerical contract accepts -10000..10000bps (a price loss down to100% or gain up to100%); this is a calculation bound, not an approved risk limit or probability.

Output separates base net assets, modelled securities/gross/net assets, signed net-asset change and nonnegative scenario loss. Cash and debt principal are unchanged. BigInt arithmetic floors each account/ticker valuation to whole KRW; output amounts must remain safe integers or all scenario totals are null/BLOCKED. Modelled prices are never relabelled as VERIFIED observations. Negative net assets remain visible.

This is an instantaneous price-only model: no security sales, new borrowing, collateral call, liquidation, taxes, interest, FX, time path or liquidity effect is inferred. No trade, maximum allocation, forecast confidence or probability is produced. Actual asset quantities and all outputs remain private; public Worker import boundaries are tested.

Targeted scenario5/5 PASS plus existing ledger6/6 and public-boundary2/2,13/13 total. Synthetic correctness only. No additional full-suite or remote validation claim for this isolated module.


## Private local dated-cash coverage contract

`evaluateCashDeadlines` in domain/cash-deadline-contract.mjs is a separate cash-only validator/calculator. It does not require live stock quotes or claim holdings/debt valuation completeness: a direct cash-payment risk can be examined independently of market Signals.

Input is the existing KRW ledger plus schedule schema1 with ledgerAsOfMs exactly matching ledger.asOfMs. Every declared account must have explicit cash/obligations coverage, fresh source/verification, balance and withdrawable cash. Each matching schedule account needs coverageComplete=true and an explicit obligations list (empty is allowed). OPEN obligations require a unique obligationRef, nonnegative integer amountKrw, valid dueAtMs, sourceRef/verifiedAtMs, and cashTreatment=NOT_DEDUCTED_FROM_WITHDRAWABLE. The sum of all listed amounts, including after the requested horizon, must equal that account's additionalOutflowsKrw. An already-deducted or paid item cannot be subtracted again.

Caller supplies nowMs, maxLedgerAgeMs and horizonAtMs>=nowMs. Due timestamps are exact instants supplied by the caller; no legal/bank holiday, settlement-calendar or time-zone cutoff is invented. Future deadlines are allowed; future/stale verification is rejected. The schedule asserts all relevant declared outflows have been supplied; local checks do not externally verify that assertion.

Equal deadlines are grouped; OPEN overdue payments and items due exactly at the horizon are included. Per-account cumulative headroom uses only current withdrawable cash. Output distinguishes balance, withdrawable, due-through-horizon, signed headroom, shortfall and first shortage time. Total accountShortfallSumKrw sums each account's positive gap rather than offsetting it against another account's surplus. No transfer, future salary/dividend, security sale, new borrowing or reserve is assumed.

An OVERDUE_OPEN_OBLIGATION remains a separate risk event even if cash covers it. Events here are local data, not delivered alerts; no event-notification lifecycle or channel is connected. Missing/incomplete dates/amounts/coverage, duplicate identity, unrecognized account, unreconciled totals and unsafe aggregate arithmetic return BLOCKED with all derived totals null and account/event arrays empty. BigInt prevents aggregate precision loss.

Private output contains account references and financial values and must never be imported/published by the public Worker or written to public logs/artifacts with real data. Tests use fictional inputs only: cash-deadline8/8, together with ledger6/6 and public-boundary2/2,16/16 targeted PASS. No real account verification, production deployment, investable-cash rule, collateral/tax computation or alert delivery is claimed.


## Private local risk-summary adapter

`buildPrivateRiskSummary` in domain/private-risk-summary.mjs reuses the three separate ledger, price-shock and dated-cash contracts with a common caller reference time and ledger cutoff. It performs no fetching, storage, notification or public API work. Its output is always PRIVATE_LOCAL_RISK_SUMMARY_ONLY/PARTIAL, never an overall safe classification.

Valuation, investable cash, price stress and cash deadlines have separate availability. Valuation can remain available with investable cash unavailable when reserve is unspecified. Missing/unverified quotes block valuation/stress without hiding a valid direct cash shortage; missing dated obligations block only cash timing while other valid calculations remain visible. Invalid component policy/input exceptions become generic blocked issues, without serializing exception bodies. A future/invalid common cutoff is null, not a verified reference.

Component limitations remain intact. No collateral, tax, trade decision, notification delivery, complete asset coverage or actual account verification is inferred. Output is private financial data and must not enter the public market response graph, CI logs or artifacts with real inputs. No new private storage/access has been approved or connected.

Adapter4/4 targeted, combined adapter/stress/cash/public-boundary19/19 targeted; full174/174 local regression after final guard. Entirely fictional correctness, not remote CI or production validation. Existing authenticated candidate c62ec46 evidence remains separate and unchanged.


## Private concentration contract

`evaluateConcentration` in domain/concentration-contract.mjs reuses full ledger/quote validation. Policy must explicitly choose DECLARED_SECURITIES_VALUE (sum of declared securities) or DECLARED_GROSS_ASSETS (securities plus ledger cash balance, before debt deduction). No default denominator, net-assets weighting, portfolio maximum or tax threshold is inferred. Declared accounts do not attest entire wealth or all holdings.

Results contain aggregated valueKrw per ticker across accounts and samsungHynixCombined for005930/000660. Zero-quantity holdings are skipped; covered absence is known zero combined exposure only when the denominator is positive. Weight is integer basis points floored with exact BigInt arithmetic. Both numerator value and denominatorKrw are explicit. Floors are not normalized: individual weights need not sum to10000, and0bps can represent a small positive exposure below1bp, not a zero amount. The two-stock group is not an industry classification.

A zero denominator returns UNAVAILABLE with null weights/ZERO_DENOMINATOR, not0% concentration. Missing/incomplete ledger or unverified/stale quote blocks all exposure output, preserving the existing no-partial-account-total safety. Invalid/future root cutoff is null.

The private risk-summary adapter computes concentration only when concentrationDenominator is explicitly supplied. Otherwise it is NOT_REQUESTED/UNAVAILABLE. A blocked concentration result leaves independent supported cash-deadline output intact; all summaries remain PARTIAL with trade/notification/collateral/tax capabilities unavailable. No public endpoint, private storage or actual account data is connected.

Tests: concentration6/6; opt-in/failure-isolation adapter adds2 cases. Related suites14/14 and integration full182/182 local PASS. Fictional correctness only. Existing candidate c62ec46 runtime/CI receipt is unchanged and separate; no candidate rollout required.


## Private collateral-input gate (no broker formula)

`validateCollateralInput` in domain/collateral-input-contract.mjs checks only local schema and declared evidence. No broker terms have been externally validated, and no maintenance-margin, collateral-headroom, margin-call, liquidation or tax computation is implemented. A valid input reports inputValidationStatus=VALIDATED_LOCAL while overall status and calculation stay UNAVAILABLE, with calculated values null. RequiredCoverageBps and haircutBps are caller-supplied metadata; neither establishes an approved real or personal limit.

Input schema1/KRW contains asOfMs and explicit account-only scope. Each account requires unique accountRef, completeness for positions/securedDebt/brokerTerms, sourceRef, VERIFIED quality and verifiedAtMs. Debt fields securedDebtKrw/accruedChargesKrw are separate nonnegative safe integers with explicit PRINCIPAL_PLUS_ACCRUED_CHARGES basis; unsafe combined values are rejected. These assertions do not prove which part of the ledger's debt is secured.

Each rule requires versionRef, formulaRef, sourceRef, VERIFIED/fresh verification, effectiveFromMs<=asOfMs<effectiveUntilMs, positive integer requiredCoverageBps and an explicit BROKER_STATEMENT_VALUE or POSITION_HAIRCUT_VALUE calculation basis. These labels identify supplied intent only; there is no implemented formula registry. Every current formula remains unsupported, even if all metadata passes.

Each declared position requires a unique six-digit ticker within its account, nonnegative integer quantity/priceKrw, KRW currency, explicit ELIGIBLE/INELIGIBLE plus integer haircutBps0..10000, source and VERIFIED/fresh observedAtMs no later than input cutoff. Nonzero quantity requires a positive price. Missing/null/estimated/stale/future values cannot stand in for verified fields. Explicit0 haircut/debt/charges remains0 metadata, never a calculated0 headroom.

Bounds of32 accounts and256 positions per account are technical input-processing bounds, not investment limits. Oversized inputs, duplicate accounts/positions and missing/expired terms produce BLOCKED; outputs include generic paths/codes, never copied source text or sensitive values.

The private risk-summary adapter accepts optional collateralInput with explicit maxCollateralInputAgeMs/maxCollateralQuoteAgeMs. It requires exact ledger cutoff and declared account-set matching; absent input is NOT_REQUESTED. This does not yet reconcile position quantities or debt classification across ledgers, and does not make collateral calculation available. Invalid policy/scope is isolated; other supported components, including direct cash risk, remain available independently. Public module graph excludes all private domain modules.

Validation: gate6/6, gate+boundary8/8, integrated16/16 and full190/190 local PASS. Fictional test fixtures only; not a real brokerage/account/terms validation, candidate deployment or live-market PASS. Broker formula work requires a separately scoped High review using authoritative applicable terms; private account integration remains separately approved.


## Local collateral-to-ledger reconciliation

`reconcileCollateralToLedger` in domain/collateral-reconciliation.mjs first reuses the collateral schema gate, then checks a matching bounded ledger snapshot. Policy supplies maxLedgerAgeMs separately from collateral input/quote ages. Same schema1/KRW cutoff and exact declared account set are required; ledger source/verification and holdings/debt coverage must be valid. No quote lookup or broker formula is performed.

Reconciliation requires ledger account holdingBasis=OWNED_SETTLED_SHARES, collateral positionScope=OWNED_PLEDGED_SUBSET, and collateral debtScope=ALL_DEBT_SECURED_TO_THIS_ACCOUNT. Missing or other ownership/pool semantics are unsupported/BLOCKED; the helper does not reinterpret borrowed/unsettled/third-party collateral. Each pledged ticker quantity must not exceed that same account's declared owned settled quantity. A complete covered ledger's absent ticker is known0; missing/incomplete holdings are never treated as0. Other account surplus shares cannot offset a local shortage. Prices/haircuts are not reconciled into a collateral value.

Each ledger debt requires a unique debtRef across the declared scope, principalKrw, accruedChargesKrw and explicit securityType=SECURED_TO_THIS_ACCOUNT or UNSECURED. Only the former is summed, using exact integer arithmetic. Its principal and accrued charges must independently equal the collateral snapshot fields. Unclassified or secured-elsewhere debt is unsupported, not automatically counted as unsecured or secured. Empty covered debt and explicit0 are valid; unknown debt is not. Duplicate debt/holding IDs, unsafe secured totals and amount mismatches block reconciliation.

Ledger bounds are32 accounts/256 holdings/128 debt entries per account, technical limits only. Tickers must be strings of six digits; numeric coercion is rejected in collateral input and owned holdings.

Successful matching adds reconciliation.status=MATCHED_LOCAL, while overall collateral status/calculation remain UNAVAILABLE and all calculated collateral fields remain null. Failure clears validated counts and preserves blocked issues. The risk-summary adapter now uses this gate: legacy ledger snapshots can still support their existing valuation/cash contracts, but cannot claim collateral consistency without the new explicit scope/classification fields. Failures remain isolated from direct cash risk.

This is local assertion consistency, not external brokerage/ownership/debt attestation, legal eligibility or margin safety. Real formula/terms, private data access and deployment remain separate gates. No raw personal IDs/amounts/source text are echoed by this reconciliation result.

Tests: new7/7, initial reconciliation+input13/13, integrated related23/23, one full197/197 local PASS. Fictional fixtures only. Public import boundary remains intact; no candidate or production deployment is required.


## Private risk-event lifecycle and duplicate suppression

`createRiskEventState` and `reduceRiskEvents` in domain/risk-event-lifecycle.mjs are standalone pure helpers, not a connected alert service. The caller explicitly supplies previous state, a capture and reference/age policies; no network, storage or scheduler runs. All IDs/state/intents remain PRIVATE. Only fictional fixture inputs have been evaluated.

Capture schema1 requires sourceStatus=OK or FAILED. Accepted OK captures have nonfuture observedAtMs/inputCutoffMs, cutoff<=observation, separate maxCaptureAgeMs/maxInputAgeMs and nonregressing successful capture times. A fresh collection cannot refresh stale underlying evidence. Events require stable eventId, fixed eventType, positive integer evidenceVersion, caller-supplied severity INFO/WARNING/CRITICAL and explicit ACTIVE/RESOLVED/UNKNOWN state. Evidence versions must represent material evidence, not automatically increment every polling cycle; no financial severity threshold is invented.

New active events emit a local OPENED intent. Higher material versions emit CHANGED, explicit active-to-resolved emits RESOLVED, and a resolved-to-active transition emits REOPENED. firstSeenAtMs persists across reopening; lastChangedAtMs and resolvedAtMs track distinct facts. Metadata updates to an already resolved event do not rewrite its actual resolution time. Unchanged same-version input refreshes lastSeenAtMs only, with no new intent. Same-version status/severity conflicts, regressing versions, changed type for an existing ID, future/out-of-order cutoffs and duplicate IDs reject the whole batch before state mutation. Resolution without a prior event is unsupported/BLOCKED.

Absence is not resolution. Omitted active IDs and explicit UNKNOWN remain active but unverified; FAILED/stale input cannot clear a risk. Successful capture processing means only the explicit supplied observations were processed, never proof that every risk was checked. State and intent ordering is canonical; arbitrary source descriptions are not echoed. Intents carry stable ID/version/transition identity but have not been queued or sent.

Technical bounds:100 captured observations and1000 retained events. Capacity errors preserve existing state; no automatic pruning or deletion. Previous state and its timestamps/notification metadata are validated. Unsupported imported transport-success fields cannot masquerade as a connected delivery path.

Notification connection is NOT_CONNECTED, request NOT_REQUESTED, delivery/acknowledgement UNCONFIRMED, lastNotifiedAtMs/version null. Producing an intent is not request success, device delivery or user acknowledgement. Cross-process/durable duplicate suppression, queue receipts, retries, delivery and user confirmation are not implemented; losing caller-supplied state may regenerate intents. No private persistence/channel has been approved or connected.

Tests: lifecycle10/10 plus public import-boundary2/2,12/12 targeted PASS. Existing full197/197 at parent22a6f06 is reused only for unchanged prior source; no full-suite, real notification or live-validation claim for this standalone module. A cash-result adapter is the next separate integration unit.


## Private cash-risk event adapter

`createCashRiskEventState` and `advanceCashRiskEvents` in domain/cash-risk-events.mjs connect calculated cash-deadline output to the standalone lifecycle reducer. Explicit caller bindings supply stable private event IDs and severities for shortage and overdue risk per account; no severity/risk threshold is invented. Up to32 bound accounts is a technical limit. Fixed horizonAtMs and exact account scope prevent a shorter horizon or missing account from clearing an existing risk. Horizon rollover is not automatic.

The adapter requires CALCULATED/schema1/KRW/private-scope cash output with complete declared account scope, explicit empty issues, valid capture/cutoff and matching fixed horizon. It checks per-account cumulative deadlines/headroom/shortfall/overdue consistency, risk-event agreement and aggregate totals; at most128 deadlines per account. These checks are local consistency, not cryptographic proof or external account verification.

Material shortage evidence is positive gap plus first-shortfall deadline. Material overdue evidence is count plus positive overdue due/amount buckets. Unchanged fields, later collection time and irrelevant cash changes do not automatically increment versions. Complete inactive results resolve an existing risk explicitly; an initially inactive risk creates no fictitious resolution. Reopening/changes increment an integer evidence version with overflow protection. Signatures/state contain PRIVATE financial data and must not be published or logged with real inputs.

Blocked/partial/corrupt cash results, stale underlying cutoff, wrong account scope or changed horizon preserve caller state with no resolution/intents. Out-of-order snapshots are rejected. Evidence history must match lifecycle IDs/versions/type/severity; missing state is not silently reset. JSON serialization/reload preserves local duplicate suppression, but there is no durable store or exactly-once delivery guarantee. Valid schema/consistency does not externally attest source facts or prevent deliberate caller-state tampering.

All notification fields remain NOT_CONNECTED/NOT_REQUESTED/UNCONFIRMED. No actual notification, private file/store or scheduler is connected. Adapter8/8 plus lifecycle10/cash8/public-boundary2,28/28 targeted PASS using the existing calculator and fictional inputs. A full cumulative run is reserved for the immediately following local workflow integration.


## Private local workflow and fictional end-to-end replay

`runPrivateRiskWorkflow` in domain/private-risk-workflow.mjs composes existing risk-summary and cash-event helpers; it does not recalculate rules independently. Caller supplies analysisPolicy and, only when event processing is requested, previousEventState plus an eventPolicy at the same reference time. Missing prior state means NOT_REQUESTED, not an implicitly initialized or persisted event ledger.

Valuation, price stress, concentration, cash timing and collateral input gates remain separate. Stale quotes do not hide independently valid cash risk. Incomplete cash timing preserves known event state; complete recovery explicitly resolves it. Malformed previous state or incompatible event policy yields BLOCKED with state=null and RETAIN_CALLER_STATE_UNCHANGED, never a new empty state or a claim that no risk exists. Other valid analysis remains visible. Overall status alwaysPARTIAL, notifications/delivery/trade/tax/actual-collateral computation unavailable.

The returned summary/state/intents are PRIVATE financial data if real inputs are supplied. Current tests use fictional inputs only; no actual user data, network, file/store connection, sender, scheduler or public endpoint exists. JSON serialization in tests is not durable persistence or tamper evidence. Fixed horizon rollover requires a separate explicit design.

Validation: workflow6/6, workflow+adapter+public-boundary16/16 targeted; one cumulative full221/221 local PASS. Record validation/private-risk-workflow-fictional-20261016.json contains only test counts/source hashes/log digest and scope, no holdings/amounts/credentials. It is local correctness evidence, not remote CI/account/notification/live-production validation. Existing candidate c62ec46 remains unchanged.


## Private-ingestion review scope — reviewed2026-10-16; ADR-PVT-01 below

The local prototype is complete enough for fictional replay. It is not ready to accept actual user assets. The next unit is a bounded security/architecture review, not another market collector or a new deployer. No private store, credential, Worker, binding, route, file connection or sender has been selected/connected by these changes.

Before any real connection, review must resolve and produce a concrete proposal for:

1. Approved private input/storage destination and authorized readers, isolated from public GitHub, market D1/API, public CI logs and artifacts. Work conversations/uploads and scheduled tasks do not automatically share private access.
2. Authentication/least privilege, encryption and key custody, data retention/deletion, backup/recovery, error redaction, and handling of real holdings/cash/debt identifiers. No secret values in code or checkpoint.
3. Atomic durable event state/material evidence/outbox boundary. Crash between state update and intent handling must not silently lose or duplicate a user notification. No exactly-once or delivery claim without tests.
4. Versioned state restoration and explicit account/horizon policy changes. Missing, corrupt or outdated state must not reset active risk. Caller-retain/null outcomes must not overwrite persisted state.
5. Distinct intent/request-success/provider-delivery/user-ack facts and explicit delivery-channel approval. Current code sends nothing. Broker formulas and personal allocation/risk thresholds require separately validated applicable inputs; no default rule is inferred.

Review deliverables: one limited design decision in this existing document, defined data/auth boundaries, failure/recovery tests, deployment/rollback proposal, and exact user approval required for real connection. High is recommended because this is a new private-data/authentication/persistence architecture, not a small change to the existing public candidate. Designing it does not authorize implementation/deployment of a connection.


## ADR-PVT-01 — private ingestion, durable state and outbox review

Review date:2026-10-16. Source reviewed:1a9a0305ad485ea5cdcb35d56ddee14e86d12e8f.
Status: **RECOMMENDED_FOR_REVIEW / NOT_SELECTED / NOT_PROVISIONED**.
This selects no real account, namespace, hostname, store, credentials or delivery channel. Existing public production/candidate/Builds remain unchanged.

### Decision and alternatives

| Option | Assessment | Status |
| --- | --- | --- |
| Existing market-relay/intelligence candidate or market-history D1 | Mixes public market privileges with private assets; rejected for personal data | REJECTED |
| Owner-operated encrypted local SQLite | Possible offline prototype, but needs an owner-controlled persistent machine; Work scratch is not such a store | FALLBACK_ONLY |
| Separate private Worker with one SQLite-backed Durable Object per owner | Recommended target for review: one authority for input revisions, event state and outbox, no market D1 binding | PROPOSED_NOT_APPROVED |

Cloudflare documents transactional SQLite storage for Durable Objects and recommends that backend for new namespaces [P1]. This is a provider capability, not evidence of an existing deployed private store.

Prefer a distinct administrative Cloudflare account/credential boundary for the private compartment. Same-account deployment is acceptable only after reviewing actual token/resource scopes, public CI/build permissions and administrator trust; names or namespaces alone are not an administrative boundary. Current per-Worker privilege isolation, available account/plan/cost and management access are NEEDS_EXTERNAL_VERIFICATION. Do not repeat old login/token checks without changed access. New paid subscription, account setup, Secret or route is not approved here.

The existing public candidate keeps its single Builds path. No competing deployer is added. A future private release requires separately approved isolated release credentials and reviewed/pinned source; public branch contributors/build jobs must not obtain private deployment/runtime credentials. Source code and synthetic tests may stay in GitHub; actual payloads/results/identifiers must not.

### Boundaries, readers and intake

| Boundary | Permitted | Denied |
| --- | --- | --- |
| Public market GitHub/Worker/D1/CI/artifacts | Existing market data/code, generic synthetic test records | Personal inputs/results, private actor IDs, keys, state/outbox |
| Private ingress/processor | Approved owner input; existing pure validators/calculators; owner-scoped sealed records | Arbitrary SQL, supplied destination URL, body-selected owner/actor, automatic order |
| Owner identity | Versioned structured input/review; scoped private analysis | Implicit approval of tax/broker rules or sending |
| Future machine reader | Explicitly granted owner-specific analysis/status read role | Input mutation, raw export, cross-owner read, deployment |
| Future sender | Minimal approved outbox item and verified receipt protocol | Raw ledger access or inferred device/user acknowledgement |

First intake would be an authenticated structured schema, not autonomous account scraping, PDF/OCR, chat-memory import or collection from project uploads. Source/verification fields remain assertions until independently verified; never promote RECENT_FETCH/UNVERIFIED_TIME to VERIFIED. Existing pure validators preserve their limits and unknown broker formulas. A read failure or missing input cannot initialize an empty personal ledger or clear an active risk.

Proposed interfaces, **not existing endpoints**: bounded POST /private/inputs with opaque idempotency key and expected revision; GET /private/analysis/latest; GET /private/status; an explicit policy/scope-change operation. No arbitrary SQL/raw-secret endpoint, raw export, scheduler or sender in the initial candidate. Fixed JSON schemas, body/row/deadline limits and per-principal rate limits must be implemented and tested before deployment. Personal IDs/amounts/tokens never enter URLs. Private responses no-store, no Cache API/CDN caching, no third-party analytics. Deny CORS by default; an eventual owner UI needs an explicit origin and CSRF protection for cookie-authenticated writes.

### Authentication and authorization

Recommended Access-protected private ingress plus application authorization. Authenticate before touching the owner's actor/storage. Reject unsigned identity headers, wrong issuer/audience/algorithm/expiry and missing owner/role mapping. A supplied ownerId does not authorize object selection. Resolve the actor server-side from the authenticated principal and approved mapping.

Use verified user subject for owner identity. An Access service-token JWT may have empty sub and identify the service via common_name [P3]; never map every empty sub to one owner. Machine identities need explicit separate role/owner mappings and no write/export by default. Do not reuse INTELLIGENCE_READ_TOKEN, VALIDATION_TOKEN or Cloudflare management tokens as personal-data credentials.

Current Workers documentation also describes ctx.access, its absent/unpropagated contexts and Service Binding limitations [P2]. No existing runtime support or upstream binding propagation is assumed. For a future implementation choose exactly one tested verification path: explicit pinned-issuer JWT verification or validated runtime Access context with audience checks. Unknown/missing context fails closed, including previews/workers.dev/custom-domain/internal entry paths. A service-bound call without verified authorization cannot bypass ingress. JWKS source is fixed trusted configuration, not a URL derived from an untrusted token; bounded refresh/timeouts and unknown-key failure are required. Test unknown routes and deploy previews as separate bypass cases.

Existing CI credentials are not inherited by Work, Cloudflare runtime or scheduled ChatGPT execution. No current scheduled private access is established. Cloudflare permission groups/resources exist [P4], but an actual token's ability to edit a private Worker is UNVERIFIED; test denied scope before accepting shared-administration isolation.

### Encryption, metadata and trust

Cloudflare documents managed encryption at rest/in transit for Durable Objects [P5]. This does not make the application end-to-end encrypted or protect plaintext from trusted runtime/deployment administrators.

Propose application AEAD for ledger, analysis, event evidence/state and outbox payloads before persistence. Use a reviewed Web Crypto implementation, explicit key version, unique nonce per encryption and authenticated context containing opaque owner/record kind/record ID/schema/policy epoch. AES-GCM parameters and nonce uniqueness requirements are documented in [P6]. Do not store identifying account names or sensitive JSON in SQL indexes. Request-payload equality tags should be private keyed tags, not published hashes of guessable balances. Minimal revision/timing/status metadata remains observable to authorized platform administration; do not promise it is hidden.

Keys must be in an approved private runtime secret/key system, never public Builds/Actions/source/logs or beside ciphertext backups. Key custody, rotation, owner-controlled recovery copy and loss handling need explicit approval. Missing/tampered/wrong-key data blocks writes and dispatch; it does not create a new empty state. Provider admins and code-deployment principals remain trusted; application encryption does not remove that residual risk. No key has been generated by this review.

Private request/body/error logging and external log destinations must be audited, not assumed disabled. Application audit is bounded generic action/result/revision metadata; do not log raw payloads, account IDs, actor naming material, authorization or exception bodies. Access/provider logs may retain identity/network metadata; actual retention/location is an approval gate, not a promise of zero personal metadata.

### Proposed durable records and commit protocol

These are logical records, **not SQL migrations**:

| Record | Purpose |
| --- | --- |
| owner_head | Accepted input/state revision, policy epoch, restore epoch, key/schema versions, sealed current state |
| input_versions | Immutable sealed input revisions; original verification/cutoff; supersedes link |
| analysis_versions | Sealed result plus input/engine/schema/policy provenance; no stale Feature freshness inheritance |
| request_receipts | Owner-scoped idempotency key and private canonical payload tag, committed result/revision |
| outbox | Unique owner+policyEpoch+restoreEpoch+local intent ID; sealed body and independent dispatch fact |
| attempt/audit records | Later explicit delivery attempts/receipts or generic operational results |

Current local intent IDs repeat across fresh state initialization: a fictional executable reproduction confirmed the same local ID at separate first captures. This is not an existing remote-store failure; no store is connected. Future durable uniqueness must include policy/restore epoch. Never silently reset an event ID/version counter after restore, account-binding or horizon changes.

Protocol:
1. Authenticate/authorize, enforce limits, canonicalize input and idempotency identity. Validate matching account/time/quality/policy scope; reject invalid input or explicitly quarantine it without advancing accepted active state.
2. Read accepted revision/epochs and encrypted prior state. Decrypt, run existing pure workflow and prepare encrypted input/result/state/outbox outside the synchronous transaction. No network or asynchronous crypto inside the transaction.
3. In one synchronous storage transaction, recheck current authorization/config epochs and expected revision. Same committed request+same canonical tag returns its original tagged receipt; changed content for that key conflicts. A stale prepared revision or epoch conflicts, with no automatic unbounded retry.
4. Atomically append accepted input/analysis/receipt, update accepted head/event material state and insert all intent outbox rows. Any failure aborts the entire update. A BLOCKED/null/retain-caller-state workflow output must never replace accepted state. Quarantined attempts must be kept separate from accepted-current head.
5. Return the durable receipt only after commit. A lost HTTP response is an idempotent replay, not evidence that storage failed. Never update authoritative in-memory state before successful commit.

SQLite DO transactionSync is synchronous and rolls back on thrown errors [P1]. Async work can interleave before commit [P7], so expected revision/epoch checks remain necessary; single-threaded does not justify omitting them. SQL BEGIN/SAVEPOINT statements in the local reference model are not a deployable DO implementation; the provider adapter must use its documented transaction API.

### Outbox, delivery and recovery

Initial outbox state is PENDING_REVIEW, dispatcher disabled. One database transaction cannot atomically commit an external device delivery. A future approved sender must lease an item durably, use a stable provider idempotency key where supported, and record request outcome separately from provider delivery and user acknowledgement.

If an external request times out after possibly sending, mark UNKNOWN, not failed/not-sent. Without verified provider idempotency, do not blindly retry an ambiguous send; reconcile or require owner action. Retrying may duplicate; not retrying may miss delivery. Exactly-once external delivery is not promised. An acknowledgement needs its own authenticated evidence; neither HTTP200 nor a generated intent is acknowledgement.

Missing/corrupt/old state -> freeze, preserve last accepted records, no empty-state initialization. First owner creation is a separate authorized action. Horizon/account/rule changes require an explicit versioned epoch transition carrying active unresolved events for review, not createCashRiskEventState as automatic rollover.

Cloudflare documents a PITR facility with a past30-day window [P1]; current plan/runtime/restore capability and key recovery are unverified. It is not an independent owner backup. Any restore enters MAINTENANCE_FROZEN, blocks all writes/dispatch and requires validation against owner-controlled latest receipt, deletion manifest and delivered/unknown attempts before activating a new restore epoch. Replaying old outbox as pending risks duplicate delivery. Key backups are separate; keys absent from a restored database cannot be inferred.

Proposed retention: require owner-approved durations/version for inputs/results/state/outbox/audit before real ingestion; no executable default purge. Logical deletion does not prove deletion from PITR/backups, and deleting a row is not verified cryptographic erasure. Erasure and backup expiry/location must be confirmed before promising deletion. No Korean residency or specific data-location guarantee has been established.

### Failure/acceptance matrix

All rows below are **PLANNED_NOT_EXECUTED_ON_PROVIDER**, except the explicitly scoped local reference-model checks.

| Case | Required outcome | Current evidence |
| --- | --- | --- |
| No/wrong/expired identity, foreign owner, forged headers, preview/internal bypass | Reject before actor/storage; no secret/body echo | PLAN_ONLY |
| Read-only machine tries input/export; public token tries private access | Deny; public production unaffected | PLAN_ONLY |
| Two preparations from same revision | One commit, stale one conflicts; no lost update | LOCAL_SQLITE_MODEL_PASS |
| Crash after input/head/outbox write | Entire batch rolls back | LOCAL_SQLITE_MODEL_PASS |
| Lost response after commit | Same key/content returns original revision, no duplicate outbox | LOCAL_SQLITE_MODEL_PASS |
| Same request key/different input | Conflict, no overwrite | LOCAL_SQLITE_MODEL_PASS |
| New epoch/local intent ID reuse; old writer | Separate uniqueness; old writer fenced | LOCAL_SQLITE_MODEL_PASS |
| Workflow BLOCKED/null state | Preserve previous state, no false-clear | LOCAL_SQLITE_MODEL_PASS |
| Wrong AEAD key/nonce/AAD, corrupted ciphertext | Fail closed; no state reset/plaintext log | PLAN_ONLY |
| Stale/null/unverified/future input, incomplete scope, expired horizon | Preserve unresolved risk; no live/verified upgrade | EXISTING_LOCAL_WORKFLOW_TESTS_ONLY |
| Crash before/after possible external send; provider duplicate callback | Unknown send distinguished; idempotent provider receipt handling | PLAN_ONLY |
| PITR restore after sent item or deletion | Maintenance freeze; owner reconciliation; no automatic replay/resurrection | PLAN_ONLY |
| Rotation/key loss/retention expiry/private backup restore | Authorized version-aware recovery or explicit blocked state | PLAN_ONLY |
| Full logs/artifacts/caches/access review | No financial payload leakage; provider metadata disclosed | PLAN_ONLY |
| New private failure/load | Existing market relay/publication/D1 writer unchanged | PLAN_ONLY |

The6 reference tests use in-memory Node SQLite and fictional sealed markers; they verify the reference commit protocol only. They do not test provider transactions, JWT, encryption, durable storage, tamper resistance or real notification. Existing221/221 local regression remains historical evidence for unchanged runtime code; no new227/227 full-suite claim.

### Release, rollback and approval gates

- Current: design proposal+local reference validation only. No Worker/store/route/Access/Secret/paid subscription/real assets selected or connected.
- Next safe implementation: after design direction is confirmed, build the private adapter with injected storage/crypto/auth and fictional tests offline. No public endpoint or existing production modification.
- Actual isolated candidate provisioning needs explicit approval for new private Worker/SQLite DO/Access scope and administrative separation; exact account, permissions, plan/cost and key custody must first be reviewable. Test only synthetic data, dispatcher/real intake disabled.
- Real input access/storage, real authentication credentials, retention policy and any notification channel each require their applicable separate approval. Synthetic-candidate approval is not real-asset or sending approval. No token values requested in chat.
- Future rollback: disable ingress/dispatch first, preserve sealed records, select schema-compatible reviewed code; no destructive rollback migration or silent downgrade. Incompatible restored versions remain frozen. Public market infrastructure needs no rollback because it was not changed.

### Primary references checked2026-10-16

- [P1 SQLite DO storage/transaction/PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [P2 Worker Access context and invocation limits](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [P3 Access user/service application token fields](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [P4 API permission groups/resources](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [P5 Provider-managed storage/transport encryption](https://developers.cloudflare.com/durable-objects/reference/data-security/)
- [P6 Web Crypto AES-GCM parameters](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)
- [P7 Durable Object async concurrency rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [P8 Explicit Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)


### ADR-PVT-01 implementation checkpoint — 2026-10-16T17:08:17+09:00

Direction accepted by user's continuation; actual resources remain NOT_PROVISIONED and actual configuration unapproved. New private/input-adapter and transaction-store are offline injected contracts only, NOT a deployed private API or Cloudflare storage adapter. The exported fixed schema is for new isolated private-store fixtures, never an existing/shared D1 migration. Caller cannot supply owner/policies; trusted authorize must verify identity and server mapping, store head authorization epoch must advance on revocation, and getPolicy must bind policy epoch. SQL factory requires synchronous transaction semantics; it neither creates nor seeds a store. Async preparation finishes before synchronous commit. Raw failures return fixed generic codes. Existing domain result capabilities and quality limits survive sealing. Strict event-commit failure preserves authoritative state and never initializes it.

Adapter17/17 and unchanged-public-boundary2/2 local tests passed; auth/crypto doubles do not establish JWT/AEAD/provider security. Pending: concrete crypto+identity providers, provider transaction compatibility, bounded runtime execution/auth entry/bypass controls, actual administrative isolation/cost/retention/key custody, provider crash/restore/load and delivery verification. No private endpoint, sender or actual input exists.


### ADR-PVT-01 offline security providers and provisioning packet — 2026-10-16T17:17:18+09:00

Status: DIRECTION_CONFIRMED_OFFLINE_IMPLEMENTED / LOCAL_TESTED_NOT_DEPLOYED / PROVISIONING_NOT_APPROVED. User continuation accepts development direction only. All real administrative account/app/keys/namespace/route choices remain pending actual verification and applicable approval.

private/access-identity is a fixed-public-key verifier (RS256 signature, exact issuer/audience/app token, bounded lifetime/age, optional nbf, trusted server principal->opaque owner/roles). Keys/config are injected, never fetched from token URLs. User and service namespaces are distinct; service empty sub needs explicit common_name mapping and can only MACHINE_READ. Provider custom claims/email/roles/body owner do not grant rights. Constructor pins copied mappings/key-ring; unknown kid fails closed. A future runtime must load reviewed public keys from a fixed issuer with bounded refresh/expiry and no stale-key privilege assumptions. Public JWT verification material is not an authentication Secret, but real principal mappings must stay private.

private/envelope-crypto uses supplied non-extractable Web Crypto AES-256-GCM handles,128-bit authentication tag, separately supplied HMAC-SHA256 key, versioned envelope and authenticated context. The allocator MUST ensure96-bit nonce uniqueness for each ACTUAL encryption key across all owners using it, processes, key aliases, restarts and restores. The bounded local4096-entry reuse guard only detects local allocator errors; it cannot establish durable/global uniqueness. No default random allocator is installed. Keys may not be silently shared between independently allocated owner namespaces. Provider implementation must reserve/burn nonces durably before sealing, and restore must freeze until counter/key/epoch reconciliation; restoring an old counter under the same key/nonce prefix is forbidden. This is a deployment blocker, not solved by local AEAD success. AES rotation preserves the stable request-tag key; rotating HMAC requires explicit replay/epoch handling. Keys/ciphertext remain protected from application payload logging, but trusted deployment/provider admins retain the previously documented residual trust.

Tests: adapter21 + envelope7 + identity7 included in final full262/262 local PASS. Locally signed fixture JWTs and actual local cryptographic operations prove those code paths only. No live Access issuer/token/JWKS, DO transaction/nonce durability, restore/load, identity bypass or actual delivery proof. Initial/future source time checks and independent stale-market/cash risk behavior remain unchanged. No public API graph imports these modules.

Proposed NEW resource packet, **not created, not approved, names first require an existence check**:

| Resource | Proposed name / binding | Boundary / constraints |
| --- | --- | --- |
| Private candidate Worker | market-private-risk-candidate | Distinct private administrative account preferred; never market-relay/intelligence candidate; synthetic only |
| SQLite Durable Object | class PrivateRiskStore; binding PRIVATE_RISK_STORE | New isolated namespace; fixed schema only; no market-history/D1 binding or old-row access |
| Access application | market-private-risk-candidate | App/issuer/audience/principal mapping private; deny unauthenticated previews/internal entry; exact hostname/routing pending approval |
| Runtime encryption/tag material | Key-custody proposal pending | No value generated/read/requested in chat; separate private Secret approval before creation; never public Builds/CI |
| Plan/cost/admin scope | NEEDS_EXTERNAL_VERIFICATION | Existing account/credentials not assumed authorized; no paid signup/cost escalation automatically |

First remote milestone is a synthetic-only provider validation sandbox, not actual asset intake. Provisioning approval is separate from this code/direction approval; account/access/cost/credentials must be reviewable before execution. Existing public Builds remains the sole existing deployer and is not repurposed with private credentials. No production routing/main merge, real personal inputs, automatic sender or paid subscription is included. Provider nonce allocation, owner bootstrap/recovery freeze, private HTTP authentication+limits+bypass tests and operational receipt are required before enabling private intake. Missing current provider access is a blocker, not a reason to create new tokens or repeatedly log in.

Primary implementation references reused/checked2026-10-16: [Web Crypto AES-GCM parameters](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams), [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [user/service application-token fields](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/). Account/runtime capabilities remain unverified.


### ADR-PVT-01 resource approval and nonce reservation checkpoint — 2026-10-16T18:36:06+09:00

Latest scope supersedes the earlier provisioning-pending text: user continuation at2026-10-16T18:29:43+09:00 approves the proposed NEW synthetic-only private Worker/SQLite DO/Access set. Actual account/permissions/plan-cost, provider target existence and runtime key custody have not been verified. No such resource, remote schema, Secret or route was created by this session. Real financial data, sender, paid signup and production modifications remain outside approval. Resource-scope approval must not be requested again; the next external prerequisite is private account selection/management access.

private/nonce-ledger is an OFFLINE fixed-SQL reservation component for a NEW private store, not a shared D1 migration. Explicit key registration is required; it cannot initialize/reset/register/restore a row. ONE persistent authority for each actual AES key is mandatory. Reviewed control-plane configuration pins owner/authorization/policy/restore epochs and each key version/authority/prefix. Each synchronous transaction validates the accepted-head scope/mode and matching nonce row/schema/budget, increments the counter and commits before returning a96-bit value (32-bit registered prefix +64-bit big-endian counter). Application cap is at most2^32-1 reservations per registered key row, not a claim of universal cryptographic usage safety. Runtime key policy may require an earlier stop.

Reservations are separate from input/state/outbox commits: encryption failure, aborted business commit or lost reservation response burns the issued value; never release/roll it back for retry. A failed reservation transaction returns no nonce. Allocator rejects unresolved async transaction wrappers. readHead/sql/transactionSync must reference the SAME isolated actor/database and remain synchronous; provider compatibility is not yet proven.

SQLite-file close/reopen and multiple local adapter instances continue the stored counter, but this is NOT Cloudflare restart/replication/PITR proof. A declared externally advanced restore epoch rejects an old restored head or old key registration. An undeclared rollback that restores BOTH counter and scope cannot be detected by the same DB: all provider restores must use externally maintained maintenance/restore fencing and key/nonce reconciliation before resuming. No automatic resume or epoch derivation from restored DB. Distinct CryptoKey handles containing identical imported key bits cannot be identified here; duplicate handle aliases are rejected, and real key custody/one-authority verification is still required. No operational private service may claim restart/restore nonce safety before these provider/control-plane gates.

Final local275/275 PASS includes nonce12, envelope8 and input-adapter21, with fictional identities/assets and ephemeral keys only. End-to-end local cryptographic workflow now uses transactional nonce reservations and confirms later business-write failure burns values while preserving prior accepted analysis/events. Current source is LOCAL_TESTED_NOT_DEPLOYED. Real issuer/JWKS/Access, DO transaction/restore/load and HTTP bypass/rate/timeout/CPU gates remain pending actual provider validation.

Management preflight: direct Work API credential/account configuration and Wrangler are absent; no available provider management tool; Cloudflare plugin search returned no matches. Existing GitHub/Builds Secrets are separate and have not been declared absent or inspected for values. Existing public automation is preserved. No old failed login/token/Validator retry. One user prerequisite: identify whether a separate private administrative Cloudflare account already exists; choose and authorize that account's management path before any actual resource creation. Never send a token/key value to chat.


### Offline private HTTP boundary — 2026-10-16T19:37:55+09:00

private/http-boundary is a testable transport factory, not a deployed Worker/Access app/URL. Initial local methods: GET/private/status and POST/private/inputs. /private/analysis/latest remains unsupported here until its saved-result reader exists. Fixed trusted HTTPS origin and explicit Bearer credentials only; context/preview/origin matching is defense in depth, NOT a replacement for JWT verification/actual provider bypass tests. All browser Origin/cookie context is refused until a separate reviewed browser/CSRF design. readRole is constructor configuration, never a request parameter. Provider limiter and status/input operations must be injected; missing limiter cannot silently enable unlimited access. Rate-call tests do not prove distributed/provider enforcement.

Request byte/depth/key/time bounds and sanitized outputs are application controls; real platform CPU/memory/pre-auth provider limits remain unverified. HTTP deadlines race async work but cannot stop synchronous CPU/transaction work or guarantee cancellation of a remote write. After dispatch, timeout/abort/missing receipt returns writeOutcome UNKNOWN and requires exact original idempotency key/body/expectedRevision recovery; never declare rollback/not-sent or blindly retry. Current factory does not add a sender, scheduler, actual user/issuer/key or financial intake connection. Local39/39 targeted tests only; full275 remains the historical baseline. No public graph/runtime/config changes.


### Minimal saved-analysis read contract — 2026-10-16T19:45:48+09:00

Status: LOCAL_TESTED_NOT_DEPLOYED. Local factory supports optional GET/private/analysis/latest with private/read-adapter and saved-analysis-view, alongside input/status. None is an actual published endpoint. Fixed schema1 private-store SELECT captures only the accepted head's revision and matching version; no arbitrary SQL or old-row fallback. Authentication/server owner scope, contract/type/time/capability checks and post-decrypt head recheck protect this read. A changed accepted revision/epoch/frozen scope conflicts or fails closed rather than presenting it as current. Missing head does not initialize; explicit revision0 has no analysis and uses null status times. Frozen status metadata is readable by an authorized reader; analysis stays blocked.

Minimal response exports exact aggregates only, excluding per-account ledger/holdings/identifiers, private lifecycle state/intents/outbox and unexpected raw properties. Signed integer/null/zero and concentration-denominator/precision semantics are preserved. Stored root/summary/component contracts and unsupported capability claims are validated. Explicit analysis/input maximum ages are separate; either stale threshold suppresses all metric values/capabilities without deleting or resolving stored risk. A stale result cannot be upgraded by a small read-clock rollback. No source time is replaced with the response time.

Always temporalScope STORED_AS_OF_NOT_REEVALUATED: even within age thresholds, results are NOT a fresh balance/withdrawable cash/cash-deadline/market risk computation. Request-time reads do not run the financial engine or notify. Source verification remains declared-input scope, not external broker verification. Stress is explicit scenario, not probability. Feature/Signal versions null; stored market Feature v2 is not silently attached. Per-analysis engine release/Git SHA is still an intake/reproducibility gate, not claimed solved by contractVersion1.

HTTP reprojects the minimal view again using current response time, preserves unknowns and no-store. GET role is server constructor configuration; POST separately requires OWNER_WRITE, so this private Worker concept is not claimed globally read-only. Read adapter statements are SELECT-only at application level; provider bindings/admins are not SQL read-only ACLs. Unknown remote write outcomes continue to use exact idempotent replay and never promise timer cancellation. No browser UI/cookie auth is supported without later reviewed CSRF/origin design.

Final local307/307 PASS includes HTTP17/read13/adapter23. Local DB total_changes proves no read-side writes for fixtures only. Real provider transaction/rate/pre-auth/bypass/CPU/memory/restore/key/admin/Access/JWKS validation is still pending. Existing public imports/runtime/production and shared market D1 unchanged. Resource-scope approval remains accepted; private account existence/administration/access is unanswered, so no remote creation attempted and no repeated login/token/plugin/account-question cycle.


### Encrypted private analysis provenance — 2026-10-16T20:00:27+09:00

Local-only code bfbf49b9b3496b55da89137767f556f58a3dac1c, full315/315 PASS/targeted61/61. No runtime, account, Secret, private service or actual data was connected. New private analysis plaintext uses analysisEnvelopeVersion2 INSIDE the existing scoped AEAD envelope; private SQL schemaVersion1 and existing sealed input/state/outbox/receipt formats stay unchanged. This private payload version is distinct from public market Feature2.

Writer construction now requires an explicit supported releaseIdentity {engineGitSha, workflowVersion:1}; no empty/zero/fabricated fallback. It detaches that configuration. Per accepted revision, encrypted provenance links previous revision, workflow/input schema, generation/cutoff, server policy/restore epochs, request ID and input HMAC. The exact canonical frozen analysis/event policy applied to calculation is retained with a domain-separated HMAC using existing crypto.tag. No new key or secret. Policy snapshot includes invocation time: its tag is not a semantic configuration-diff detector. Replay checks the original durable receipt before policy generation, preserving the original stored result/release across a later configured release.

Reader requires crypto.open AND crypto.tag, validates supported payload/source/workflow/input versions, revision chain, server epochs/time, and policy HMAC before returning a view. Legacy raw/unversioned analysis is PRIVATE_READ_UNAVAILABLE: no implicit upgrade, guessed current SHA, rewrite or old-row fallback. Authorized status and idempotent receipts stay usable. This supersedes the previous section's missing per-analysis configured SHA gate only; real runtime code attestation is STILL unverified.

Minimal authorized response provenance contains only envelope/workflow/input versions, configured historical engine SHA, revision chain and policy version/tag. Raw policy parameters, request ID/inputTag, restore/owner/auth epochs and ledger/events are not exposed. Existing independent freshness suppresses stale aggregates while retaining historical provenance; response time never replaces calculation/input cutoff. releaseEvidence is always CONFIGURED_REFERENCE_NOT_ATTESTATION. This improves traceability, not external account verification or full forecast/backtest reproducibility. Keys/archived code/prior-state retention/provider restore and actual operational verification remain separate gates.

All provider and approval boundaries in earlier sections remain. Public graph/production/shared D1/market history untouched, no migration or remote rows changed, no actual HTTP routes published.


### Holding identity type guard — 2026-10-18

Ledger holdings and alternative candidate tickers must be six-digit STRINGS. A numeric123456
previously passed RegExp coercion and could produce calculated valuations and concentration/stress
results. Both entry points now reject it; zero quantity does not waive identity validation and valid
leading-zero strings remain unchanged. Independent cash-deadline calculation does not depend on
holdings and remains available. Three regressions failed before the two-line fix; targeted40/40 and
full430/430 local PASS. Source/hash receipt: validation/holding-identity-local-20261018.json. No
quantity/cash/debt formula, security rule, broker clearance or runtime connection changed.
