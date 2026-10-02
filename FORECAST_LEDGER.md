# Forecast ledger — planned, not implemented

After operational history and point-in-time features are verified, introduce separate forecast and outcome tables. Store immutable generatedAt/input cutoff, ticker, horizon, target definition, probability, rationale and expiry. Outcomes need explicit evaluation rules and unresolved status for missing evidence. Keep calibration/out-of-sample evaluation separate from feature engineering. No guessed probabilities or historical success rates are generated here.
