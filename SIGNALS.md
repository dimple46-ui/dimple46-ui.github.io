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

## Bucket acceleration compatibility contract — 2026-10-16

Status: CONTRACT_AND_PURE_FUNCTION_TESTED; not wired into the writer or Signal output.

- Preserve Feature v2 `bucketChanges.*.acceleration`: current bucket delta minus prior bucket delta,
  unit shares. It is a delta difference, not elapsed-time-normalized acceleration. Existing Feature
  version, compact encoding/tuple positions, stored rows and Signal v2 meanings are not rewritten.
- Query-time candidate `bucketFlowKinematics`, contract version1, requires exactly three source bucket
  times/cumulative quantities with same trading day and evidence available at or before input cutoff.
  Duplicate/unordered times, future availability, unsupported time basis and unsafe arithmetic fail.
  Incomplete history, missing quantity or stale/unusable quality leaves derived fields null.
- For cumulative quantities C0/C1/C2 at t0/t1/t2, let d0=C1-C0, d1=C2-C1 and h0/h1 be source-time
  interval lengths in minutes. Average flows are r0=d0/h0 and r1=d1/h1 (shares/minute).
  Rate change is r1-r0; acceleration is (r1-r0)/((h0+h1)/2), in shares/minute squared.
  The denominator is the distance between interval midpoints. This describes estimated interval
  averages, not observed continuous flow, and does not prove predictive performance.
- Actual0930/1000/1120 intervals are30/80 minutes. Hynix foreign raw difference-12000 shares coexists
  with +52.19697 shares/minute squared; its interval-average selling slows. Constant100 shares/minute
  over unequal intervals must yield zero normalized acceleration even when raw delta difference is nonzero.
- Planned consumer is an explicitly versioned Signal v3 opt-in. No silent v2 semantic change.
  Future v3 requires this time-basis evidence; if absent it emits no acceleration signal, with an
  explicit insufficient-time-basis diagnostic. Never substitute observation/fetch time for source time
  or invent the third bucket. Propagate the weakest of all three input qualities.
- Query-time first: no new migration, persisted derived field, encoding change or writer activation
  is authorized. Any eventual persistence representation needs a separate encoding compatibility gate.
- Public replay availability at capture-fetch time proves those rows were available by that capture,
  not their historical first-arrival times. Reuse at earlier cutoffs is invalid without D1 availability evidence.

### Stock-flow v3 opt-in adapter

`generateStockFlowSignalsV3(samplesByStock, options)` is a separate pure-function candidate,
not a replacement for `generateDescriptiveSignals`. Default disabled; enabled:true, featureVersion:2,
explicit inputCutoffMs/generatedAtMs and engineGitSha are required. Input paths are
samsung/skHynix → foreignFlow/institutionFlow, each exactly three kinematics-v1 samples.

It recomputes normalized evidence through the helper, emits s3 stock-flow IDs and returns
per-flow suppression diagnostics. No raw-v2 acceleration fallback, no mutation, persistence or network.
Input-quality ceiling uses all three samples. Confidence is descriptive MEDIUM evidence confidence,
not historical probability. This is stock-flow-only v3; other v2 Signal families remain separate.
Missing time basis never emits an acceleration signal. Local correctness tests pass; no runtime deployment.
