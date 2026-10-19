#!/usr/bin/env node
import {readLocalReplayJson} from './read-local-replay-json.mjs';
import {validateSignalReplay} from '../cloudflare/signal-replay-validator.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const inputPath = process.argv[2];
const engineGitSha = option('--engine-sha');
const generatedAt = option('--generated-at') || undefined;
if (!inputPath || !engineGitSha) {
  console.error('Usage: node scripts/validate-signal-replay.mjs <replay.json> --engine-sha <git-sha> [--generated-at <ISO>]');
  process.exitCode = 2;
} else {
  try {
    const replay = readLocalReplayJson(inputPath);
    const result = validateSignalReplay(replay, {engineGitSha, generatedAt});
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({status: 'FAIL', error:
      /^[A-Z_]{1,96}$/.test(error?.message ?? '') ? error.message : 'INVALID_REPLAY_INPUT'}));
    process.exitCode = 1;
  }
}
