// Explicit local file handoff only. Never fetches URLs, authenticates, approves, deploys or logs the package body.
import {openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {validateResearchPackage} from '../domain/research-handoff.mjs';
import {prepareResearchDraft} from '../domain/research-draft-review.mjs';
import {prepareGeneralResearchDraft} from '../domain/research-general-draft.mjs';
const MAX_INPUT_BYTES=131072;
function readBounded(path){
 let fd;
 try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=fstatSync(fd);if(!stat.isFile()||stat.size>MAX_INPUT_BYTES)throw Error('INVALID_FILE');
  const buffer=Buffer.alloc(MAX_INPUT_BYTES+1);let length=0,count;
  while(length<buffer.length&&(count=readSync(fd,buffer,length,buffer.length-length,null))>0)length+=count;
  if(length>MAX_INPUT_BYTES)throw Error('PACKAGE_TOO_LARGE');
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,length));
 }finally{if(fd!==undefined)closeSync(fd);}
}
function generalProjection(input,nowMs){
 const v=prepareGeneralResearchDraft(input,{nowMs});
 const condition=c=>({status:c.status,basis:c.basis,at_ms:c.at_ms,
  ...(c.date===undefined?{}:{date:c.date,timezone:c.timezone})});
 return {schema_version:2,status:v.status,package_id:v.draft.package_id,revision:v.draft.revision,
  content_sha256:v.content_sha256,sources:v.draft.sources.length,claims:v.draft.claims.length,
  checked_at_ms:v.checked_at_ms,input_cutoff_ms:v.input_cutoff_ms,temporal_status:v.temporal_status,
  lifecycle:{review:condition(v.lifecycle.review),expiry:condition(v.lifecycle.expiry)},
  classification_pending:v.classification_pending,historical_availability:v.historical_availability,
  historical_replay_allowed:false,source_verification:v.source_verification,
  report_comparison_status:v.report_comparison.status,approval:v.approval,receipt:v.receipt,
  consumer_status:v.consumer_status,operational:v.operations,private_valuation:null,trade_quantities:null};
}
try{
 const [path,nowText,...extra]=process.argv.slice(2);
 if(!path||!nowText||extra.length>1||extra.length===1&&!['--draft','--general-draft'].includes(extra[0]))throw Error('INVALID_ARGUMENTS');
 const input=JSON.parse(readBounded(path)),nowMs=Number(nowText);
 if(extra[0]==='--general-draft')console.log(JSON.stringify(generalProjection(input,nowMs)));
 else{
  const prepared=extra.length?prepareResearchDraft(input,{nowMs}):null;
  const v=validateResearchPackage(prepared?prepared.sealedPackage:input,{nowMs});
  console.log(JSON.stringify({status:v.status,package_id:v.package.package_id,revision:v.package.revision,content_sha256:v.contentSha256,
   sources:v.package.sources.length,claims:v.package.claims.length,evidence_verification:v.evidenceVerification,approval:'NOT_RECORDED',operational:'NOT_DEPLOYED',
   ...(prepared?{draft_preparation:{integrity:prepared.review.integrity,temporal_status:prepared.review.temporal_status,received:'NOT_RECORDED',manual_checks:prepared.review.manual_checks}}:{})}));
 }
}catch{console.error(JSON.stringify({status:'REJECTED',code:'RESEARCH_PACKAGE_VALIDATION_FAILED'}));process.exitCode=1;}
