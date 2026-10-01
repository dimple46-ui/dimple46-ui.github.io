# First feature engine

Implemented in candidate: 5/10/30-minute price returns for both stocks and indexes/futures; cumulative market/program/futures flow changes; OI/basis changes; two-window volume-rate acceleration; Samsung/Hynix and index-relative returns; return from open/previousClose; separate stock estimate bucket changes.

Baseline must be at/before the requested target and within 150 seconds of that target. Never interpolate. A 5-minute request with two-minute samples may cover six minutes; actualElapsedSeconds is mandatory. Missing coverage returns INSUFFICIENT_HISTORY.

All inputs must have been available by the feature generation cutoff. Do not cross KST dates. Reject bad quality, stale observations, counter resets and futures contract changes. Newer fetched data without exchange time remains labeled with its timeBasis. Bucket duplicates yield UNCHANGED_BUCKET and no artificial zero flow. Bucket deltas are shares between observed estimate publications, not a continuous time-window flow.

Not implemented: past same-time averages/20-day percentiles, VWAP, realized volatility, forecast probabilities, portfolio effects, public feature delivery. No claim of validated predictive edge.
