# Signals

Status: `M3_PURE_FUNCTION_CANDIDATE`. No actionable signal or BUY/SELL engine is enabled.

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
production endpoint or alert engine. Historical/synthetic tests establish correctness only; live
signal behavior remains in `NEXT LIVE MARKET VALIDATION`.
