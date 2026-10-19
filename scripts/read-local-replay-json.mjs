// File-only CLI input. No network, writes or changes to replay semantics.
import {openSync, fstatSync, readSync, closeSync, constants} from 'node:fs';
export const MAX_REPLAY_INPUT_BYTES = 2 * 1024 * 1024;
export function readLocalReplayJson(path) {
 let fd;
 try {
  fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  const stat = fstatSync(fd);
  if (!stat.isFile()) throw Error('INVALID_REPLAY_FILE');
  if (stat.size > MAX_REPLAY_INPUT_BYTES) throw Error('REPLAY_INPUT_TOO_LARGE');
  const bytes = Buffer.alloc(MAX_REPLAY_INPUT_BYTES + 1);
  let length = 0, count;
  while (length < bytes.length && (count = readSync(fd, bytes, length, bytes.length - length, null)) > 0)
   length += count;
  if (length > MAX_REPLAY_INPUT_BYTES) throw Error('REPLAY_INPUT_TOO_LARGE');
  return JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes.subarray(0, length)));
 } finally { if (fd !== undefined) closeSync(fd); }
}
