import test from 'node:test';
import assert from 'node:assert/strict';
import {waitCandidateBuild} from '../scripts/wait-candidate-build.mjs';

const sha = 'a'.repeat(40), token = 'synthetic-not-a-real-token';
const run = (changes = {}) => ({id: 1, name: 'Workers Builds: market-intelligence-read-candidate',
  head_sha: sha, app: {id: 85455, slug: 'cloudflare-workers-and-pages'},
  status: 'completed', conclusion: 'success', ...changes});
function clock() {
  let time = 0;
  return {now: () => time, pause: async ms => { time += ms; }, timeoutMs: 30, intervalMs: 10};
}
test('waits for exact provider build without triggering deployment or exposing credentials', async () => {
  let calls = 0;
  const result = await waitCandidateBuild({sha, token, ...clock(), fetcher: async (url, options) => {
    assert.equal(url, `https://api.github.com/repos/dimple46-ui/dimple46-ui.github.io/commits/${sha}/check-runs?filter=latest&per_page=100`);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return Response.json({check_runs: [run(++calls === 1 ? {status: 'in_progress', conclusion: null} : {})]});
  }});
  assert.equal(calls, 2); assert.equal(result.runtimeValidation, 'PENDING');
  assert.doesNotMatch(JSON.stringify(result), /synthetic-not-a-real-token/);
});
test('wrong source, wrong SHA and other Worker success cannot satisfy build gate', async () => {
  let calls = 0;
  await assert.rejects(waitCandidateBuild({sha, token, ...clock(), fetcher: async () => {
    calls++; return Response.json({check_runs: [run({head_sha: 'b'.repeat(40)}),
      run({app: {id: 15368, slug: 'github-actions'}}), run({name: 'Workers Builds: market-relay'})]});
  }}), /CANDIDATE_BUILD_WAIT_TIMEOUT/);
  assert.equal(calls, 3);
});
test('latest failed or skipped build cannot fall back to an earlier successful run', async () => {
  for (const conclusion of ['failure', 'skipped', 'cancelled', 'timed_out', null]) {
    await assert.rejects(waitCandidateBuild({sha, token, ...clock(), fetcher: async () =>
      Response.json({check_runs: [run(), run({id: 2, conclusion})]})}), /CANDIDATE_BUILD_NOT_SUCCESSFUL/);
  }
});
test('permission rejection stops after one request; invalid inputs stop before network', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({}, {status: 403}); };
  await assert.rejects(waitCandidateBuild({sha, token, ...clock(), fetcher}), /GITHUB_CHECKS_HTTP_403/);
  assert.equal(calls, 1);
  await assert.rejects(waitCandidateBuild({sha, ...clock(), fetcher}), /GITHUB_TOKEN_UNAVAILABLE/);
  await assert.rejects(waitCandidateBuild({sha: '../main', token, fetcher}), /INVALID_EXPECTED_SHA/);
  await assert.rejects(waitCandidateBuild({sha, token, timeoutMs: 999999, fetcher}), /INVALID_WAIT_BOUNDS/);
  assert.equal(calls, 1);
});
test('malformed provider response cannot pass', async () => {
  await assert.rejects(waitCandidateBuild({sha, token, ...clock(), fetcher: async () =>
    Response.json({check_runs: null})}), /INVALID_CHECKS_RESPONSE/);
});
