import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareResearchDraft} from '../domain/research-draft-review.mjs';
const now=1792148400000;
const fixture=()=>JSON.parse(readFileSync(new URL('../examples/research-package.synthetic.json',import.meta.url)));
const draft=()=>{const {content_sha256,...body}=fixture();return body;};
test('unsigned preparation preserves every semantic field, computes the existing canonical hash and is deterministic',()=>{
 const p=draft(),before=structuredClone(p),r=prepareResearchDraft(p,{nowMs:now});
 assert.deepEqual(p,before);assert.deepEqual(r.sealedPackage,fixture());assert.deepEqual(r,prepareResearchDraft(p,{nowMs:now}));
 assert.equal(r.review.integrity,'MISSING_HASH_COMPUTED');assert.equal(r.review.approval,'NOT_RECORDED');assert.equal(r.review.received,'NOT_RECORDED');
 assert.match(r.review.operational,/NOT_WATCH_READY/);assert.throws(()=>r.sealedPackage.thesis.state='ADVERSE',TypeError);
 assert.throws(()=>r.review.claims[0].source_refs.push('changed'),TypeError);
});
test('valid supplied hash remains verified; supplied wrong, empty or null hash is never repaired',()=>{
 assert.equal(prepareResearchDraft(fixture(),{nowMs:now}).review.integrity,'EXISTING_HASH_VERIFIED');
 for(const digest of ['0'.repeat(64),'',null])assert.throws(()=>prepareResearchDraft({...fixture(),content_sha256:digest},{nowMs:now}));
 const p=fixture();p.thesis.state='ADVERSE';assert.throws(()=>prepareResearchDraft(p,{nowMs:now}),e=>e.code==='CONTENT_HASH_MISMATCH');
});
test('preparation flags review and expiry boundaries without renewing timestamps or granting approval',()=>{
 const p=draft();
 for(const [at,status] of [[now,'WITHIN_DECLARED_REVIEW_WINDOW'],[p.review_at_ms,'REVIEW_DUE'],[p.expires_at_ms,'EXPIRED']]){
  const r=prepareResearchDraft(p,{nowMs:at});assert.equal(r.review.temporal_status,status);assert.deepEqual(r.sealedPackage,fixture());
  assert.equal(r.review.approval,'NOT_RECORDED');
 }
});
test('unsigned intake does not bypass closed fields, evidence, unit, future-time or size validation',()=>{
 for(const change of [p=>p.status='APPROVED',p=>p.holdings=[],p=>p.claims[0].source_refs=['missing'],
  p=>p.claims[0].quantity.unit='KRW',p=>p.generated_at_ms=now+1,p=>p.claims[0].text='x'.repeat(140000)]){
  const p=draft();change(p);assert.throws(()=>prepareResearchDraft(p,{nowMs:now}));
 }
 assert.throws(()=>prepareResearchDraft(draft(),{nowMs:NaN}));
});
test('draft CLI is explicit, outputs only sanitized metadata, rejects invalid options and never repairs supplied digests',()=>{
 const dir=mkdtempSync(join(tmpdir(),'research-draft-test-')),path=join(dir,'draft.json');
 const run=(...args)=>spawnSync(process.execPath,['scripts/validate-research-package.mjs',path,String(now),...args],{encoding:'utf8'});
 try{
  writeFileSync(path,JSON.stringify(draft()));assert.equal(run().status,1);
  const r=run('--draft');assert.equal(r.status,0);const receipt=JSON.parse(r.stdout);
  assert.equal(receipt.content_sha256,fixture().content_sha256);assert.equal(receipt.draft_preparation.received,'NOT_RECORDED');
  for(const value of [draft().claims[0].text,draft().sources[0].url,'sealedPackage'])assert.ok(!r.stdout.includes(value));
  assert.equal(run('--approve').status,1);assert.equal(run('--draft','--draft').status,1);
  writeFileSync(path,JSON.stringify({...draft(),content_sha256:'0'.repeat(64)}));assert.equal(run('--draft').status,1);
  writeFileSync(path,JSON.stringify({...draft(),secret:'FICTIONAL_PRIVATE_SENTINEL'}));const bad=run('--draft');
  assert.equal(bad.status,1);assert.ok(!bad.stderr.includes(path)&&!bad.stderr.includes('FICTIONAL_PRIVATE_SENTINEL'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
