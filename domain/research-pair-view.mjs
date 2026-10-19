// A bounded historical display, not authentication, approval intake or a decision engine.
import {verifyResearchPairSummary} from './research-pair-summary.mjs';
import {verifyResearchMonitoringSummary} from './research-monitoring-summary.mjs';

export const MAX_PAIR_DISPLAY_BYTES = 262144;
const time = value => Number.isSafeInteger(value) && value > 0 && Number.isFinite(new Date(value).getTime());
const requireValue = ok => { if (!ok) throw Error('INVALID_PAIR_DISPLAY_INPUT'); };
const longStates = new Set(['SUPPORTIVE', 'MIXED', 'ADVERSE']);
const shortStates = new Set(['ADVERSE_DESCRIPTIVE_SIGNALS', 'SUPPORTIVE_DESCRIPTIVE_SIGNALS',
  'MIXED_DESCRIPTIVE_SIGNALS', 'NO_ACTIVE_DESCRIPTIVE_SIGNALS']);
const qualities = new Set(['VERIFIED','RECENT_FETCH','UNVERIFIED_TIME','STALE_INPUT','MISSING_INPUT','UNKNOWN']);
const age = (at, now) => time(at) && at <= now ? now - at : null;

export function parseResearchPairDisplay(text) {
  requireValue(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= MAX_PAIR_DISPLAY_BYTES);
  let record;
  try { record = JSON.parse(text); } catch { throw Error('INVALID_PAIR_DISPLAY_INPUT'); }
  const queue = [[record, 0]];
  let count = 0;
  while (queue.length) {
    const [value, depth] = queue.pop();
    requireValue(++count <= 20000 && depth <= 24);
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) queue.push([child, depth + 1]);
    }
  }
  return record;
}

export function buildResearchPairView(record, {nowMs, maxSummaryAgeMs} = {}) {
  requireValue(time(nowMs) && Number.isSafeInteger(maxSummaryAgeMs) && maxSummaryAgeMs >= 0);
  requireValue(record?.contract_version === 1 && record.status === 'LOCAL_PAIR_COMPARISON_ONLY' &&
    record.operational_status === 'NOT_DEPLOYED_NOT_WATCH_READY' && record.execution_allowed === false &&
    record.recommended_action === null && record.trade_quantities == null && record.ranking === null &&
    record.probability === null && record.composite_score === null &&
    time(record.generated_at_ms) && record.generated_at_ms <= nowMs &&
    record.knowledge_as_of_ms === record.generated_at_ms &&
    (record.input_cutoff_ms === null || time(record.input_cutoff_ms) && record.input_cutoff_ms <= record.generated_at_ms) &&
    Array.isArray(record.stocks) && record.stocks.length === 2);
  requireValue(verifyResearchPairSummary(record));
  const stale = nowMs - record.generated_at_ms > maxSummaryAgeMs;
  const rows = record.stocks.map((stock, index) => {
    const ticker = ['005930', '000660'][index], summary = stock?.summary;
    requireValue(stock?.ticker === ticker && stock.market === 'KRX' && stock.currency === 'KRW' &&
      summary?.generated_at_ms === record.generated_at_ms && summary.knowledge_as_of_ms === record.knowledge_as_of_ms &&
      summary.status === 'LOCAL_COMPOSITION_ONLY' && summary.operational_status === 'NOT_DEPLOYED_NOT_WATCH_READY' &&
      verifyResearchMonitoringSummary(summary));
    requireValue(summary.private_risk?.status === 'UNAVAILABLE' && summary.private_risk.valuation === null &&
      summary.private_risk.trade_quantities === null && summary.private_risk.collateral_clearance === null);
    const researchAvailable = summary.research_status === 'AVAILABLE';
    requireValue(researchAvailable ? longStates.has(summary.long_term?.state) &&
      ['1M','3M','6M','12M'].includes(summary.long_term?.horizon) : summary.long_term === null);
    requireValue(['UNAVAILABLE','LOCAL_REPLAY_ONLY'].includes(summary.short_term?.status));
    requireValue(summary.short_term.status === 'UNAVAILABLE' ? summary.short_term.state === null :
      shortStates.has(summary.short_term.state) && researchAvailable);
    const observation = summary.market?.observation, features = summary.market?.features;
    requireValue(observation && features && qualities.has(features.quality));
    for (const cutoff of [observation.observedAtMs, observation.inputCutoffMs, features.inputCutoffMs])
      requireValue(cutoff === null || time(cutoff) && cutoff <= record.generated_at_ms);
    // Project only fixed enum/status/time/hash fields. Never render report prose, URLs, event text or private data.
    return {
      ticker, name: index === 0 ? '삼성전자' : 'SK하이닉스',
      display_status: stale ? 'STALE_SUMMARY_SUPPRESSED' : 'HISTORICAL_AS_OF_ONLY',
      long_term_state: stale ? null : summary.long_term?.state ?? null,
      long_term_horizon: stale ? null : summary.long_term?.horizon ?? null,
      research_available_at_generation: researchAvailable,
      short_term_state: stale ? null : summary.short_term.state,
      short_term_status: stale ? 'UNAVAILABLE' : summary.short_term.status,
      observation_age_at_display_ms: age(observation.observedAtMs, nowMs),
      feature_age_at_display_ms: age(features.inputCutoffMs, nowMs),
      feature_quality_at_generation: features.quality,
      decision_id: summary.decision_id,
      valuation: null, trade_quantities: null
    };
  });
  return {
    schema_version: 1, status: 'LOCAL_DISPLAY_ONLY',
    decision_id: record.decision_id,
    generated_at_ms: record.generated_at_ms, displayed_at_ms: nowMs,
    summary_age_ms: nowMs - record.generated_at_ms, max_summary_age_ms: maxSummaryAgeMs,
    temporal_scope: 'STORED_AS_OF_NOT_REEVALUATED',
    integrity: 'HASH_MATCH_NOT_AUTHENTICATION_OR_APPROVAL_PROOF',
    rows, operational: 'NOT_DEPLOYED_NOT_WATCH_READY', execution_allowed: false,
    private_risk: 'UNAVAILABLE', notifications: 'NOT_SENT'
  };
}

export function renderResearchPairText(record, options) {
  const view = buildResearchPairView(record, options);
  const at = new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'}).format(view.generated_at_ms);
  const states = {SUPPORTIVE: '우호적', MIXED: '상반된 근거', ADVERSE: '부정적',
    ADVERSE_DESCRIPTIVE_SIGNALS: '약세 신호', SUPPORTIVE_DESCRIPTIVE_SIGNALS: '강세 신호',
    MIXED_DESCRIPTIVE_SIGNALS: '상충 신호', NO_ACTIVE_DESCRIPTIVE_SIGNALS: '방향성 분류 없음'};
  const qualityLabels = {VERIFIED: '검증됨(생성 당시)', RECENT_FETCH: '최근 수집·거래시각 미검증',
    UNVERIFIED_TIME: '거래시각 미검증', STALE_INPUT: '오래된 입력', MISSING_INPUT: '누락 입력', UNKNOWN: '확인 불가'};
  const elapsed = value => value === null ? '확인 불가' : `${(value / 1000).toFixed(1)}초`;
  return [`삼성전자·SK하이닉스 비교 — 로컬 저장 결과`,
    `분석 생성 시각: ${at} KST / 경과: ${elapsed(view.summary_age_ms)}`,
    '현재 재평가·실제 승인 인증·운영 검증 결과가 아닙니다.',
    ...view.rows.map(row => `${row.name} (${row.ticker}) | ` +
      `${row.display_status === 'STALE_SUMMARY_SUPPRESSED' ? '표시 허용시간 초과·판단 표시 중단' : '저장 당시의 판단'} | ` +
      `장기: ${states[row.long_term_state] ?? '확인 불가'} (${row.long_term_horizon?.replace('M', '개월') ?? '미지원'}) | ` +
      `단기: ${states[row.short_term_state] ?? '확인 불가'} | Feature 품질: ${qualityLabels[row.feature_quality_at_generation]} | ` +
      `관측 경과: ${elapsed(row.observation_age_at_display_ms)} / Feature 경과: ${elapsed(row.feature_age_at_display_ms)}`),
    '개인 평가액·매매수량: 확인 불가 / 자동 실행 없음 / 예약·알림 미연결',
    `결과 ID: ${view.decision_id}`].join('\n');
}
