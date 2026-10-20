// Offline evidence journal. Hashes detect accidental changes; they are not identity or approval proof.
import {researchHash} from './research-handoff.mjs';
import {buildResearchPairView, parseResearchPairDisplay} from './research-pair-view.mjs';

export const MAX_JOURNAL_BYTES = 4 * 1024 * 1024;
export const MAX_JOURNAL_ENTRIES = 128;
const fail = () => { throw Error('INVALID_RESEARCH_DECISION_JOURNAL'); };
const requireValue = ok => { if (!ok) fail(); };
const time = n => Number.isSafeInteger(n) && n > 0 && Number.isFinite(new Date(n).getTime());
const id = s => typeof s === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(s);
const hash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const exactKeys = (value, keys) => value && !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function copyJson(value, maxBytes = MAX_JOURNAL_BYTES) {
  // The public functions accept JSON data only, with finite numbers and bounded traversal.
  const active = new Set(); let count = 0;
  function visit(v, depth) {
    requireValue(++count <= 200000 && depth <= 32);
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number') { requireValue(Number.isFinite(v)); return; }
    requireValue(typeof v === 'object' && !active.has(v) &&
      (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
    active.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    const keys = Object.keys(v);
    requireValue(Reflect.ownKeys(v).length === keys.length + (Array.isArray(v) ? 1 : 0));
    if (Array.isArray(v)) requireValue(keys.length === v.length);
    for (const key of keys) {
      const d = descriptors[key];
      requireValue(d && d.enumerable && Object.hasOwn(d, 'value') &&
        !['__proto__','constructor','prototype'].includes(key));
      visit(d.value, depth + 1);
    }
    active.delete(v);
  }
  visit(value, 0);
  const text = JSON.stringify(value);
  requireValue(Buffer.byteLength(text, 'utf8') <= maxBytes);
  return JSON.parse(text);
}
function pair(value, recordedAtMs) {
  const detached = parseResearchPairDisplay(JSON.stringify(value));
  requireValue(time(detached?.generated_at_ms) && detached.generated_at_ms <= recordedAtMs);
  buildResearchPairView(detached, {nowMs: detached.generated_at_ms, maxSummaryAgeMs: 0});
  return detached;
}
function checkedJournal(value) {
  const journal = copyJson(value);
  requireValue(exactKeys(journal, ['schema_version', 'status', 'entries']) &&
    journal.schema_version === 1 && journal.status === 'LOCAL_EVIDENCE_ONLY' &&
    Array.isArray(journal.entries) && journal.entries.length <= MAX_JOURNAL_ENTRIES);
  const ids = new Set(), decisions = new Set(); let previousHash = null, previousTime = 0;
  for (const entry of journal.entries) {
    requireValue(exactKeys(entry, ['schema_version', 'kind', 'entry_id', 'recorded_at_ms',
      'previous_entry_hash', 'pair_summary', 'entry_hash']) && entry.schema_version === 1 &&
      entry.kind === 'RESEARCH_PAIR_SNAPSHOT' && id(entry.entry_id) && !ids.has(entry.entry_id) &&
      time(entry.recorded_at_ms) && entry.recorded_at_ms >= previousTime &&
      entry.previous_entry_hash === previousHash && hash(entry.entry_hash));
    const {entry_hash, ...body} = entry;
    requireValue(researchHash(body) === entry_hash);
    const summary = pair(entry.pair_summary, entry.recorded_at_ms);
    requireValue(!decisions.has(summary.decision_id));
    ids.add(entry.entry_id); decisions.add(summary.decision_id);
    previousTime = entry.recorded_at_ms; previousHash = entry_hash;
  }
  return journal;
}
export function createResearchDecisionJournal() {
  return freeze({schema_version: 1, status: 'LOCAL_EVIDENCE_ONLY', entries: []});
}
export function parseResearchDecisionJournal(text) {
  requireValue(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= MAX_JOURNAL_BYTES);
  let value; try { value = JSON.parse(text); } catch { fail(); }
  return freeze(checkedJournal(value));
}
export function verifyResearchDecisionJournal(value) {
  try { checkedJournal(value); return true; } catch { return false; }
}
export function appendResearchDecisionSnapshot(value, {entryId, recordedAtMs, pairSummary} = {}) {
  const journal = checkedJournal(value);
  requireValue(id(entryId) && time(recordedAtMs));
  const summary = pair(copyJson(pairSummary), recordedAtMs);
  const existing = journal.entries.find(entry => entry.entry_id === entryId);
  if (existing) {
    requireValue(existing.recorded_at_ms === recordedAtMs &&
      researchHash(existing.pair_summary) === researchHash(summary));
    return freeze(journal); // An exact retry is a no-op, never a second receipt.
  }
  requireValue(journal.entries.length < MAX_JOURNAL_ENTRIES &&
    !journal.entries.some(entry => entry.pair_summary.decision_id === summary.decision_id) &&
    (journal.entries.length === 0 || recordedAtMs >= journal.entries.at(-1).recorded_at_ms));
  const body = {schema_version: 1, kind: 'RESEARCH_PAIR_SNAPSHOT', entry_id: entryId,
    recorded_at_ms: recordedAtMs, previous_entry_hash: journal.entries.at(-1)?.entry_hash ?? null,
    pair_summary: summary};
  journal.entries.push({...body, entry_hash: researchHash(body)});
  return freeze(checkedJournal(journal));
}
export function buildResearchDecisionHistory(value, {asOfMs, maxSummaryAgeMs} = {}) {
  requireValue(time(asOfMs) && Number.isSafeInteger(maxSummaryAgeMs) && maxSummaryAgeMs >= 0);
  const journal = checkedJournal(value);
  return freeze({schema_version: 1, status: 'LOCAL_HISTORICAL_EVIDENCE_ONLY', as_of_ms: asOfMs,
    integrity: 'HASH_CHAIN_NOT_AUTHENTICATION_OR_APPROVAL_PROOF',
    snapshots: journal.entries.filter(entry => entry.recorded_at_ms <= asOfMs).map(entry => ({
      entry_id: entry.entry_id, entry_hash: entry.entry_hash, recorded_at_ms: entry.recorded_at_ms,
      view: buildResearchPairView(entry.pair_summary, {nowMs: asOfMs, maxSummaryAgeMs})
    })),
    approval_status: 'NOT_REEVALUATED', user_actions: 'NOT_RECORDED',
    forecast_accuracy: null, portfolio_return: null, execution_allowed: false,
    operational_status: 'NOT_DEPLOYED_NOT_WATCH_READY'});
}
