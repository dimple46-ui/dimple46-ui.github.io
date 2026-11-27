// OFFLINE PRIVATE transport factory; NOT a deployed Worker, route, provider limiter or Access configuration.
// All storage/identity/limiting operations are injected. No cookies/CORS, owner-selected SQL, auto retry or sender.
import {scopeValid,timestamp,PrivateStorageError} from './storage-contract.mjs';
import {parsePrivateInputRequest} from './input-request.mjs';
import {privateSavedAnalysisView} from './saved-analysis-view.mjs';
class TransportError extends Error {constructor(code,status){super(code);this.code=code;this.status=status;}}
const stop=(code,status)=>{throw new TransportError(code,status);};
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','pragma':'no-cache',
 'vary':'Authorization','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; frame-ancestors 'none'"};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers});
const rejections={UNAUTHORIZED:401,INVALID_REQUEST:400,INVALID_OR_OVERSIZED_JSON:400,WORKFLOW_NOT_COMMITTABLE:422,
 STORE_FROZEN_OR_SCOPE_MISMATCH:423,REVISION_CONFLICT:409,REVISION_EXHAUSTED:409,TIME_REGRESSION:409,IDEMPOTENCY_CONFLICT:409,
 INVALID_CRYPTO_RESULT:503,PREPARED_STATE_NOT_COMMITTABLE:422,INVALID_SERVER_POLICY:503};
const unknown=(status,code)=>json(status,{apiSchemaVersion:1,error:code,writeOutcome:'UNKNOWN',
 recovery:'REPLAY_SAME_REQUEST_ID_AND_BODY',automaticRetry:false});
function receipt(result,now){
 if(!['COMMITTED','REPLAYED'].includes(result?.status)||result.schemaVersion!==1||!Number.isSafeInteger(result.revision)||result.revision<1||
  !timestamp(result.generatedAtMs)||!timestamp(result.inputCutoffMs)||result.inputCutoffMs>result.generatedAtMs||!timestamp(now)||result.generatedAtMs>now||
  result.notificationStatus!=='PENDING_REVIEW_NOT_SENT')stop('INVALID_UPSTREAM_RECEIPT',503);
 return {apiSchemaVersion:1,status:result.status,writeOutcome:result.status,revision:result.revision,generatedAtMs:result.generatedAtMs,inputCutoffMs:result.inputCutoffMs,
  notificationStatus:'PENDING_REVIEW_NOT_SENT'};
}
function statusView(s,now){
 if(s?.schemaVersion!==1||!['ACTIVE','MAINTENANCE_FROZEN','INITIALIZATION_REQUIRED'].includes(s.mode)||
  !Number.isSafeInteger(s.revision)||s.revision<0||
  (s.revision===0?(s.generatedAtMs!==null||s.inputCutoffMs!==null):
   (!timestamp(s.generatedAtMs)||!timestamp(s.inputCutoffMs)||s.inputCutoffMs>s.generatedAtMs||s.generatedAtMs>now)))stop('INVALID_UPSTREAM_STATUS',503);
 return {apiSchemaVersion:1,status:{mode:s.mode,revision:s.revision,generatedAtMs:s.generatedAtMs,inputCutoffMs:s.inputCutoffMs},
 freshness:{analysisAgeMs:s.generatedAtMs===null?null:now-s.generatedAtMs,inputAgeMs:s.inputCutoffMs===null?null:now-s.inputCutoffMs},
 quality:'NOT_EVALUATED_BY_TRANSPORT',operationalValidation:'NOT_PRODUCTION_VALIDATED'};
}
async function boundedBody(request,maxBytes,signal){
 if(!request.body)stop('INVALID_JSON_BODY',400);
 const reader=request.body.getReader(),chunks=[];let size=0;
 const cancel=()=>{try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}};
 signal.addEventListener('abort',cancel,{once:true});
 try{
  while(true){if(signal.aborted)stop('REQUEST_ABORTED',499);const {done,value}=await reader.read();if(done)break;
   if(!(value instanceof Uint8Array))stop('INVALID_JSON_BODY',400);size+=value.byteLength;
   if(size>maxBytes){cancel();stop('BODY_TOO_LARGE',413);}chunks.push(value.slice());
  }
  if(signal.aborted)stop('REQUEST_ABORTED',499);
  const declared=request.headers.get('content-length');if(declared!==null&&Number(declared)!==size)stop('CONTENT_LENGTH_MISMATCH',400);
  const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{stop('INVALID_JSON_BODY',400);}
 }finally{signal.removeEventListener('abort',cancel);try{reader.releaseLock();}catch{}}
}
export function createPrivateHttpBoundary({origin,authorize,checkRateLimit,inputAdapter,statusReader,analysisReader,clock=Date.now,
 timeoutMs=5000,maxBodyBytes=131072,readRole='OWNER_READ'}={}){
 let parsedOrigin;try{parsedOrigin=new URL(origin);}catch{}
 if(!parsedOrigin||parsedOrigin.protocol!=='https:'||parsedOrigin.origin!==origin||
  ![authorize,checkRateLimit,statusReader,clock].every(f=>typeof f==='function')||typeof inputAdapter?.submit!=='function'||
  !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000||!Number.isSafeInteger(maxBodyBytes)||maxBodyBytes<1||maxBodyBytes>131072||
  !['OWNER_READ','MACHINE_READ'].includes(readRole)||(analysisReader!==undefined&&typeof analysisReader!=='function'))throw new TypeError('INVALID_PRIVATE_HTTP_CONFIGURATION');
 return async function handle(request){
  let dispatched=false,timer,onAbort;const controller=new AbortController();
  try{
   const url=new URL(request.url),method=request.method;
   if(url.origin!==origin||url.username||url.password)stop('NOT_FOUND',404);
   if(url.search||url.hash)stop('QUERY_NOT_ALLOWED',400);
   if(request.headers.has('origin')||request.headers.has('cookie'))stop('BROWSER_CONTEXT_NOT_SUPPORTED',403);
   const action=url.pathname==='/private/inputs'?'OWNER_WRITE':(url.pathname==='/private/status'||url.pathname==='/private/analysis/latest'&&analysisReader)?readRole:null;
   if(!action)stop('NOT_FOUND',404);
   if(method!==(action==='OWNER_WRITE'?'POST':'GET'))stop('METHOD_NOT_ALLOWED',405);
   if(action!=='OWNER_WRITE'&&(request.body!==null||request.headers.has('content-length')))stop('BODY_NOT_ALLOWED',400);
   const startedAt=clock();if(!timestamp(startedAt))stop('PRIVATE_SERVICE_UNAVAILABLE',503);
   const deadlineAtMs=startedAt+timeoutMs;
   const expired=()=>{if(!timestamp(clock()))stop('PRIVATE_SERVICE_UNAVAILABLE',503);if(controller.signal.aborted)stop('REQUEST_ABORTED',499);if(clock()>=deadlineAtMs)stop('REQUEST_TIMEOUT',504);};
   const budget=new Promise((resolve,reject)=>{
    const rejectWith=(code,status)=>{controller.abort();reject(new TransportError(code,status));};
    timer=setTimeout(()=>rejectWith('REQUEST_TIMEOUT',504),timeoutMs);
    onAbort=()=>rejectWith('REQUEST_ABORTED',499);request.signal.addEventListener('abort',onAbort,{once:true});if(request.signal.aborted)onAbort();
   });
   const task=(async()=>{
    expired();const credential=request.headers.get('authorization');
    if(typeof credential!=='string'||credential.length>16384||!credential.startsWith('Bearer '))stop('UNAUTHORIZED',401);
    const proof=await authorize(credential,action);expired();
    const principal=proof&&Object.freeze({verified:proof.verified,schemaVersion:proof.schemaVersion,ownerRef:proof.ownerRef,
     authorizationEpoch:proof.authorizationEpoch,policyEpoch:proof.policyEpoch,restoreEpoch:proof.restoreEpoch,
     roles:Array.isArray(proof.roles)?Object.freeze([...proof.roles]):null,expiresAtMs:proof.expiresAtMs});
    const valid=()=>principal?.verified===true&&scopeValid(principal)&&Array.isArray(principal.roles)&&principal.roles.includes(action)&&
     timestamp(principal.expiresAtMs)&&clock()<principal.expiresAtMs;
    if(!valid())stop('UNAUTHORIZED',401);
    const execution={deadlineAtMs,signal:controller.signal};
    const rate=await checkRateLimit({principal,action,execution});expired();
    if(rate?.allowed===false)stop('RATE_LIMITED',429);if(rate?.allowed!==true)stop('PRIVATE_SERVICE_UNAVAILABLE',503);
    if(!valid())stop('UNAUTHORIZED',401);
    if(action!=='OWNER_WRITE'){
     let result;try{result=await (url.pathname==='/private/status'?statusReader:analysisReader)({credential,principal,execution});}
     catch(error){if(error instanceof PrivateStorageError&&['UNAUTHORIZED','ANALYSIS_NOT_AVAILABLE','SNAPSHOT_CHANGED'].includes(error.code))
      stop(error.code,{UNAUTHORIZED:401,ANALYSIS_NOT_AVAILABLE:404,SNAPSHOT_CHANGED:409}[error.code]);throw error;}
     expired();if(!valid())stop('UNAUTHORIZED',401);
     if(url.pathname==='/private/analysis/latest'){
      if(result?.contractVersion!==1||result.scope!=='PRIVATE_SAVED_RISK_AGGREGATES_ONLY'||result.temporalScope!=='STORED_AS_OF_NOT_REEVALUATED')stop('INVALID_UPSTREAM_ANALYSIS',503);
      const view=privateSavedAnalysisView(result,clock());return json(200,{apiSchemaVersion:1,...view});
     }
     return json(200,statusView(result,clock()));
    }
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))stop('JSON_CONTENT_TYPE_REQUIRED',415);
    if(request.headers.has('content-encoding')&&request.headers.get('content-encoding')!=='identity')stop('CONTENT_ENCODING_NOT_SUPPORTED',415);
    const declared=request.headers.get('content-length');
    if(declared!==null&&(!/^\d+$/.test(declared)||!Number.isSafeInteger(Number(declared))))stop('INVALID_CONTENT_LENGTH',400);
    if(declared!==null&&Number(declared)>maxBodyBytes)stop('BODY_TOO_LARGE',413);
    let payload;try{payload=parsePrivateInputRequest(await boundedBody(request,maxBodyBytes,controller.signal)).request;}
    catch(error){if(error instanceof PrivateStorageError)stop('INVALID_REQUEST',400);throw error;}
    expired();if(!valid())stop('UNAUTHORIZED',401);
    // Once dispatched, timeout/abort/network loss cannot prove that a remote write did not commit.
    // AbortSignal is cooperative; never promise cancellation or automatically retry this write.
    dispatched=true;const result=await inputAdapter.submit({credential,request:payload,execution});expired();if(!valid())stop('UNAUTHORIZED',401);
    if(result?.status==='REJECTED'){
     if(!Object.hasOwn(rejections,result.code))return unknown(503,'WRITE_OUTCOME_UNCONFIRMED');
     return json(rejections[result.code],{apiSchemaVersion:1,error:result.code,writeOutcome:'REJECTED_BY_ADAPTER'});
    }
    return json(200,receipt(result,clock()));
   })();
   return await Promise.race([task,budget]);
  }catch(error){
   if(dispatched)return unknown(error instanceof TransportError?error.status:503,'WRITE_OUTCOME_UNCONFIRMED');
   return json(error instanceof TransportError?error.status:503,{apiSchemaVersion:1,
    error:error instanceof TransportError?error.code:'PRIVATE_SERVICE_UNAVAILABLE',writeOutcome:'NOT_DISPATCHED'});
  }finally{clearTimeout(timer);if(onAbort)request.signal?.removeEventListener('abort',onAbort);
   if(request.body&&!request.body.locked){try{Promise.resolve(request.body.cancel()).catch(()=>{});}catch{}}}
 };
}
