# Private asset-ledger contract — local prototype

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
