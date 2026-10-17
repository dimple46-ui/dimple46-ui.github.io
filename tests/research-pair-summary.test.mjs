// Fictional packages and approval verifier only. No actual user approval or provider access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sealResearchPackage, researchHash, createResearchHandoffSession} from '../domain/research-handoff.mjs';
import {buildResearchPairSummary, verifyResearchPairSummary} from '../domain/research-pair-summary.mjs';

const now = 1792148400000;
const policy = {nowMs: now, maxObservationAgeMs: 120000, maxFeatureAgeMs: 300000,
  maxFeatureObservationSkewMs: 120000, signalEngineGitSha: '1'.repeat(40)};
const ids = {'005930': 'fictional-research-samsung', '000660': 'fictional-research-hynix'};
function packageFor(ticker) {
  const {content_sha256, ...p} = JSON.parse(readFileSync(new URL('../examples/research-package.synthetic.json', import.meta.url)));
  p.package_id = ids[ticker];
  p.target.ticker = ticker;
  p.sources.forEach(source => { source.ticker = ticker; });
  return sealResearchPackage(p);
}
async function setup({approve = ['005930', '000660'], withdraw = []} = {}) {
  let clock = now;
  const session = createResearchHandoffSession({clock: () => clock,
    verifyUserDecision: async binding => ({verified: true, role: 'USER_APPROVER',
      receiptId: 'fixture:' + binding.decision_id, decidedAtMs: clock, bindingHash: researchHash(binding)})});
  for (const ticker of ['005930', '000660']) {
    const p = packageFor(ticker);
    session.receive(p);
    const binding = {package_id: p.package_id, revision: p.revision, content_sha256: p.content_sha256};
    if (approve.includes(ticker)) await session.decide({...binding, decision: 'APPROVE', decision_id: ticker + ':approve'});
    if (withdraw.includes(ticker)) await session.decide({...binding, decision: 'WITHDRAW', decision_id: ticker + ':withdraw'});
  }
  return {session, setTime: value => { clock = value; }};
}
function inputs(session) {
  const cutoff = now - 1000;
  return {session, packageIds: {...ids},
    marketInputs: {
      candidateState: {apiSchemaVersion: 1, inputCutoffMs: now, state: {schemaVersion: 1,
        observedAtMs: cutoff, availableAtMs: cutoff, tradingDay: '20261016', pipelineStatus: 'OK',
        quality: {dataQuality: {issues: [], unverifiedMarketTimes: []}},
        metrics: {'samsung.price': {value: 100, status: 'LIVE'}, 'skHynix.price': {value: 500, status: 'LIVE'}}}},
      candidateFeatures: {apiSchemaVersion: 1, inputCutoffMs: now, feature: {featureVersion: 2,
        observedAtMs: cutoff, generatedAtMs: now - 500, inputCutoffMs: cutoff, tradingDay: '20261016',
        generationStatus: 'SUCCESS', qualityCeiling: 'UNVERIFIED_TIME', compactFeatures: {featureVersion: 2}}}},
    featureReplay: {version: 2, inputCutoff: new Date(cutoff).toISOString(), bucketChanges: {
      samsung: {foreignFlow: {value: -100, acceleration: -40, status: 'BUCKET_DELTA', quality: 'VERIFIED'}},
      skHynix: {foreignFlow: {value: 100, acceleration: 40, status: 'BUCKET_DELTA', quality: 'VERIFIED'}}}, windows: {}}};
}
test('compares both stocks with separate long/short horizons, evidence versions and no allocation or prediction', async () => {
  const {session} = await setup(), r = buildResearchPairSummary(inputs(session), policy);
  assert.deepEqual(r.stocks.map(s => s.ticker), ['005930', '000660']);
  assert.equal(r.context_status, 'BOTH_RESEARCH_AND_LOCAL_SIGNALS_AVAILABLE');
  assert.equal(r.comparison[0].cross_horizon_state, 'LONG_TERM_SUPPORT_WITH_SHORT_TERM_ADVERSE');
  assert.equal(r.comparison[1].short_term_state, 'SUPPORTIVE_DESCRIPTIVE_SIGNALS');
  for (const stock of r.stocks) {
    assert.equal(stock.summary.long_term.horizon, '6M');
    assert.equal(stock.summary.input_versions.research.package_id, ids[stock.ticker]);
    assert.equal(stock.summary.private_risk.trade_quantities, null);
    assert.ok(stock.summary.short_term.signals.every(s => ['NONE','LOW','MEDIUM'].includes(s.confidence)));
  }
  assert.equal(r.ranking, null); assert.equal(r.probability, null); assert.equal(r.recommended_action, null);
  assert.equal(r.private_risk.withdrawable_cash, null); assert.equal(r.execution_allowed, false);
  assert.equal(r.monitoring.delivery, 'NOT_SENT');
});
test('missing or unapproved one-stock research remains partial without borrowing the other approval', async () => {
  const {session} = await setup({approve: ['005930']});
  let r = buildResearchPairSummary(inputs(session), policy);
  assert.equal(r.context_status, 'PARTIAL_CONTEXT');
  assert.equal(r.comparison[1].long_term_state, null);
  assert.equal(r.comparison[1].research_unavailable_reason, 'USER_APPROVAL_REQUIRED');
  assert.equal(r.comparison[0].long_term_state, 'SUPPORTIVE');
  const x = inputs(session); x.packageIds['000660'] = null;
  r = buildResearchPairSummary(x, policy);
  assert.equal(r.comparison[1].research_unavailable_reason, 'NO_RESEARCH_PACKAGE');
  assert.equal(r.stocks[1].summary.short_term.status, 'UNAVAILABLE');
});
test('withdrawn and expired approvals are excluded independently and never revived by fresh market data', async () => {
  const f = await setup({withdraw: ['000660']});
  let r = buildResearchPairSummary(inputs(f.session), policy);
  assert.equal(r.comparison[1].research_unavailable_reason, 'WITHDRAWN');
  f.setTime(now + 2 * 86400000);
  r = buildResearchPairSummary(inputs(f.session), {...policy, nowMs: now + 2 * 86400000});
  assert.equal(r.comparison[0].research_unavailable_reason, 'EXPIRED');
  assert.equal(r.comparison[0].long_term_state, null);
});
test('stale, future and cutoff-mismatched Feature suppress both tactical conclusions while research remains separate', async () => {
  const {session} = await setup();
  for (const mutate of [x => x.marketInputs.candidateFeatures.feature.inputCutoffMs = now - 600000,
    x => x.marketInputs.candidateFeatures.feature.inputCutoffMs = now + 1,
    x => x.featureReplay.inputCutoff = new Date(now - 2000).toISOString(),
    x => x.marketInputs.candidateFeatures.feature.qualityCeiling = 'STALE_INPUT']) {
    const x = inputs(session); mutate(x);
    const r = buildResearchPairSummary(x, policy);
    assert.equal(r.context_status, 'PARTIAL_CONTEXT');
    assert.ok(r.comparison.every(row => row.short_term_status === 'UNAVAILABLE' && row.long_term_state === 'SUPPORTIVE'));
  }
});
test('pair relative strength is evidence only, not a bullish direction assigned to both stocks', async () => {
  const {session} = await setup(), x = inputs(session);
  x.featureReplay.bucketChanges = {};
  x.featureReplay.windows = {'5m': {momentumAcceleration: {
    samsung: {value: 2, status: 'OK', quality: 'VERIFIED'}, skHynix: {value: -1, status: 'OK', quality: 'VERIFIED'}}}};
  const r = buildResearchPairSummary(x, policy);
  assert.ok(r.stocks.every(s => s.summary.short_term.signals.some(signal => signal.ticker === '005930/000660')));
  assert.ok(r.comparison.every(row => row.short_term_state === 'NO_ACTIVE_DESCRIPTIVE_SIGNALS'));
});
test('duplicate IDs, swapped targets, missing ticker mapping and future as-of are rejected', async () => {
  const {session} = await setup();
  for (const packageIds of [{'005930': ids['005930'], '000660': ids['005930']},
    {'005930': ids['000660'], '000660': ids['005930']}, {'005930': ids['005930']}, {...ids, OTHER: 'x'}])
    assert.throws(() => buildResearchPairSummary({...inputs(session), packageIds}, policy));
  assert.throws(() => buildResearchPairSummary(inputs(session), {...policy, nowMs: now + 1}));
});
test('same inputs yield immutable reproducible pair IDs; stable event IDs preserve unchanged detection', async () => {
  const {session} = await setup(), x = inputs(session), before = structuredClone({...x, session: null});
  const a = buildResearchPairSummary(x, policy), b = buildResearchPairSummary(x, policy);
  assert.deepEqual(a, b); assert.equal(verifyResearchPairSummary(a), true);
  assert.deepEqual({...x, session: null}, before);
  assert.throws(() => a.comparison[0].long_term_state = 'ADVERSE', TypeError);
  const tampered = structuredClone(a); tampered.comparison[0].short_term_state = 'FORGED';
  assert.equal(verifyResearchPairSummary(tampered), false);
  const previousEventChanges = Object.fromEntries(a.monitoring.events.map(e => [e.event_id, e.change_hash]));
  const c = buildResearchPairSummary({...x, previousEventChanges}, policy);
  assert.ok(c.monitoring.events.every(e => e.change === 'UNCHANGED' && e.notification_status === 'NOT_SENT'));
});
