import {pathToFileURL} from 'node:url';

const REPOSITORY = 'dimple46-ui/dimple46-ui.github.io';
const CHECK_NAME = 'Workers Builds: market-intelligence-read-candidate';
const APP_ID = 85455;
const APP_SLUG = 'cloudflare-workers-and-pages';
const error = code => { throw new Error(code); };

// GET-only build receipt lookup. No Cloudflare API token, deploy, retry-build or rollback call.
export async function waitCandidateBuild({sha, token, fetcher = fetch, now = Date.now,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 240000,
  intervalMs = 10000}) {
  if (!/^[a-f0-9]{40}$/.test(sha || '')) error('INVALID_EXPECTED_SHA');
  if (typeof token !== 'string' || !token) error('GITHUB_TOKEN_UNAVAILABLE');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 240000 ||
      !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 10000)
    error('INVALID_WAIT_BOUNDS');
  const deadline = now() + timeoutMs;
  const url = `https://api.github.com/repos/${REPOSITORY}/commits/${sha}/check-runs?filter=latest&per_page=100`;
  for (let attempt = 0; attempt < 30 && now() < deadline; attempt++) {
    const response = await fetcher(url, {method: 'GET', redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - now()))),
      headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`}});
    if (!response.ok) error(`GITHUB_CHECKS_HTTP_${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.check_runs)) error('INVALID_CHECKS_RESPONSE');
    if (now() >= deadline) error('CANDIDATE_BUILD_WAIT_TIMEOUT');
    const check = body.check_runs.filter(run => run.name === CHECK_NAME && run.head_sha === sha &&
      run.app?.id === APP_ID && run.app?.slug === APP_SLUG && Number.isSafeInteger(run.id))
      .sort((a, b) => b.id - a.id)[0];
    if (check?.status === 'completed') {
      if (check.conclusion !== 'success') error('CANDIDATE_BUILD_NOT_SUCCESSFUL');
      return {status: 'PASS', evidence: 'PROVIDER_BUILD_CHECK', repository: REPOSITORY,
        sha, checkRunId: check.id, conclusion: 'success', runtimeValidation: 'PENDING',
        deployment: 'NOT_PERFORMED_BY_CHECKER'};
    }
    await pause(Math.min(intervalMs, Math.max(0, deadline - now())));
  }
  error('CANDIDATE_BUILD_WAIT_TIMEOUT');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await waitCandidateBuild({sha: process.env.EXPECTED_CANDIDATE_SHA,
      token: process.env.GITHUB_TOKEN}), null, 2));
  } catch (cause) {
    const code = /^[A-Z0-9_]+$/.test(cause.message) ? cause.message : 'BUILD_CHECK_FAILED';
    console.error(JSON.stringify({status: code === 'GITHUB_TOKEN_UNAVAILABLE' ? 'BLOCKED_BY_AUTH' : 'FAIL',
      code, deployment: 'NOT_PERFORMED'}));
    process.exitCode = 1;
  }
}
