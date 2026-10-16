// Explicit local file handoff only. Never fetches URLs, authenticates, approves, deploys or logs the package body.
import {readFileSync} from 'node:fs';
import {validateResearchPackage} from '../domain/research-handoff.mjs';
import {prepareResearchDraft} from '../domain/research-draft-review.mjs';
try{
 const [path,nowText,...extra]=process.argv.slice(2);if(!path||!nowText||extra.length>1||extra.length===1&&extra[0]!=='--draft')throw Error('INVALID_ARGUMENTS');
 const bytes=readFileSync(path);if(bytes.byteLength>131072)throw Error('PACKAGE_TOO_LARGE');
 const input=JSON.parse(bytes.toString('utf8')),prepared=extra.length?prepareResearchDraft(input,{nowMs:Number(nowText)}):null;
 const v=validateResearchPackage(prepared?prepared.sealedPackage:input,{nowMs:Number(nowText)});
 console.log(JSON.stringify({status:v.status,package_id:v.package.package_id,revision:v.package.revision,content_sha256:v.contentSha256,
  sources:v.package.sources.length,claims:v.package.claims.length,evidence_verification:v.evidenceVerification,approval:'NOT_RECORDED',operational:'NOT_DEPLOYED',
  ...(prepared?{draft_preparation:{integrity:prepared.review.integrity,temporal_status:prepared.review.temporal_status,received:'NOT_RECORDED',manual_checks:prepared.review.manual_checks}}:{})}));
}catch{console.error(JSON.stringify({status:'REJECTED',code:'RESEARCH_PACKAGE_VALIDATION_FAILED'}));process.exitCode=1;}
