// OFFLINE PRIVATE ONLY. Trusted injected identity/crypto/store/policy; not JWT verification or a Worker.
// No network, provisioning, initialization, scheduler, sender, actual financial input or logging.
import {runPrivateRiskWorkflow} from '../domain/private-risk-workflow.mjs';
import {parsePrivateInputRequest} from './input-request.mjs';
import {privateReleaseIdentity,privatePolicySnapshot,privatePolicyTag} from './analysis-provenance.mjs';
import {checkPrivateGoalVersionHistory,applyPrivateGoalHistory} from './goal-version-history.mjs';
import {PrivateStorageError,fail,opaqueId,intentId,timestamp,scopeValid,sameScope,context,canonicalJson,envelopeValid} from './storage-contract.mjs';
const allowedErrors=new Set(['UNAUTHORIZED','INVALID_REQUEST','INVALID_OR_OVERSIZED_JSON','STORE_FROZEN_OR_SCOPE_MISMATCH',
 'REVISION_CONFLICT','REVISION_EXHAUSTED','TIME_REGRESSION','IDEMPOTENCY_CONFLICT','WORKFLOW_NOT_COMMITTABLE',
 'INVALID_CRYPTO_RESULT','PREPARED_STATE_NOT_COMMITTABLE','INVALID_SERVER_POLICY']);
const okReceipt=(r,replayed)=>({status:replayed?'REPLAYED':'COMMITTED',schemaVersion:1,revision:r.revision,
 generatedAtMs:r.generatedAtMs,inputCutoffMs:r.inputCutoffMs,notificationStatus:'PENDING_REVIEW_NOT_SENT'});
export function createPrivateInputAdapter({authorize,getStore,getPolicy,crypto,clock,releaseIdentity,workflow=runPrivateRiskWorkflow}){
 if(![authorize,getStore,getPolicy,clock,workflow].every(x=>typeof x==='function')||
   !['seal','open','tag'].every(k=>typeof crypto?.[k]==='function'))throw new TypeError('PRIVATE_ADAPTER_DEPENDENCIES_REQUIRED');
 const release=privateReleaseIdentity(releaseIdentity);
 async function submit({credential,request}={}){
  try{
   // authorize is a trusted verifier + SERVER owner/role mapping; caller headers/body cannot supply this proof.
   const principal=await authorize(credential,'OWNER_WRITE');
   if(principal?.verified!==true||!scopeValid(principal)||!Array.isArray(principal.roles)||!principal.roles.includes('OWNER_WRITE'))fail('UNAUTHORIZED');
   const scope=Object.fromEntries(['schemaVersion','ownerRef','authorizationEpoch','policyEpoch','restoreEpoch'].map(k=>[k,principal[k]]));
   const parsed=parsePrivateInputRequest(request),canonical=parsed.canonical;request=parsed.request;
   const store=await getStore(scope.ownerRef),head=store.readHead();
   if(!head||!sameScope(head,scope)||head.mode!=='ACTIVE')fail('STORE_FROZEN_OR_SCOPE_MISMATCH');
   const payloadTag=await crypto.tag(canonical,context(scope,'REQUEST_TAG',request.requestId));
   if(!opaqueId(payloadTag))fail('INVALID_CRYPTO_RESULT');
   const prior=store.readReceipt(scope,request.requestId);
   if(prior){if(prior.payloadTag!==payloadTag)fail('IDEMPOTENCY_CONFLICT');return okReceipt(prior,true);}
   if(head.revision!==request.expectedRevision)fail('REVISION_CONFLICT');
   const previousEventState=await crypto.open(head.sealedState,context(scope,'EVENT_STATE',String(head.revision)));
   if(previousEventState===null||typeof previousEventState!=='object')fail('STORE_FROZEN_OR_SCOPE_MISMATCH');
   const nowMs=clock(),policy=privatePolicySnapshot(await getPolicy(scope,nowMs),nowMs);
   const policyTag=await privatePolicyTag(crypto,scope,policy);
   let result=workflow(request.inputs,{...policy,previousEventState});
   if(result?.contractVersion!==1||result.scope!=='PRIVATE_LOCAL_WORKFLOW_ONLY'||result.events?.status!=='REDUCED'||
     result.events.stateHandling==='RETAIN_CALLER_STATE_UNCHANGED'||result.events.state===null||typeof result.events.state!=='object'||result.generatedAtMs!==nowMs||
     !timestamp(result.inputCutoffMs)||result.inputCutoffMs>nowMs||!Array.isArray(result.events.intents)||result.events.intents.length>64)
    fail('WORKFLOW_NOT_COMMITTABLE');
   const history=await checkPrivateGoalVersionHistory({store,scope,head,crypto,inputs:request.inputs,workflow:result,
    checkAccess(){if(principal.expiresAtMs!==undefined&&(!timestamp(principal.expiresAtMs)||clock()>=principal.expiresAtMs))fail('UNAUTHORIZED');}});
   result=applyPrivateGoalHistory(result,history);
   const revision=head.revision+1;if(!Number.isSafeInteger(revision))fail('REVISION_EXHAUSTED');
   // Async crypto completes before transaction. Store rechecks scope/revision under its synchronous transaction.
   async function seal(value,kind,id){const payload=canonicalJson(value,524288),sealed=await crypto.seal(payload,context(scope,kind,id));
    if(!envelopeValid(sealed))fail('INVALID_CRYPTO_RESULT');return sealed;}
   const sealedInput=await seal(request.inputs,'INPUT',String(revision));
   const sealedAnalysis=await seal({analysisEnvelopeVersion:2,provenance:{analysisEnvelopeVersion:2,...release,inputSchemaVersion:1,
    analysisRevision:revision,previousRevision:head.revision,generatedAtMs:nowMs,inputCutoffMs:result.inputCutoffMs,
    policyVersion:scope.policyEpoch,restoreEpoch:scope.restoreEpoch,requestId:request.requestId,inputTag:payloadTag,policyTag},
    policySnapshot:policy,workflow:result},'ANALYSIS',String(revision));
   const sealedState=await seal(result.events.state,'EVENT_STATE',String(revision));
   const outbox=[];
   for(const intent of result.events.intents){if(!intentId(intent?.intentId))fail('WORKFLOW_NOT_COMMITTABLE');
    outbox.push({intentId:intent.intentId,sealedPayload:await seal(intent,'OUTBOX',intent.intentId)});}
   if(principal.expiresAtMs!==undefined&&(!timestamp(principal.expiresAtMs)||clock()>=principal.expiresAtMs))fail('UNAUTHORIZED');
   const committed=store.commit({scope,expectedRevision:head.revision,requestId:request.requestId,payloadTag,
    resultStatus:result.events.status,generatedAtMs:nowMs,inputCutoffMs:result.inputCutoffMs,sealedInput,sealedAnalysis,sealedState,outbox});
   return okReceipt(committed,committed.replayed);
  }catch(error){return {status:'REJECTED',code:error instanceof PrivateStorageError&&allowedErrors.has(error.code)?error.code:'PRIVATE_DEPENDENCY_FAILURE',
    stateHandling:'RETAIN_ACCEPTED_STATE_UNCHANGED',notificationStatus:'NOT_SENT'};}
 }
 return {submit};
}
