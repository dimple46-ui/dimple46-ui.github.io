// Offline comparison only. Reuses existing approval/quality gates; never creates approval.
import {buildResearchMonitoringSummary} from './research-monitoring-summary.mjs';
import {researchHash} from './research-handoff.mjs';

const TICKERS = ['005930', '000660'];
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export function buildResearchPairSummary({session, packageIds, marketInputs, featureReplay,
  previousEventChanges = {}}, policy) {
  if (typeof session?.select !== 'function' || !packageIds ||
    Object.keys(packageIds).some(key => !TICKERS.includes(key)) ||
    TICKERS.some(ticker => packageIds[ticker] !== null &&
      (typeof packageIds[ticker] !== 'string' || !packageIds[ticker].trim())) ||
    (packageIds['005930'] !== null && packageIds['005930'] === packageIds['000660']))
    throw Error('INVALID_RESEARCH_PAIR_CONTEXT');
  if (!Number.isSafeInteger(policy?.nowMs) || policy.nowMs <= 0)
    throw Error('INVALID_RESEARCH_PAIR_TIME');

  const stocks = TICKERS.map(ticker => {
    const packageId = packageIds[ticker];
    // Capture one selection per stock at the same explicit as-of. No fallback to another stock.
    const selection = packageId === null
      ? {status: 'UNAVAILABLE', reason: 'NO_RESEARCH_PACKAGE'}
      : session.select({package_id: packageId, asOfMs: policy.nowMs});
    const target = selection.research?.package?.target;
    if (selection.research && (selection.status !== 'AVAILABLE' ||
      target?.ticker !== ticker || target?.market !== 'KRX' || target?.currency !== 'KRW'))
      throw Error('RESEARCH_PAIR_TARGET_MISMATCH');
    const summary = buildResearchMonitoringSummary({
      session: {select: () => selection}, packageId,
      marketInputs, featureReplay, previousEventChanges
    }, policy);
    return {ticker, market: 'KRX', currency: 'KRW', summary};
  });

  const events = stocks.flatMap(stock => stock.summary.monitoring.events);
  if (new Set(events.map(event => event.event_id)).size !== events.length)
    throw Error('RESEARCH_PAIR_EVENT_CONFLICT');
  const cutoffs = stocks.map(stock => stock.summary.input_cutoff_ms).filter(Number.isSafeInteger);
  const body = {
    contract_version: 1,
    status: 'LOCAL_PAIR_COMPARISON_ONLY',
    generated_at_ms: policy.nowMs,
    input_cutoff_ms: cutoffs.length ? Math.min(...cutoffs) : null,
    knowledge_as_of_ms: policy.nowMs,
    context_status: stocks.every(stock => stock.summary.long_term !== null &&
      stock.summary.short_term.status === 'LOCAL_REPLAY_ONLY')
      ? 'BOTH_RESEARCH_AND_LOCAL_SIGNALS_AVAILABLE' : 'PARTIAL_CONTEXT',
    stocks,
    comparison: stocks.map(({ticker, summary}) => ({
      ticker,
      decision_id: summary.decision_id,
      research_status: summary.research_status,
      research_unavailable_reason: summary.research_unavailable_reason,
      long_term_state: summary.long_term?.state ?? null,
      long_term_horizon: summary.long_term?.horizon ?? null,
      short_term_state: summary.short_term.state,
      short_term_status: summary.short_term.status,
      short_term_reason: summary.short_term.reason,
      cross_horizon_state: summary.cross_horizon_state,
      input_versions: summary.input_versions
    })),
    monitoring: {events, scheduler_access: 'NOT_CONNECTED_OR_VALIDATED', delivery: 'NOT_SENT'},
    private_risk: {status: 'UNAVAILABLE', reason: 'NO_PRIVATE_ADAPTER_CONNECTED',
      valuation: null, trade_quantities: null, withdrawable_cash: null},
    ranking: null,
    composite_score: null,
    recommended_action: null,
    probability: null,
    execution_allowed: false,
    operational_status: 'NOT_DEPLOYED_NOT_WATCH_READY',
    limitations: ['OFFLINE_COMPOSITION_NOT_CURRENT_MARKET_VALIDATION',
      'LONG_AND_SHORT_HORIZONS_REMAIN_SEPARATE', 'PAIR_SIGNALS_ARE_NOT_INDIVIDUAL_STOCK_DIRECTIONS',
      'LOCAL_APPROVAL_CONTEXT_NOT_DURABLE_AUTHENTICATION', 'NO_PERSONAL_SUITABILITY_OR_TRADE_SIZING']
  };
  return freeze({decision_id: 'local-research-pair:' + researchHash(body), ...body});
}

export function verifyResearchPairSummary(record) {
  try {
    const {decision_id, ...body} = record;
    return decision_id === 'local-research-pair:' + researchHash(body);
  } catch { return false; }
}
