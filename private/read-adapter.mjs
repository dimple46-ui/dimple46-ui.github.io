// Offline private reader: fixed snapshot SELECT + authenticated minimal as-of projection, no mutation or initialization.
import {fail,scopeValid,sameScope,timestamp,context,envelopeValid} from './storage-contract.mjs';
import {savedWorkflowView} from './saved-analysis-view.mjs';
import {openPrivateAnalysis} from './analysis-provenance.mjs';
export function createPrivateReadAdapter({authorize,getStore,crypto,clock,maxAnalysisAgeMs,maxInputAgeMs,readRole='OWNER_READ'}={}){
 if(![authorize,getStore,clock].every(x=>typeof x==='function')||!['open','tag'].every(k=>typeof crypto?.[k]==='function')||
  ![maxAnalysisAgeMs,maxInputAgeMs].every(x=>Number.isSafeInteger(x)&&x>=0)||!['OWNER_READ','MACHINE_READ'].includes(readRole))throw new TypeError('INVALID_PRIVATE_READ_CONFIGURATION');
 const unavailable=()=>fail('PRIVATE_READ_UNAVAILABLE');
 function authValid(p){return p?.verified===true&&scopeValid(p)&&Array.isArray(p.roles)&&p.roles.includes(readRole)&&
  timestamp(p.expiresAtMs)&&timestamp(clock())&&clock()<p.expiresAtMs;}
 async function access(credential,execution){
  if(execution?.signal?.aborted)unavailable();const p=await authorize(credential,readRole);if(!authValid(p))fail('UNAUTHORIZED');
  const principal=Object.freeze({schemaVersion:p.schemaVersion,ownerRef:p.ownerRef,authorizationEpoch:p.authorizationEpoch,
   policyEpoch:p.policyEpoch,restoreEpoch:p.restoreEpoch,verified:true,roles:[...p.roles],expiresAtMs:p.expiresAtMs});
  const store=await getStore(principal.ownerRef);if(!authValid(principal))fail('UNAUTHORIZED');if(execution?.signal?.aborted)unavailable();return {principal,store};
 }
 function validHead(h,p){return sameScope(h,p)&&['ACTIVE','MAINTENANCE_FROZEN'].includes(h.mode)&&Number.isSafeInteger(h.revision)&&h.revision>=0&&
  envelopeValid(h.sealedState)&&(h.revision===0?h.generatedAtMs===0&&h.inputCutoffMs===0:
   timestamp(h.generatedAtMs)&&timestamp(h.inputCutoffMs)&&h.inputCutoffMs<=h.generatedAtMs&&h.generatedAtMs<=clock());}
 async function readStatus({credential,execution}={}){
  const {principal,store}=await access(credential,execution),h=store.readHead();if(!validHead(h,principal))unavailable();
  return {schemaVersion:1,mode:h.mode,revision:h.revision,generatedAtMs:h.revision===0?null:h.generatedAtMs,inputCutoffMs:h.revision===0?null:h.inputCutoffMs};
 }
 async function readAnalysis({credential,execution}={}){
  const {principal,store}=await access(credential,execution),snapshot=store.readAnalysisSnapshot(principal),h=snapshot?.head;
  if(!validHead(h,principal)||h.mode!=='ACTIVE')unavailable();if(!snapshot.version)fail('ANALYSIS_NOT_AVAILABLE');
  const v=snapshot.version;if(v.revision!==h.revision)unavailable();
  const envelope=await crypto.open(v.sealedAnalysis,context(principal,'ANALYSIS',String(v.revision)));
  const {workflow,provenance}=await openPrivateAnalysis(crypto,envelope,h,principal);
  if(!authValid(principal))fail('UNAUTHORIZED');if(execution?.signal?.aborted)unavailable();
  const current=store.readHead();if(!validHead(current,principal)||current.mode!=='ACTIVE')unavailable();
  if(current.revision!==h.revision||current.generatedAtMs!==h.generatedAtMs||current.inputCutoffMs!==h.inputCutoffMs)fail('SNAPSHOT_CHANGED');
  return savedWorkflowView(workflow,h,{maxAnalysisAgeMs,maxInputAgeMs},clock(),provenance);
 }
 // Dependency exceptions intentionally become a fixed code, never financial/key/actor details.
 const safe=fn=>async args=>{try{return await fn(args);}catch(error){if(['UNAUTHORIZED','ANALYSIS_NOT_AVAILABLE','SNAPSHOT_CHANGED'].includes(error?.code))fail(error.code);unavailable();}};
 return {readStatus:safe(readStatus),readAnalysis:safe(readAnalysis)};
}
