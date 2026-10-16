// Local WHATWG Request/Response/stream tests with fictional operations. No deployed endpoint/provider limiter.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateHttpBoundary} from '../private/http-boundary.mjs';
const now=1792132200000,origin='https://fictional-private.invalid';
const principal={schemaVersion:1,ownerRef:'fictional-owner',authorizationEpoch:'auth-a',policyEpoch:'policy-a',restoreEpoch:'restore-a',
 verified:true,roles:['OWNER_READ','OWNER_WRITE'],expiresAtMs:now+60000};
const payload={schemaVersion:1,requestId:'fictional-request',expectedRevision:0,inputs:{ledger:{fictional:true}}};
const committed={status:'COMMITTED',schemaVersion:1,revision:1,generatedAtMs:now,inputCutoffMs:now-1000,notificationStatus:'PENDING_REVIEW_NOT_SENT'};
function fixture(extra={}){const calls={auth:0,rate:0,write:0,read:0};
 const deps={origin,clock:()=>now,timeoutMs:100,
 authorize:async(token,action)=>{calls.auth++;return token==='Bearer fictional-valid'?principal:null;},
 checkRateLimit:async()=>{calls.rate++;return {allowed:true};},
 inputAdapter:{submit:async()=>{calls.write++;return committed;}},
 statusReader:async()=>{calls.read++;return {schemaVersion:1,mode:'ACTIVE',revision:1,generatedAtMs:now-100,inputCutoffMs:now-8000};},...extra};
 return {handle:createPrivateHttpBoundary(deps),calls,deps};
}
const get=(path='/private/status',headers={})=>new Request(origin+path,{headers:{authorization:'Bearer fictional-valid',...headers}});
const post=(body=JSON.stringify(payload),headers={},other={})=>new Request(origin+'/private/inputs',{method:'POST',headers:{authorization:'Bearer fictional-valid','content-type':'application/json',...headers},body,...other});
const body=async response=>JSON.parse(await response.text());
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('HTTP boundary unauthenticated/wrong/forged Access headers reject before rate/body/store work',async()=>{
 for(const req of [new Request(origin+'/private/status'),get('/private/status',{authorization:'wrong'}),
 new Request(origin+'/private/status',{headers:{'cf-access-jwt-assertion':'forged','cf-access-authenticated-user-email':'fictional@example.invalid'}})]){
  const f=fixture();assert.equal((await f.handle(req)).status,401);assert.equal(f.calls.rate,0);assert.equal(f.calls.write+f.calls.read,0);
 }
});
test('HTTP boundary denies missing expiry/unverified/expired/wrong role proofs before storage',async()=>{
 for(const patch of [{expiresAtMs:null},{expiresAtMs:now},{verified:false},{roles:['MACHINE_READ']},{ownerRef:''}]){
  const f=fixture({authorize:async()=>({...principal,...patch})});assert.equal((await f.handle(get())).status,401);assert.equal(f.calls.rate,0);assert.equal(f.calls.read,0);
 }
});
test('HTTP boundary fixed origin/routes/methods reject previews, queries, SQL paths, browser origins and cookies',async()=>{
 for(const req of [new Request('https://preview.invalid/private/status'),get('/private/status?owner=other'),get('/sql'),get('/private/analysis/latest'),
 new Request(origin+'/private/status',{method:'DELETE'}),new Request(origin+'/private/status',{method:'OPTIONS'}),get('/private/status',{origin}),get('/private/status',{cookie:'CF_Authorization=fictional'}),get('/private/status',{'content-length':'0'})]){
  const f=fixture();assert.notEqual((await f.handle(req)).status,200);assert.equal(f.calls.read+f.calls.write+f.calls.auth,0);
 }
});
test('HTTP boundary unauthorized streamed write cancels without pulling its body',async()=>{
 let pulled=0,cancelled=0;const stream=new ReadableStream({pull(){pulled++;},cancel(){cancelled++;}},{highWaterMark:0});
 const f=fixture();assert.equal((await f.handle(post(stream,{authorization:'wrong'},{duplex:'half'}))).status,401);
 assert.equal(pulled,0);assert.equal(cancelled,1);assert.equal(f.calls.write,0);
});
test('HTTP boundary read status projects metadata only, preserving independent input/analysis age and no verification upgrade',async()=>{
 const f=fixture({statusReader:async()=>({schemaVersion:1,mode:'ACTIVE',revision:1,generatedAtMs:now-100,inputCutoffMs:now-8000,privateSecret:'PRIVATE_SENTINEL',sealedState:'PRIVATE_SENTINEL'})});
 const response=await f.handle(get()),data=await body(response);assert.equal(response.status,200);
 assert.deepEqual(data.freshness,{analysisAgeMs:100,inputAgeMs:8000});assert.equal(data.quality,'NOT_EVALUATED_BY_TRANSPORT');
 assert.ok(!JSON.stringify(data).includes('PRIVATE_SENTINEL'));assert.ok(!('ownerRef'in data));assert.equal(response.headers.get('cache-control'),'no-store, private');
 assert.equal(response.headers.get('access-control-allow-origin'),null);
});
test('HTTP boundary status rejects future/inconsistent/missing timestamps without fake zero or LIVE',async()=>{
 for(const patch of [{generatedAtMs:now+1},{inputCutoffMs:now},{generatedAtMs:null},{revision:-1},{mode:'SAFE'}]){
  const f=fixture({statusReader:async()=>({schemaVersion:1,mode:'ACTIVE',revision:1,generatedAtMs:now-100,inputCutoffMs:now-8000,...patch})});
  const response=await f.handle(get());assert.equal(response.status,503);assert.equal((await body(response)).error,'INVALID_UPSTREAM_STATUS');
 }
 const f=fixture({statusReader:async()=>({schemaVersion:1,mode:'INITIALIZATION_REQUIRED',revision:0,generatedAtMs:null,inputCutoffMs:null})});
 assert.deepEqual((await body(await f.handle(get()))).freshness,{analysisAgeMs:null,inputAgeMs:null});
});
test('HTTP boundary rate denial/unknown/failure never invokes storage; errors have no raw echo',async()=>{
 for(const checkRateLimit of [async()=>({allowed:false}),async()=>undefined,async()=>{throw Error('PRIVATE_SENTINEL');}]){
  const f=fixture({checkRateLimit}),response=await f.handle(get());assert.ok([429,503].includes(response.status));assert.equal(f.calls.read,0);assert.ok(!JSON.stringify(await body(response)).includes('PRIVATE_SENTINEL'));
 }
});
test('HTTP boundary accepted write forwards detached strict input and returns only a durable receipt',async()=>{
 let seen;const f=fixture({inputAdapter:{submit:async args=>{seen=args;return {...committed,privateSecret:'PRIVATE_SENTINEL'};}}});
 const response=await f.handle(post()),data=await body(response);assert.equal(response.status,200);assert.equal(data.status,'COMMITTED');assert.equal(data.writeOutcome,'COMMITTED');
 assert.deepEqual(seen.request,payload);assert.notEqual(seen.request,payload);assert.ok(seen.execution.signal instanceof AbortSignal);assert.equal(seen.execution.deadlineAtMs,now+100);
 assert.ok(!JSON.stringify(data).includes('PRIVATE_SENTINEL'));assert.equal(f.calls.auth,1);assert.equal(f.calls.rate,1);
});
test('HTTP boundary enforces server-selected service read-only role, without request-selected permissions',async()=>{
 const service={...principal,roles:['MACHINE_READ']},f=fixture({readRole:'MACHINE_READ',authorize:async()=>service});
 assert.equal((await f.handle(get())).status,200);assert.equal((await f.handle(post())).status,401);assert.equal(f.calls.write,0);
});
test('HTTP boundary rejects body type/encoding/declared length and actual stream overflow before dispatch',async()=>{
 const variants=[[post('x',{'content-type':'text/plain'}),415],[post('{}',{'content-encoding':'gzip'}),415],
 [post('{}',{'content-length':'-1'}),400],[post('{}',{'content-length':'1,2'}),400],[post('{}',{'content-length':'201'}),413],
 [post(' '.repeat(201)),413],[post('{}',{'content-length':'1'}),400],[post('{}',{'content-length':'3'}),400],
 [post(new Uint8Array([255])),400],[post('{'),400],[post(JSON.stringify({...payload,ownerRef:'other'})),400],
 [post(JSON.stringify({...payload,inputs:{sql:'SELECT secret'}})),400]];
 for(const[req,status]of variants){const f=fixture({maxBodyBytes:200});const response=await f.handle(req);assert.equal(response.status,status);assert.equal(f.calls.write,0);}
});
test('HTTP boundary body byte cap counts UTF-8 bytes and rejects deep JSON without touching writer',async()=>{
 const huge=post(JSON.stringify({...payload,inputs:{ledger:{note:'가'.repeat(50)}}}));const f=fixture({maxBodyBytes:230});assert.equal((await f.handle(huge)).status,413);
 let deep=0;for(let i=0;i<40;i++)deep={nested:deep};const other=fixture();assert.equal((await other.handle(post(JSON.stringify({...payload,inputs:{ledger:deep}})))).status,400);assert.equal(other.calls.write,0);
});
test('HTTP boundary slow auth/body times out before dispatch and no late storage call follows',async()=>{
 const gate=defer(),f=fixture({timeoutMs:15,authorize:()=>gate.promise});let response=await f.handle(get());assert.equal(response.status,504);
 assert.equal((await body(response)).writeOutcome,'NOT_DISPATCHED');gate.resolve(principal);await Promise.resolve();assert.equal(f.calls.read+f.calls.rate,0);
 let cancelled=0;const stream=new ReadableStream({pull(){},cancel(){cancelled++;}},{highWaterMark:0});
 const other=fixture({timeoutMs:15});response=await other.handle(post(stream,{}, {duplex:'half'}));assert.equal(response.status,504);assert.equal(other.calls.write,0);assert.equal(cancelled,1);
});
test('HTTP boundary post-dispatch timeout is UNKNOWN, never automatic retry or a false rollback claim',async()=>{
 const gate=defer();let writes=0,commits=0;const f=fixture({timeoutMs:15,inputAdapter:{submit:async()=>{writes++;await gate.promise;commits++;return committed;}}});
 const response=await f.handle(post()),data=await body(response);assert.equal(response.status,504);assert.equal(data.writeOutcome,'UNKNOWN');assert.equal(data.automaticRetry,false);
 assert.equal(data.recovery,'REPLAY_SAME_REQUEST_ID_AND_BODY');assert.equal(writes,1);assert.equal(commits,0);
 gate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(commits,1);assert.equal(writes,1);
});
test('HTTP boundary client cancellation before/after dispatch distinguishes no write from ambiguous write',async()=>{
 const early=new AbortController();early.abort();const f=fixture();assert.equal((await f.handle(post(JSON.stringify(payload),{}, {signal:early.signal}))).status,499);assert.equal(f.calls.auth,0);
 const later=new AbortController(),started=defer(),gate=defer();
 const other=fixture({inputAdapter:{submit:async()=>{started.resolve();await gate.promise;return committed;}}});
 const running=other.handle(post(JSON.stringify(payload),{}, {signal:later.signal}));await started.promise;later.abort();const response=await running;
 assert.equal(response.status,499);assert.equal((await body(response)).writeOutcome,'UNKNOWN');gate.resolve();
});
test('HTTP boundary write dependency failures/invalid receipts stay UNKNOWN; known adapter rejections retain explicit codes',async()=>{
 for(const submit of [async()=>{throw Error('PRIVATE_SENTINEL');},async()=>({}),async()=>({...committed,generatedAtMs:now+1}),async()=>({status:'REJECTED',code:'PRIVATE_SENTINEL'})]){
  const f=fixture({inputAdapter:{submit}}),response=await f.handle(post()),data=await body(response);assert.equal(response.status,503);assert.equal(data.writeOutcome,'UNKNOWN');assert.ok(!JSON.stringify(data).includes('PRIVATE_SENTINEL'));
 }
 const f=fixture({inputAdapter:{submit:async()=>({status:'REJECTED',code:'IDEMPOTENCY_CONFLICT'})}}),response=await f.handle(post());
 assert.equal(response.status,409);assert.equal((await body(response)).writeOutcome,'REJECTED_BY_ADAPTER');
});
test('HTTP boundary rechecks identity expiry after rate wait and redacts mutable proof extras',async()=>{
 let t=now;const f=fixture({clock:()=>t,authorize:async()=>({...principal,privateSecret:'PRIVATE_SENTINEL'}),checkRateLimit:async({principal:p})=>{
 assert.equal(p.privateSecret,undefined);assert.ok(Object.isFrozen(p));t=principal.expiresAtMs;return {allowed:true};}});
 const response=await f.handle(get());assert.ok([401,504].includes(response.status));assert.equal(f.calls.read,0);
});
test('HTTP boundary rejects invalid/missing configuration instead of silently disabling auth/limits',()=>{
 const f=fixture();for(const patch of [{origin:'http://insecure.invalid'},{origin:origin+'/'},{checkRateLimit:null},{timeoutMs:Infinity},{maxBodyBytes:131073},{readRole:'OWNER_WRITE'}])
 assert.throws(()=>createPrivateHttpBoundary({...f.deps,...patch}),/INVALID_PRIVATE_HTTP_CONFIGURATION/);
});
