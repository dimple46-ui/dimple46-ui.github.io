# Signals

Status: `M3_PURE_FUNCTION_LIVE_INPUT_VALIDATED`. No actionable signal or BUY/SELL engine is enabled.

`cloudflare/signal-engine.mjs` is a deterministic, side-effect-free layer above Feature Engine 2. It
produces descriptive states for stock-flow acceleration/reversal, program acceleration, futures/OI
classification, relative momentum, price/flow and cash/futures divergence, and abnormal volume.

Each emitted signal records:

- deterministic signal ID, generated time and immutable input cutoff;
- ticker, horizon, type, state and categorical strength;
- supporting and contrary evidence plus explicit invalidation;
- feature version, signal version and engine Git SHA;
- weakest input quality and a confidence ceiling.

Confidence is descriptive evidence confidence, not historical probability or expected return. It can
never exceed the weakest input quality: `UNVERIFIED_TIME` caps confidence at `MEDIUM`; missing or
unusable inputs emit no active signal. Stale, null and unchanged stock-flow buckets cannot become
numeric zero signals.

The pure function has no D1, GitHub, network or portfolio side effects. It is not yet connected to a
production endpoint or alert engine. In addition to synthetic correctness tests, a captured real
2026-10-08 Feature v2 replay produced 18 descriptive signals with zero confidence-ceiling violations:
stale program input emitted no program signal and unverified-time futures inputs capped confidence at
`MEDIUM`. This is live-input correctness evidence, not an endpoint deployment, predictive-accuracy
claim or permission to generate investment actions.


Safety correction (2026-10-14): the common signal constructor suppresses STALE_INPUT,
MISSING_INPUT and UNUSABLE_INPUT for categorical futures/divergence as well as numeric signals.
UNVERIFIED_TIME remains explicitly capped at MEDIUM, not promoted to verified. This correction is
locally tested, not deployed or newly validated with live/historical production input.

Numeric safety (2026-10-14): relative momentum subtraction overflow emits no signal. Abnormal
volume uses a finite percentile within0..100 or finite z-score; missing/invalid auxiliary statistics
remain null in evidence. Negative volume is unusable. Thresholds95/2 and quality ceiling unchanged.
Local correctness validated; no new production historical/live validation implied.

Replay validation now requires supporting/contrary evidence arrays with finite numeric leaves.
Nested NaN/Infinity is rejected before PASS; null remains unknown. The finiteNumericEvidence gate
is local correctness evidence until a new authenticated real-data replay is validated.
