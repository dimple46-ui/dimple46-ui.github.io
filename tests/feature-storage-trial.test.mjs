import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runStorageTrial,readLocalOAuth,trialPlan} from '../scripts/trial-feature-storage.mjs';

const engine=trialPlan().expectedEngineSha;
const core='f21b700675c8ca0cb312b79db65af559dafdef09e896cbbeb953677bdfdb5d2a';
const meta={rowsWritten:0,rowsRead:1};
function server({failure,existing=false,writeInitially=false}={}) {
  let enabled=writeInitially;let enabledControlReads=0;const calls=[];
  const b=()=>[
    {name:'FEATURE_V2_WRITE_ENABLED',type:'plain_text',text:String(enabled)},
    {name:'FEATURE_ENGINE_GIT_SHA',type:'plain_text',text:engine},
    {name:'MARKET_HISTORY',type:'d1',id:'c9902dac-8d27-47ec-80b5-73b2b1339535'}, {name:'VALIDATION_TOKEN',type:'secret_text'},
    {name:'EXTRA_BINDING',type:'plain_text',text:'preserve-this'}];
  const fetcher=async(url,options)=>{
    const method=options.method;calls.push({url,method});
    assert.equal(options.redirect,'error');
    const admin=url.startsWith('https://api.cloudflare.com/');
    assert.equal(options.headers.Authorization,admin?'Bearer fictional-admin':'Bearer fictional-runtime');
    const reply=result=>Response.json(admin?{success:true,result}:result);
    if(url.endsWith('/write-control')) {
      assert.equal(method,'GET');
      if(enabled&&failure==='control-error') return Response.json({error:'private detail'}, {status:403});
      const visible=enabled&&failure==='propagation' ? ++enabledControlReads>=3
        : enabled&&failure==='propagation-never' ? false : enabled;
      return reply({mode:'WRITE_CONTROL',schemaVersion:1,writeEnabled:visible,engineGitSha:engine,
        candidateSha256:core,scope:'RUNTIME_BINDINGS_ONLY'});
    }
    if(url.endsWith('/settings')) {
      if(method==='GET') {
        if(enabled&&failure==='recovery-read') {
          // First enabled GET confirms enable; later GET is recovery.
          const n=calls.filter(c=>c.method==='GET'&&c.url.endsWith('/settings')).length;
          if(n>=4) throw new Error('sensitive upstream text');
        }
        return reply({bindings:b()});
      }
      assert.equal(method,'PATCH');
      const settings=JSON.parse(await options.body.get('settings').text());
      assert.deepEqual(Object.keys(settings),['bindings']);
      const next=settings.bindings.find(x=>x.name==='FEATURE_V2_WRITE_ENABLED').text==='true';
      assert.deepEqual(settings.bindings.filter(x=>x.name!=='FEATURE_V2_WRITE_ENABLED'),
        b().filter(x=>x.name!=='FEATURE_V2_WRITE_ENABLED').map(x=>({name:x.name,type:'inherit'})));
      if(!next&&failure==='disable') throw new Error('do not print credentials');
      enabled=next;
      if(next&&failure==='enable-timeout') throw new Error('server applied before timeout');
      return reply({}); // Partial PATCH response is intentionally not readback evidence.
    }
    if(method==='GET') return reply({candidateSha256:failure==='core'? 'wrong':core,
      observedAt:'2026-10-19T11:00:46.439Z',validation:{qualityCeiling:'UNUSABLE_INPUT'},queryMeta:{current:meta}});
    assert.equal(method,'POST');assert.equal(url,'https://market-feature-validation.dimple3691.workers.dev/feature-runs');
    assert.equal(enabled,true);
    if(failure==='post-403') return Response.json({error:'FEATURE_WRITE_DISABLED'}, {status:403});
    if(failure==='post-timeout') throw new Error('ambiguous result, must not retry');
    const stored={slotMs:1792407600000,featureVersion:2,engineGitSha:existing?'9'.repeat(40):engine,
      engineSourceSha256:core,observedAtMs:1792407600000,generatedAtMs:1792407605000,
      inputCutoffMs:1792407604000,qualityCeiling:'UNUSABLE_INPUT',generationStatus:'SUCCESS',compactFeaturesBytes:14000};
    const row={mode:'CANDIDATE_COMPACT_WRITE',candidateSha256:core,queryMeta:{current:meta},...stored,stored,computed:{...stored,engineGitSha:engine},metadataScope:'STORED_FEATURE_RUN',
      status:existing?'EXISTS':'INSERTED',verifyMeta:meta,writeMeta:{changes:existing?0:1}};
    if(failure==='receipt') row.engineGitSha='0'.repeat(40);
    return reply(row);
  };
  return {fetcher,calls,get enabled(){return enabled;}};
}
const run=(s,extra={})=>runStorageTrial({oauthToken:'fictional-admin',validationToken:'fictional-runtime',
  fetcher:s.fetcher,approved:true,sleep:async()=>{},...extra});
const posts=s=>s.calls.filter(c=>c.method==='POST');

test('plan is offline and default CLI never reads credentials',()=>{
  const output=execFileSync(process.execPath,['scripts/trial-feature-storage.mjs'],{encoding:'utf8',
    env:{...process.env,CLOUDFLARE_API_TOKEN:'must-not-be-read-in-plan'}});
  assert.equal(JSON.parse(output).mode,'PLAN_ONLY_NO_CREDENTIAL_OR_NETWORK_ACCESS');
  assert.equal(trialPlan().maxFeaturePostAttempts,1);
});
test('missing approval cannot reach HTTP transport',async()=>{
  const s=server();await assert.rejects(()=>run(s,{approved:false}),/EXPLICIT_TRIAL_APPROVAL_REQUIRED/);
  assert.equal(s.calls.length,0);
});
test('one immutable insertion is followed by verified disable; low quality is preserved',async()=>{
  const s=server();const r=await run(s);assert.equal(r.status,'PASS');assert.equal(posts(s).length,1);
  assert.equal(s.enabled,false);assert.equal(r.restoreVerified,true);
  assert.equal(r.receipt.qualityCeiling,'UNUSABLE_INPUT');assert.equal(r.receipt.liveMarketGate,'UNCHANGED');
});
test('EXISTS preserves earlier immutable engine identity',async()=>{
  const s=server({existing:true});const r=await run(s);assert.equal(r.status,'PASS');
  assert.equal(r.receipt.engineGitSha,'9'.repeat(40));assert.equal(posts(s).length,1);assert.equal(s.enabled,false);
});
for(const failure of ['core','enable-timeout','post-timeout','receipt'])
  test(`${failure} stops without retry and restores any attempted enable`,async()=>{
    const s=server({failure});const r=await run(s);assert.equal(r.status,'FAILED');assert.equal(s.enabled,false);
    assert.equal(posts(s).length,['post-timeout','receipt'].includes(failure)?1:0);
    assert.equal(r.restoreVerified,failure!=='core');
    assert.equal(JSON.stringify(r).includes('sensitive'),false);
  });
for(const failure of ['disable','recovery-read'])
  test(`${failure} yields RECOVERY_REQUIRED rather than success`,async()=>{
    const s=server({failure});const r=await run(s);assert.equal(r.status,'RECOVERY_REQUIRED');
    assert.equal(r.restoreVerified,false);assert.equal(posts(s).length,1);
  });
test('an already enabled flag aborts without changing another operator state',async()=>{
  const s=server({writeInitially:true});const r=await run(s);assert.equal(r.status,'FAILED');
  assert.equal(r.failure,'INITIAL_WRITES_NOT_DISABLED');assert.equal(s.calls.length,1);assert.equal(s.enabled,true);
});
test('interrupted work uses independent recovery signal',async()=>{
  const s=server();const controller=new AbortController();
  const fetcher=async(url,o)=>{
    const r=await s.fetcher(url,o);
    if(o.method==='PATCH'&&s.enabled) controller.abort();
    if(controller.signal.aborted&&o.method==='GET'&&s.calls.filter(c=>c.method==='PATCH').length===1)
      assert.notEqual(o.signal,controller.signal);
    return r;
  };
  const r=await run(s,{fetcher,signal:controller.signal});assert.equal(r.status,'FAILED');
  assert.equal(posts(s).length,0);assert.equal(r.restoreVerified,true);assert.equal(s.enabled,false);
});
test('OAuth is captured from pinned CLI, keychain is forced, runtime token not inherited',async()=>{
  let invoked=false;
  const token=await readLocalOAuth({env:{VALIDATION_TOKEN:'private-runtime'},exec:async(cmd,args,opts)=>{
    invoked=true;assert.equal(cmd,'npx');assert.deepEqual(args,['--yes','wrangler@4.151.2','auth','token','--json']);
    assert.equal(opts.env.CLOUDFLARE_AUTH_USE_KEYRING,'true');assert.equal(opts.env.VALIDATION_TOKEN,undefined);
    return {stdout:JSON.stringify({type:'oauth',token:'fictional-admin'})};
  }});
  assert.equal(invoked,true);assert.equal(token,'fictional-admin');
  await assert.rejects(()=>readLocalOAuth({env:{CLOUDFLARE_API_TOKEN:'other'},exec:()=>{throw Error('unexpected');}}),
    /ALTERNATE_ADMIN_CREDENTIAL_PRESENT/);
  await assert.rejects(()=>readLocalOAuth({env:{},exec:async()=>({stdout:'{"type":"api_token","token":"secret"}'})}),
    /LOCAL_OAUTH_REQUIRED/);
  await assert.rejects(()=>readLocalOAuth({env:{},exec:async()=>{throw Error('secret');}}),
    error=>error.message==='LOCAL_OAUTH_READ_FAILED');
});

test('emergency disable uses management credential only and never enables or posts',async()=>{
  const s=server({writeInitially:true});const r=await run(s,{validationToken:undefined,recoveryOnly:true});
  assert.equal(r.status,'PASS');assert.equal(r.restoreVerified,true);assert.equal(s.enabled,false);
  assert.equal(posts(s).length,0);assert.equal(s.calls.filter(c=>c.method==='PATCH').length,1);
  assert.equal(s.calls.some(c=>!c.url.startsWith('https://api.cloudflare.com/')),false);
});

test('runtime propagation is observed with GETs before the single POST',async()=>{
  const s=server({failure:'propagation'});const r=await run(s);assert.equal(r.status,'PASS');
  const postAt=s.calls.findIndex(c=>c.method==='POST');
  assert.equal(s.calls.slice(0,postAt).filter(c=>c.url.endsWith('/write-control')).length,4);
  assert.equal(posts(s).length,1);assert.equal(r.restoreVerified,true);
});
test('runtime enable never visible blocks POST and restores disabled state',async()=>{
  const s=server({failure:'propagation-never'});const r=await run(s);
  assert.equal(r.status,'FAILED');assert.equal(r.failure,'RUNTIME_ENABLE_NOT_OBSERVED');
  assert.equal(posts(s).length,0);assert.equal(r.restoreVerified,true);assert.equal(s.enabled,false);
  assert.equal(s.calls.filter(c=>c.url.endsWith('/write-control')).length,10);
});
test('control HTTP error is never retried and no raw error detail escapes',async()=>{
  const s=server({failure:'control-error'});const r=await run(s);
  assert.equal(r.status,'FAILED');assert.equal(posts(s).length,0);assert.equal(r.restoreVerified,true);
  assert.equal(r.failure,'HTTP_403_AT_RUNTIME_CONTROL_UNCLASSIFIED_RESPONSE');
  assert.equal(JSON.stringify(r).includes('private detail'),false);
});
test('a denied POST reports only its allowlisted error and is not repeated',async()=>{
  const s=server({failure:'post-403'});const r=await run(s);
  assert.equal(r.status,'FAILED');assert.equal(r.failure,'HTTP_403_AT_FEATURE_POST_FEATURE_WRITE_DISABLED');
  assert.equal(posts(s).length,1);assert.equal(r.restoreVerified,true);
});
