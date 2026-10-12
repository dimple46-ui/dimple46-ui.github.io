import {pathToFileURL} from 'node:url';

export const CANDIDATES = ['market-feature-validation', 'market-intelligence-read-candidate'];
export function summarizeSettings(worker, settings) {
  if (!CANDIDATES.includes(worker)) throw new Error('PRODUCTION_TARGET_FORBIDDEN');
  const bindings = settings.bindings || [];
  return {worker, compatibilityDate: settings.compatibility_date ?? null,
    bindings: bindings.map(b => ({name: b.name, type: b.type,
      ...(b.type === 'd1' ? {databaseId: b.id ?? b.database_id ?? null} : {})})),
    // No plaintext variable or Secret values are retained.
    requiredSecretPresent: bindings.some(b => b.type === 'secret_text' &&
      b.name === (worker === CANDIDATES[0] ? 'VALIDATION_TOKEN' : 'INTELLIGENCE_READ_TOKEN')),
    historyBindingPresent: bindings.some(b => b.name === 'MARKET_HISTORY' && b.type === 'd1'),
    rateLimitBindingPresent: bindings.some(b => b.type === 'ratelimit'),
    writeEnabled: worker === CANDIDATES[0] ?
      bindings.some(b => b.name === 'FEATURE_V2_WRITE_ENABLED' && b.text === 'true') : null};
}
export async function auditCandidateAccess({accountId, token, fetcher = fetch}) {
  if (!/^[a-f0-9]{32}$/i.test(accountId || '') || !token) throw new Error('CLOUDFLARE_CREDENTIALS_UNAVAILABLE');
  const results = [];
  for (const worker of CANDIDATES) {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${worker}/settings`, {
      method: 'GET', headers: {Authorization: `Bearer ${token}`},
      redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`CLOUDFLARE_ACCESS_${response.status}`);
    const body = await response.json();
    if (!body.success || !body.result) throw new Error('CLOUDFLARE_SETTINGS_UNAVAILABLE');
    results.push(summarizeSettings(worker, body.result));
  }
  return {status: 'READ_ACCESS_VERIFIED', candidates: results,
    deployPermission: 'NOT_TESTED', d1Permission: 'BINDING_IS_NOT_READ_ONLY_ACL', deployment: 'NOT_PERFORMED'};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await auditCandidateAccess({accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN}), null, 2));
  } catch (error) {
    console.error(JSON.stringify({status: 'BLOCKED', code: /^[A-Z0-9_]+$/.test(error.message) ?
      error.message : 'CLOUDFLARE_AUDIT_FAILED', deployment: 'NOT_PERFORMED'}));
    process.exitCode = 1;
  }
}
