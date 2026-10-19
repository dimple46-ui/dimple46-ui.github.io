// Explicit local summary file only. No network, identity creation, approval, persistence or provider operations.
import {openSync, fstatSync, readSync, closeSync, constants} from 'node:fs';
import {MAX_PAIR_DISPLAY_BYTES, parseResearchPairDisplay, buildResearchPairView, renderResearchPairText}
  from '../domain/research-pair-view.mjs';

try {
  const [path, nowText, ageText, format = 'text', ...extra] = process.argv.slice(2);
  if (!path || !/^[1-9]\d*$/.test(nowText ?? '') || !/^\d+$/.test(ageText ?? '') ||
    !['text','json'].includes(format) || extra.length) throw Error('INVALID_ARGUMENTS');
  let fd;
  let bytes;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_PAIR_DISPLAY_BYTES) throw Error('INVALID_INPUT_FILE');
    bytes = Buffer.alloc(MAX_PAIR_DISPLAY_BYTES + 1);
    let length = 0, count;
    while (length <= MAX_PAIR_DISPLAY_BYTES && (count = readSync(fd, bytes, length, bytes.length - length, null)) > 0)
      length += count;
    if (length > MAX_PAIR_DISPLAY_BYTES) throw Error('INPUT_TOO_LARGE');
    bytes = bytes.subarray(0, length);
  } finally { if (fd !== undefined) closeSync(fd); }
  const record = parseResearchPairDisplay(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes));
  const options = {nowMs: Number(nowText), maxSummaryAgeMs: Number(ageText)};
  console.log(format === 'json' ? JSON.stringify(buildResearchPairView(record, options)) : renderResearchPairText(record, options));
} catch {
  console.error(JSON.stringify({status: 'REJECTED', code: 'RESEARCH_PAIR_DISPLAY_FAILED'}));
  process.exitCode = 1;
}
