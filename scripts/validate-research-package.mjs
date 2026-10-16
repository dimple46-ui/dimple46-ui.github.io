// Explicit local file handoff only. Never fetches URLs, authenticates, approves, deploys or logs the package body.
import {readFileSync} from 'node:fs';
import {validateResearchPackage} from '../domain/research-handoff.mjs';
try{
 const [path,nowText,...extra]=process.argv.slice(2);if(!path||!nowText||extra.length)throw Error('INVALID_ARGUMENTS');
 const bytes=readFileSync(path);if(bytes.byteLength>131072)throw Error('PACKAGE_TOO_LARGE');
 const v=validateResearchPackage(JSON.parse(bytes.toString('utf8')),{nowMs:Number(nowText)});
 console.log(JSON.stringify({status:v.status,package_id:v.package.package_id,revision:v.package.revision,content_sha256:v.contentSha256,
  sources:v.package.sources.length,claims:v.package.claims.length,evidence_verification:v.evidenceVerification,approval:'NOT_RECORDED',operational:'NOT_DEPLOYED'}));
}catch{console.error(JSON.stringify({status:'REJECTED',code:'RESEARCH_PACKAGE_VALIDATION_FAILED'}));process.exitCode=1;}
