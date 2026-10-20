// Synthetic test fixture, never an actual approval source.
import {readFileSync} from 'node:fs';
import {sealResearchPackage, researchHash, createResearchHandoffSession} from '../../domain/research-handoff.mjs';
export const now = 1792148400000;
export const policy = {nowMs: now, maxObservationAgeMs: 120000, maxFeatureAgeMs: 300000,
  maxFeatureObservationSkewMs: 120000, signalEngineGitSha: '1'.repeat(40)};
export const ids = {'005930': 'fictional-research-samsung', '000660': 'fictional-research-hynix'};
function packageFor(ticker) {
  const {content_sha256, ...p} = JSON.parse(readFileSync(new URL('../../examples/research-package.synthetic.json', import.meta.url)));
  p.package_id = ids[ticker];
  p.target.ticker = ticker;
  p.sources.forEach(source => { source.ticker = ticker; });
  return sealResearchPackage(p);
}
export async function setup({approve = ['005930', '000660'], withdraw = []} = {}) {
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
export function inputs(session) {
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
