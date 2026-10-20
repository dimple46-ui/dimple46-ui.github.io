// Descriptive price observations after a saved decision. No forecast scoring or portfolio returns.
import {researchHash} from './research-handoff.mjs';
import {verifyResearchDecisionJournal} from './research-decision-journal.mjs';
import {canonicalJson} from '../private/storage-contract.mjs';

const requireValue = ok => { if (!ok) throw Error('INVALID_RESEARCH_PRICE_FOLLOWUP'); };
const time = n => Number.isSafeInteger(n) && n > 0 && Number.isFinite(new Date(n).getTime());
const id = s => typeof s === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(s);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const quoteKeys = ['ticker','market','currency','venue','price_basis','price_krw','observed_at_ms',
  'available_at_ms','source_id','source_sha256'];
function quote(value, ticker, recordedAtMs) {
  try { value = JSON.parse(canonicalJson(value)); } catch { requireValue(false); }
  requireValue(value && Object.keys(value).sort().join('|') === [...quoteKeys].sort().join('|') &&
    value.ticker === ticker && value.market === 'KRX' && value.currency === 'KRW' &&
    value.venue === 'KRX_REGULAR' && value.price_basis === 'UNADJUSTED' &&
    Number.isSafeInteger(value.price_krw) && value.price_krw > 0 &&
    time(value.observed_at_ms) && time(value.available_at_ms) &&
    value.observed_at_ms <= value.available_at_ms && value.available_at_ms <= recordedAtMs &&
    id(value.source_id) && /^[a-f0-9]{64}$/.test(value.source_sha256 ?? ''));
  return Object.fromEntries(quoteKeys.map(key => [key, value[key]]));
}
export function createResearchPriceFollowup(journal, {followupId, snapshotEntryId, ticker,
  baseline, followup, recordedAtMs} = {}) {
  requireValue(verifyResearchDecisionJournal(journal) && id(followupId) && id(snapshotEntryId) &&
    ['005930','000660'].includes(ticker) && time(recordedAtMs));
  const entry = journal.entries.find(e => e.entry_id === snapshotEntryId);
  requireValue(entry && recordedAtMs >= entry.recorded_at_ms);
  const start = quote(baseline, ticker, recordedAtMs), end = quote(followup, ticker, recordedAtMs);
  requireValue(start.observed_at_ms >= entry.recorded_at_ms &&
    end.observed_at_ms > start.observed_at_ms && start.available_at_ms <= end.observed_at_ms &&
    start.source_id === end.source_id);
  const delta = end.price_krw - start.price_krw, percent = delta / start.price_krw * 100;
  requireValue(Number.isSafeInteger(delta) && Number.isFinite(percent));
  const body = {schema_version: 1, kind: 'POST_RECORD_PRICE_OBSERVATION', followup_id: followupId,
    snapshot_entry_id: snapshotEntryId, snapshot_entry_hash: entry.entry_hash,
    pair_decision_id: entry.pair_summary.decision_id, ticker, recorded_at_ms: recordedAtMs,
    baseline: start, followup: end, interval_ms: end.observed_at_ms - start.observed_at_ms,
    raw_price_change_krw: delta, raw_price_change_percent: percent,
    interval_selection: 'EXPLICIT_POST_HOC_NOT_PREREGISTERED_FORECAST_HORIZON',
    provenance: 'CALLER_DECLARED_SOURCE_REFERENCES_NOT_INDEPENDENT_VERIFICATION',
    corporate_actions: 'NOT_VERIFIED_RAW_PRICE_COMPARISON_ONLY',
    forecast_accuracy: null, total_return: null, portfolio_return: null,
    user_action: 'NOT_RECORDED', execution_allowed: false,
    operational_status: 'LOCAL_ONLY_NOT_DEPLOYED_NOT_WATCH_READY'};
  return freeze({...body, content_sha256: researchHash(body)});
}
export function verifyResearchPriceFollowup(journal, record) {
  try {
    const rebuilt = createResearchPriceFollowup(journal, {followupId: record.followup_id,
      snapshotEntryId: record.snapshot_entry_id, ticker: record.ticker,
      baseline: record.baseline, followup: record.followup, recordedAtMs: record.recorded_at_ms});
    return researchHash(rebuilt) === researchHash(record);
  } catch { return false; }
}
export function appendResearchPriceFollowup(records, record, journal) {
  requireValue(Array.isArray(records) && records.length <= 128 && verifyResearchPriceFollowup(journal, record));
  const ids = new Set(); let previousTime = 0;
  for (const item of records) {
    requireValue(verifyResearchPriceFollowup(journal, item) && !ids.has(item.followup_id) &&
      item.recorded_at_ms >= previousTime);
    ids.add(item.followup_id); previousTime = item.recorded_at_ms;
  }
  const existing = records.find(item => item.followup_id === record.followup_id);
  if (existing) { requireValue(researchHash(existing) === researchHash(record)); return freeze(structuredClone(records)); }
  requireValue(records.length < 128 && record.recorded_at_ms >= previousTime);
  return freeze([...structuredClone(records), structuredClone(record)]);
}
export function selectResearchPriceFollowups(records, journal, {asOfMs} = {}) {
  requireValue(time(asOfMs) && Array.isArray(records) && records.length <= 128 && verifyResearchDecisionJournal(journal));
  const ids = new Set(); let previousTime = 0;
  for (const record of records) {
    requireValue(verifyResearchPriceFollowup(journal, record) && !ids.has(record.followup_id) &&
      record.recorded_at_ms >= previousTime);
    ids.add(record.followup_id); previousTime = record.recorded_at_ms;
  }
  return freeze(structuredClone(records.filter(r => r.recorded_at_ms <= asOfMs)));
}
