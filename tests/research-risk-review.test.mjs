// Synthetic research authorizer and fictional private inputs only. No actual user approval or account data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {now, policy, setup, inputs} from './fixtures/research-pair.mjs';
import {buildResearchPairSummary} from '../domain/research-pair-summary.mjs';
import {buildResearchRiskReview} from '../domain/research-risk-review.mjs';
import {createCashRiskEventState} from '../domain/cash-risk-events.mjs';

function privateFixture(at = now) {
  return {ledger: {schemaVersion: 1, currency: 'KRW', asOfMs: at, accounts: [{
    accountRef: 'PRIVATE_ACCOUNT_SENTINEL', sourceRef: 'fictional-source', verifiedAtMs: at,
    coverage: {holdings: true, cash: true, debts: true, obligations: true},
    holdings: [{ticker: '005930', quantity: 10}, {ticker: '000660', quantity: 2}],
    cash: {balanceKrw: 5000, withdrawableKrw: 1000}, debts: [{principalKrw: 4000}], additionalOutflowsKrw: 1500}]},
    prices: Object.fromEntries([['005930', 100], ['000660', 500]].map(([ticker, priceKrw]) => [ticker,
      {priceKrw, currency: 'KRW', quality: 'VERIFIED', sourceRef: 'fictional-price', observedAtMs: at}])),
    scenario: {schemaVersion: 1, id: 'fictional-downside', shocksBps: {'005930': -1000, '000660': -1500}},
    schedule: {schemaVersion: 1, ledgerAsOfMs: at, accounts: [{accountRef: 'PRIVATE_ACCOUNT_SENTINEL', coverageComplete: true,
      obligations: [{obligationRef: 'fictional-payment', amountKrw: 1500, dueAtMs: now + 86400000, status: 'OPEN',
        cashTreatment: 'NOT_DEDUCTED_FROM_WITHDRAWABLE', sourceRef: 'fictional-source', verifiedAtMs: at}]}]}};
}
const privatePolicy = (at = now) => ({analysisPolicy: {nowMs: at, maxLedgerAgeMs: 1000,
  maxPriceAgeMs: 1000, reserveKrw: 0, horizonAtMs: now + 2 * 86400000,
  concentrationDenominator: 'DECLARED_GROSS_ASSETS'}, eventPolicy: {nowMs: at, maxCaptureAgeMs: 1000, maxInputAgeMs: 1000}});
async function context() { const {session} = await setup(); return inputs(session); }
const run = (researchContext, privateInputs = privateFixture(), options = {}) => buildResearchRiskReview(
  {researchContext, privateInputs}, {researchPolicy: policy, privatePolicy: privatePolicy(), enablePrivateEvaluation: true, ...options});

test('supportive research and separate adverse signals coexist with explicit cash shortage without a composite action', async () => {
  const c = await context(), pair = buildResearchPairSummary(c, policy), f = privateFixture(), before = structuredClone(f);
  const r = run(c, f);
  assert.deepEqual(r.research.data, pair); assert.equal(r.research.data.comparison[0].long_term_state, 'SUPPORTIVE');
  assert.equal(r.research.data.comparison[0].short_term_state, 'ADVERSE_DESCRIPTIVE_SIGNALS');
  assert.equal(r.cashRisk.shortfallKrw, 500); assert.equal(r.cashRisk.overduePresent, false);
  assert.equal(r.privateRisk.data.summary.components.valuation.totals.netAssetsKrw, 3000);
  assert.equal(r.privateRisk.data.summary.components.priceStress.totals.scenarioLossKrw, 250);
  assert.equal(r.classification, 'PRIVATE_COMBINED_RESULT_DO_NOT_PUBLISH'); assert.equal(r.executionAllowed, false);
  for (const key of ['recommendation','ranking','compositeScore','probability','tradeQuantities','collateralClearance']) assert.equal(r[key], null);
  assert.equal(r.research.data.private_risk.valuation, null); assert.ok(!JSON.stringify(r.research).includes('PRIVATE_ACCOUNT_SENTINEL'));
  assert.deepEqual(f, before); assert.deepEqual(run(c, f), r); assert.throws(() => r.cashRisk.shortfallKrw = 0, TypeError);
});
test('private calculation defaults off without reading supplied private inputs or requesting event state', async () => {
  let accessed = false;
  const f = {}; Object.defineProperty(f, 'ledger', {get() { accessed = true; throw Error('PRIVATE_SENTINEL'); }});
  const r = buildResearchRiskReview({researchContext: await context(), privateInputs: f}, {researchPolicy: policy});
  assert.equal(accessed, false); assert.equal(r.privateRisk.status, 'DISABLED'); assert.equal(r.cashRisk.shortfallKrw, null);
  assert.equal(r.research.status, 'LOCAL_PAIR_REVIEW_ONLY'); assert.equal(r.notificationDelivery, 'NOT_CONNECTED');
});
test('missing/unverified private quotes never borrow available market prices or hide cash risk', async () => {
  const c = await context();
  for (const mutate of [f => delete f.prices, f => f.prices['005930'].quality = 'UNVERIFIED_TIME']) {
    const f = privateFixture(); mutate(f); const r = run(c, f);
    assert.equal(r.privateRisk.data.capabilities.valuation, 'UNAVAILABLE');
    assert.equal(r.cashRisk.shortfallKrw, 500); assert.deepEqual(r.research.data, buildResearchPairSummary(c, policy));
  }
});
test('invalid or unavailable research cannot suppress independent cash shortage; stale Feature remains stale', async () => {
  const c = await context(); c.marketInputs.candidateFeatures.feature.inputCutoffMs = now - 1000000;
  let r = run(c); assert.equal(r.cashRisk.shortfallKrw, 500);
  assert.ok(r.research.data.comparison.every(stock => stock.short_term_status === 'UNAVAILABLE'));
  r = run(undefined); assert.equal(r.research.status, 'BLOCKED'); assert.equal(r.cashRisk.shortfallKrw, 500);
  const {session} = await setup({approve: []}); r = run(inputs(session));
  assert.ok(r.research.data.comparison.every(stock => stock.long_term_state === null));
  assert.equal(r.cashRisk.shortfallKrw, 500);
});
test('private clock mismatch or missing input is isolated; stale ledger produces unknown cash rather than zero', async () => {
  const c = await context(), pair = buildResearchPairSummary(c, policy);
  for (const p of [undefined, privatePolicy(now + 1)]) {
    const r = run(c, privateFixture(), {privatePolicy: p}); assert.equal(r.privateRisk.status, 'BLOCKED');
    assert.equal(r.cashRisk.shortfallKrw, null); assert.deepEqual(r.research.data, pair);
  }
  const missing = run(c, null); assert.equal(missing.privateRisk.status, 'BLOCKED');
  const stale = run(c, privateFixture(now - 1001)); assert.equal(stale.cashRisk.shortfallKrw, null);
  assert.equal(stale.privateRisk.data.capabilities.cashDeadlines, 'UNAVAILABLE');
  const invalid = run(c, {get ledger() { throw Error('PRIVATE_SENTINEL'); }});
  assert.equal(invalid.privateRisk.status, 'BLOCKED'); assert.ok(!JSON.stringify(invalid).includes('PRIVATE_SENTINEL'));
  assert.throws(() => run(c, privateFixture(), {enablePrivateEvaluation: 'true'}), /INVALID_RESEARCH_RISK_REVIEW_POLICY/);
});
test('existing local risk event workflow preserves dedup and emits no delivery during composition', async () => {
  const c = await context(), p = privatePolicy();
  p.previousEventState = createCashRiskEventState({horizonAtMs: p.analysisPolicy.horizonAtMs,
    bindings: [{accountRef: 'PRIVATE_ACCOUNT_SENTINEL', shortfall: {eventId: 'fictional.shortfall', severity: 'CRITICAL'},
      overdue: {eventId: 'fictional.overdue', severity: 'WARNING'}}]});
  const a = run(c, privateFixture(), {privatePolicy: p}); assert.equal(a.privateRisk.data.events.intents.length, 1);
  const restored = JSON.parse(JSON.stringify(a.privateRisk.data.events.state));
  const b = run(c, privateFixture(), {privatePolicy: {...p, previousEventState: restored}});
  assert.deepEqual(b.privateRisk.data.events.intents, []); assert.equal(b.notificationDelivery, 'NOT_CONNECTED');
  assert.equal(a.privateRisk.data.events.intents[0].requestStatus, 'NOT_REQUESTED');
});
