// Shared strict input shape, used before private transport dispatch and again by the trusted adapter.
import {canonicalJson,opaqueId,fail} from './storage-contract.mjs';
export function parsePrivateInputRequest(value){
 const canonical=canonicalJson(value),request=JSON.parse(canonical);
 if(!request||Array.isArray(request)||Object.keys(request).sort().join(',')!=='expectedRevision,inputs,requestId,schemaVersion'||
  request.schemaVersion!==1||!opaqueId(request.requestId)||!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0||
  !request.inputs||Array.isArray(request.inputs)||typeof request.inputs!=='object'||
  Object.keys(request.inputs).some(k=>!['ledger','prices','scenario','schedule','collateralInput','goalPlan'].includes(k)))fail('INVALID_REQUEST');
 return {request,canonical};
}
