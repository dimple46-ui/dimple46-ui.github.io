// PRIVATE offline composition of existing calculators. No intake, authentication, storage, Watch or orders.
import {buildResearchPairSummary} from './research-pair-summary.mjs';
import {runPrivateRiskWorkflow} from './private-risk-workflow.mjs';

const time = n => Number.isSafeInteger(n) && n > 0 && Number.isFinite(new Date(n).getTime());
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const blocked = code => ({status: 'BLOCKED', code, data: null});

export function buildResearchRiskReview({researchContext, privateInputs} = {},
  {researchPolicy, privatePolicy, enablePrivateEvaluation = false} = {}) {
  if (!time(researchPolicy?.nowMs) || typeof enablePrivateEvaluation !== 'boolean')
    throw Error('INVALID_RESEARCH_RISK_REVIEW_POLICY');
  const nowMs = researchPolicy.nowMs;
  let research;
  try {
    research = {status: 'LOCAL_PAIR_REVIEW_ONLY', data: buildResearchPairSummary(researchContext, researchPolicy)};
  } catch { research = blocked('RESEARCH_CONTEXT_OR_POLICY_REJECTED'); }

  // No fallback to market quotes, prior private results, guessed cash or an implicit private opt-in.
  let privateRisk = {status: 'DISABLED', data: null};
  if (enablePrivateEvaluation) {
    if (privatePolicy?.analysisPolicy?.nowMs !== nowMs)
      privateRisk = blocked('PRIVATE_REFERENCE_TIME_MISMATCH');
    else if (privateInputs === null || typeof privateInputs !== 'object' || Array.isArray(privateInputs))
      privateRisk = blocked('EXPLICIT_PRIVATE_INPUT_REQUIRED');
    else try {
      privateRisk = {status: 'LOCAL_DECLARED_INPUT_REVIEW_ONLY',
        data: structuredClone(runPrivateRiskWorkflow(privateInputs, privatePolicy))};
    } catch { privateRisk = blocked('PRIVATE_CONTEXT_OR_POLICY_REJECTED'); }
  }
  const cash = privateRisk.data?.summary?.components?.cashDeadlines;
  const cashAvailable = cash?.status === 'CALCULATED';
  // The public pair remains unchanged, including its unavailable private-risk fields.
  // This entire return is private; its existence never grants a public/scheduled consumer capability.
  return freeze({contractVersion: 1, classification: 'PRIVATE_COMBINED_RESULT_DO_NOT_PUBLISH',
    status: 'PARTIAL_LOCAL_REVIEW_ONLY', generatedAtMs: nowMs,
    references: {researchDecisionId: research.data?.decision_id ?? null,
      researchInputCutoffMs: research.data?.input_cutoff_ms ?? null,
      privateInputCutoffMs: privateRisk.data?.inputCutoffMs ?? null,
      privateGeneratedAtMs: privateRisk.data?.generatedAtMs ?? null},
    research, privateRisk,
    cashRisk: {status: cashAvailable ? 'LOCAL_CALCULATION_ONLY' : 'UNAVAILABLE',
      horizonAtMs: cashAvailable ? cash.horizonAtMs : null,
      shortfallKrw: cashAvailable ? cash.totals.accountShortfallSumKrw : null,
      earliestShortfallDueAtMs: cashAvailable ? cash.totals.earliestShortfallDueAtMs : null,
      overduePresent: cashAvailable ? cash.riskEvents.some(event => event.type === 'OVERDUE_OPEN_OBLIGATION') : null},
    recommendation: null, ranking: null, compositeScore: null, probability: null,
    tradeQuantities: null, collateralClearance: null, executionAllowed: false,
    operationalStatus: 'NOT_DEPLOYED_NOT_WATCH_READY',
    notificationDelivery: 'NOT_CONNECTED',
    limitations: ['RESEARCH_AND_PRIVATE_DATA_HAVE_SEPARATE_INPUTS_AND_QUALITY_GATES',
      'SUPPORTIVE_RESEARCH_DOES_NOT_RESOLVE_CASH_OR_COLLATERAL_RISK',
      'MISSING_RESEARCH_OR_QUOTES_DO_NOT_HIDE_INDEPENDENT_CASH_RISK',
      'DECLARED_INPUTS_NOT_BROKER_OR_SOURCE_VERIFICATION',
      'LOCAL_APPROVAL_CONTEXT_NOT_AUTHENTICATED_OPERATIONAL_ADMISSION',
      'LOCAL_EVENT_INTENTS_ARE_NOT_NOTIFICATIONS_OR_USER_ACTIONS']});
}
