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

Cost basis, lots/transactions/corporate actions, settlement calendars, obligation deadlines, interest/maturity, collateral conditions, FX, concentration, stress, tax law and personal adjustments are not implemented. This module cannot attest account-wide collateral safety or calculate a tax result. No legal threshold or investment policy is encoded. Additional-outflow completeness is a caller assertion, not a reconstructed accounting ledger.

Tests:6/6 targeted PASS, synthetic correctness only. Existing core107/107 and consumer5/5 retained as historical results, not rerun or combined into a current full-suite claim. Module SHA256: 7ff964d172aef9752e6c6b739716a9b34fa8641c72128a65e652cfab4b0379b0.
