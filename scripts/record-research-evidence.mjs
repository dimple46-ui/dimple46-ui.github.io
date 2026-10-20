// Explicit offline files only. Every mutation creates a NEW file; no in-place ledger or external writes.
import {openSync, fstatSync, readSync, closeSync, writeFileSync, fsyncSync, constants} from 'node:fs';
import {MAX_JOURNAL_BYTES, createResearchDecisionJournal, parseResearchDecisionJournal,
  appendResearchDecisionSnapshot, buildResearchDecisionHistory} from '../domain/research-decision-journal.mjs';
import {parseResearchPairDisplay, MAX_PAIR_DISPLAY_BYTES} from '../domain/research-pair-view.mjs';
import {createResearchPriceFollowup, appendResearchPriceFollowup,
  selectResearchPriceFollowups} from '../domain/research-price-followup.mjs';

const MAX_DOCUMENT_BYTES = MAX_JOURNAL_BYTES + 512 * 1024;
function read(path, maxBytes) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw Error('INVALID_FILE');
    const bytes = Buffer.alloc(maxBytes + 1); let length = 0, count;
    while (length < bytes.length && (count = readSync(fd, bytes, length, bytes.length - length, null)) > 0)
      length += count;
    if (length > maxBytes) throw Error('OVERSIZED_FILE');
    return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes.subarray(0, length));
  } finally { if (fd !== undefined) closeSync(fd); }
}
function document(path) {
  if (path === '-') return {schema_version: 1, journal: createResearchDecisionJournal(), price_followups: []};
  const value = JSON.parse(read(path, MAX_DOCUMENT_BYTES));
  if (!value || Object.keys(value).sort().join('|') !== 'journal|price_followups|schema_version' || value.schema_version !== 1)
    throw Error('INVALID_DOCUMENT');
  value.journal = parseResearchDecisionJournal(JSON.stringify(value.journal));
  selectResearchPriceFollowups(value.price_followups, value.journal, {asOfMs: 8640000000000000});
  return value;
}
function positiveTime(text) {
  if (!/^[1-9]\d*$/.test(text ?? '')) throw Error('INVALID_TIME');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) throw Error('INVALID_TIME');
  return value;
}
function save(path, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) throw Error('OVERSIZED_OUTPUT');
  let fd;
  try {
    // Exclusive creation: aliases/symlinks/existing outputs never overwrite prior evidence.
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, text); fsyncSync(fd);
  } finally { if (fd !== undefined) closeSync(fd); }
}
try {
  const [operation, ...args] = process.argv.slice(2);
  if (operation === 'snapshot') {
    if (args.length !== 5) throw Error('INVALID_ARGUMENTS');
    const [pairPath, previousPath, entryId, recordedAt, outputPath] = args;
    const value = document(previousPath);
    const pairSummary = parseResearchPairDisplay(read(pairPath, MAX_PAIR_DISPLAY_BYTES));
    value.journal = appendResearchDecisionSnapshot(value.journal,
      {entryId, recordedAtMs: positiveTime(recordedAt), pairSummary});
    save(outputPath, value);
    console.log(JSON.stringify({status: 'LOCAL_EVIDENCE_SAVED', snapshots: value.journal.entries.length,
      followups: value.price_followups.length, authentication: 'NOT_PROVEN', execution_allowed: false}));
  } else if (operation === 'followup') {
    if (args.length !== 3 || args[1] === '-') throw Error('INVALID_ARGUMENTS');
    const [inputPath, previousPath, outputPath] = args, value = document(previousPath);
    const input = JSON.parse(read(inputPath, 16384));
    if (!input || Object.keys(input).sort().join('|') !==
      'baseline|followup|followupId|recordedAtMs|snapshotEntryId|ticker') throw Error('INVALID_FOLLOWUP');
    const record = createResearchPriceFollowup(value.journal, input);
    value.price_followups = appendResearchPriceFollowup(value.price_followups, record, value.journal);
    save(outputPath, value);
    console.log(JSON.stringify({status: 'LOCAL_EVIDENCE_SAVED', snapshots: value.journal.entries.length,
      followups: value.price_followups.length, forecast_accuracy: null, execution_allowed: false}));
  } else if (operation === 'history') {
    if (args.length !== 3 || args[0] === '-' || !/^\d+$/.test(args[2])) throw Error('INVALID_ARGUMENTS');
    const [path, asOf, maxAge] = args, value = document(path), asOfMs = positiveTime(asOf);
    const history = buildResearchDecisionHistory(value.journal, {asOfMs, maxSummaryAgeMs: Number(maxAge)});
    const followups = selectResearchPriceFollowups(value.price_followups, value.journal, {asOfMs}).map(record => ({
      followup_id: record.followup_id, content_sha256: record.content_sha256,
      snapshot_entry_hash: record.snapshot_entry_hash, ticker: record.ticker, recorded_at_ms: record.recorded_at_ms,
      baseline_observed_at_ms: record.baseline.observed_at_ms, followup_observed_at_ms: record.followup.observed_at_ms,
      raw_price_change_percent: record.raw_price_change_percent,
      interval_selection: record.interval_selection, provenance: record.provenance,
      corporate_actions: record.corporate_actions, forecast_accuracy: null, total_return: null}));
    console.log(JSON.stringify({...history, price_followups: followups}));
  } else throw Error('INVALID_OPERATION');
} catch {
  console.error(JSON.stringify({status: 'REJECTED', code: 'RESEARCH_EVIDENCE_OPERATION_FAILED'}));
  process.exitCode = 1;
}
