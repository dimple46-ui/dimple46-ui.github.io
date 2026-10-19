import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {emitKeypressEvents} from 'node:readline';
import {assertReadMeta} from './check-candidate.mjs';

const ACCOUNT = '1b468964b73ed9c87a5682285ff0db30';
const WORKER = 'market-feature-validation';
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${WORKER}`;
const ORIGIN = 'https://market-feature-validation.dimple3691.workers.dev';
const ENGINE = '48b3b04a5f2747e225f81097866aa8c05a85b38e';
const CORE = 'f21b700675c8ca0cb312b79db65af559dafdef09e896cbbeb953677bdfdb5d2a';
const FLAG = 'FEATURE_V2_WRITE_ENABLED';
const DATABASE = 'c9902dac-8d27-47ec-80b5-73b2b1339535';
const REQUIRED = {FEATURE_ENGINE_GIT_SHA:'plain_text', [FLAG]:'plain_text',
  MARKET_HISTORY:'d1', VALIDATION_TOKEN:'secret_text'};
class TrialError extends Error { constructor(code) { super(code); this.code = code; } }
function check(value, code) { if (!value) throw new TrialError(code); }
function safeCode(error) { return error instanceof TrialError ? error.code : 'UNCLASSIFIED_FAILURE'; }
export function trialPlan() {
  return {mode:'PLAN_ONLY_NO_CREDENTIAL_OR_NETWORK_ACCESS', account:ACCOUNT, worker:WORKER,
    expectedEngineSha:ENGINE, maxFeaturePostAttempts:1, maxNewImmutableRows:1,
    purpose:'PERSISTENCE_CONTRACT_ONLY_NOT_LIVE_MARKET_READINESS',
    sequence:['LOCAL_KEYCHAIN_OAUTH_TO_MEMORY','READ_PREFLIGHT','ENABLE','SINGLE_POST_WITH_READBACK',
      'FINALLY_DISABLE','VERIFY_DISABLED'],
    approvalRequired:'Temporary candidate flag change, at most one shared-D1 feature row, local in-memory credential use',
    excluded:['Production relay','main merge','Secret changes','research admission','personal finance','Watch','Access','payment'],
    onePostLimitScope:'This process only; no server-side lock against other authorized callers during the enabled interval',
    failureLimit:'Network loss, process kill or power loss can prevent disable; independent emergency recovery may be necessary.'};
}
function bindings(settings, enabled, initial = false) {
  const b = settings?.bindings;
  check(Array.isArray(b) && new Set(b.map(x=>x.name)).size === b.length, 'BINDINGS_INVALID');
  for (const [name,type] of Object.entries(REQUIRED))
    check(b.find(x=>x.name===name)?.type===type, 'BINDING_CONTRACT_CHANGED');
  if (initial) {
    check(b.find(x=>x.name==='MARKET_HISTORY').id===DATABASE, 'DATABASE_BINDING_CHANGED');
    check(b.find(x=>x.name===FLAG).text==='false', 'INITIAL_WRITES_NOT_DISABLED');
    check(b.find(x=>x.name==='FEATURE_ENGINE_GIT_SHA').text===ENGINE, 'ENGINE_CHANGED');
  }
  // Never reconstruct, print or send secret values; inherit every unrelated binding by name.
  return b.map(x=>x.name===FLAG ? {name:FLAG,type:'plain_text',text:String(enabled)}
    : {name:x.name,type:'inherit'});
}
function flag(settings) { return settings?.bindings?.find(x=>x.name===FLAG)?.text; }
function storedReceipt(row) {
  check(row?.mode==='CANDIDATE_COMPACT_WRITE' && row.candidateSha256===CORE && row.metadataScope==='STORED_FEATURE_RUN' && row.featureVersion===2 &&
    ['INSERTED','EXISTS','STORED_WRITE_OUTCOME_UNKNOWN'].includes(row.status), 'WRITE_RECEIPT_INVALID');
  const keys=['slotMs','featureVersion','engineGitSha','engineSourceSha256','observedAtMs',
    'generatedAtMs','inputCutoffMs','qualityCeiling','generationStatus','compactFeaturesBytes'];
  for (const key of keys) check(row[key]===row.stored?.[key], 'STORED_PROVENANCE_MISMATCH');
  check(Number.isSafeInteger(row.slotMs) && row.slotMs>0 &&
    Number.isSafeInteger(row.inputCutoffMs) && row.inputCutoffMs>=row.observedAtMs &&
    Number.isSafeInteger(row.generatedAtMs) && row.generatedAtMs>=row.inputCutoffMs &&
    Number.isSafeInteger(row.compactFeaturesBytes) && row.compactFeaturesBytes>0 && /^[a-f0-9]{7,64}$/i.test(row.engineGitSha) &&
    /^[a-f0-9]{64}$/i.test(row.engineSourceSha256), 'STORED_IDENTITY_INVALID');
  check(row.computed?.engineGitSha===ENGINE && row.computed?.engineSourceSha256===CORE &&
    row.computed?.slotMs===row.slotMs, 'COMPUTED_IDENTITY_INVALID');
  if (row.status==='INSERTED') check(row.engineGitSha===ENGINE && row.engineSourceSha256===CORE,
    'INSERTED_IDENTITY_INVALID');
  assertReadMeta(row.queryMeta);
  assertReadMeta(row.verifyMeta);
  const changes=row.writeMeta?.changes ?? row.writeMeta?.rowsWritten;
  check(row.status==='INSERTED' ? changes===1 : row.status==='EXISTS' ? changes===0 : changes==null,
    'INSERT_COUNT_INVALID');
  return {status:row.status,...Object.fromEntries(keys.map(k=>[k,row[k]])),
    persistenceProof:'SINGLE_POST_WITH_HANDLER_DATABASE_READBACK', liveMarketGate:'UNCHANGED'};
}

// Test seam substitutes HTTP transport only; there is no synthetic approval or storage service.
export async function runStorageTrial({oauthToken,validationToken,approved=false,fetcher=fetch,signal,recoveryOnly=false}) {
  check(approved===true, 'EXPLICIT_TRIAL_APPROVAL_REQUIRED');
  check(typeof oauthToken==='string' && oauthToken.length>0 &&
    (recoveryOnly || typeof validationToken==='string' && validationToken.trim().length>0), 'LOCAL_CREDENTIAL_UNAVAILABLE');
  let enableAttempted=false, postAttempted=false, restoreVerified=false, receipt=null, failure=null;
  async function json(url, method, body, recovery=false) {
    const admin=url.startsWith(API+'/');
    const requestSignal=recovery ? AbortSignal.timeout(15000)
      : signal ? AbortSignal.any([signal,AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
    let response;
    try { response=await fetcher(url,{method,body,redirect:'error',signal:requestSignal,
      headers:{Authorization:`Bearer ${admin?oauthToken:validationToken}`}}); }
    catch { throw new TrialError(recovery?'RECOVERY_NETWORK_FAILURE':'NETWORK_OR_TIMEOUT_FAILURE'); }
    check(response.status===200, `${recovery?'RECOVERY_':''}HTTP_${response.status}`);
    let data;
    try { data=await response.json(); } catch { throw new TrialError('INVALID_JSON_RESPONSE'); }
    if(admin) { check(data.success===true, 'ADMIN_REQUEST_FAILED'); return data.result; }
    return data;
  }
  const settings=(recovery=false)=>json(API+'/settings','GET',undefined,recovery);
  async function setFlag(value, current, recovery=false) {
    const form=new FormData();
    form.set('settings',new Blob([JSON.stringify({bindings:bindings(current,value)})],{type:'application/json'}));
    await json(API+'/settings','PATCH',form,recovery);
  }
  try {
    if (recoveryOnly) {
      enableAttempted=true; // Explicit recovery performs only finally-disable/readback.
    } else {
    const before=await settings(); bindings(before,false,true);
    const replay=await json(ORIGIN+'/','GET');
    check(replay.candidateSha256===CORE, 'FEATURE_CORE_CHANGED');
    assertReadMeta(replay.queryMeta);
    check(Number.isFinite(Date.parse(replay.observedAt)) && typeof replay.validation?.qualityCeiling==='string',
      'READ_PREFLIGHT_INVALID');
    // Re-read immediately before enable. No deployment or credential change is performed here.
    const current=await settings(); bindings(current,false,true);
    enableAttempted=true; // A failed/timeout PATCH may already have applied remotely.
    await setFlag(true,current);
    check(flag(await settings())==='true', 'ENABLE_NOT_CONFIRMED');
    check(!signal?.aborted, 'INTERRUPTED_BEFORE_POST');
    postAttempted=true; // Never retry, including an ambiguous network outcome.
    receipt=storedReceipt(await json(ORIGIN+'/feature-runs','POST'));
    }
  } catch(error) { failure=safeCode(error); }
  finally {
    if(enableAttempted) {
      try {
        const current=await settings(true);
        // Restore only the write flag on current settings, never deploy a historical Worker version.
        await setFlag(false,current,true);
        check(flag(await settings(true))==='false', 'DISABLE_NOT_CONFIRMED');
        restoreVerified=true;
      } catch { restoreVerified=false; }
    }
  }
  return {status:enableAttempted&&!restoreVerified?'RECOVERY_REQUIRED':failure?'FAILED':'PASS',
    failure,enableAttempted,postAttempted,restoreVerified,
    restoreEvidenceScope:'CONTROL_PLANE_SETTING_READBACK_NOT_RUNTIME_403_PROBE',receipt,
    retryPolicy:'DO_NOT_REPEAT_POST_AFTER_AMBIGUOUS_FAILURE',scope:'CANDIDATE_PERSISTENCE_ONLY'};
}

export async function readLocalOAuth({env=process.env,exec=promisify(execFile)}={}) {
  for(const name of ['CLOUDFLARE_API_TOKEN','CF_API_TOKEN','CLOUDFLARE_API_KEY','CF_API_KEY',
    'CLOUDFLARE_EMAIL','CF_EMAIL','WRANGLER_API_TOKEN']) check(!env[name], 'ALTERNATE_ADMIN_CREDENTIAL_PRESENT');
  const childEnv={...env,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_SEND_METRICS:'false'};
  delete childEnv.VALIDATION_TOKEN;
  let stdout;
  try { ({stdout}=await exec('npx',['--yes','wrangler@4.151.2','auth','token','--json'],
    {env:childEnv,timeout:60000,maxBuffer:65536,windowsHide:true})); }
  catch { throw new TrialError('LOCAL_OAUTH_READ_FAILED'); } // Never echo child stdout/stderr/error.
  let auth;
  try { auth=JSON.parse(stdout); } catch { throw new TrialError('LOCAL_OAUTH_FORMAT_INVALID'); }
  check(auth?.type==='oauth' && typeof auth.token==='string' && auth.token.length>0, 'LOCAL_OAUTH_REQUIRED');
  return auth.token; // In memory only, never console, URL, file, CLI argument or remote secret.
}
async function hiddenToken() {
  check(process.stdin.isTTY && process.stdout.isTTY, 'INTERACTIVE_MAC_TERMINAL_REQUIRED');
  process.stdout.write('Existing candidate VALIDATION_TOKEN (hidden; Enter to continue): ');
  emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const done=()=>{process.stdin.off('keypress',key);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
    const key=(text,k={})=>{
      if(k.ctrl&&k.name==='c') {done();reject(new TrialError('CANCELLED_BEFORE_EXECUTION'));}
      else if(k.name==='return') {done();resolve(value);}
      else if(k.name==='backspace') value=value.slice(0,-1);
      else if(text&&!k.ctrl&&!k.meta&&!/[\x00-\x1f\x7f]/.test(text)) value+=text;
    };
    process.stdin.on('keypress',key);
  });
}
export async function main(args=process.argv.slice(2)) {
  if(args.length===0 || args.length===1&&args[0]==='--plan') {console.log(JSON.stringify(trialPlan(),null,2));return;}
  const recoveryOnly=args.length===2&&args[0]==='--disable-only'&&args[1]==='--approved-candidate-recovery';
  check(recoveryOnly || args.length===2&&args[0]==='--execute'&&args[1]==='--approved-one-feature-row', 'INVALID_ARGUMENTS');
  check(process.platform==='darwin', 'MAC_ONLY_EXECUTION');
  const validationToken=recoveryOnly?undefined:await hiddenToken();
  const oauthToken=await readLocalOAuth();
  const controller=new AbortController();
  const interrupt=()=>controller.abort();
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  try {
    const result=await runStorageTrial({oauthToken,validationToken,approved:true,signal:controller.signal,recoveryOnly});
    console.log(JSON.stringify(result,null,2));
    process.exitCode=result.status==='PASS'?0:result.status==='RECOVERY_REQUIRED'?2:1;
  } finally {process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(error=>{console.error(JSON.stringify({status:'FAILED_BEFORE_TRIAL',code:safeCode(error)}));process.exitCode=1;});
