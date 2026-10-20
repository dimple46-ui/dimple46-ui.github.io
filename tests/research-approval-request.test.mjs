// Fictional local requests only. No actual approval files, authentication service or storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseResearchApprovalImportRequest} from '../private/research-approval-request.mjs';
const now=1792148400000;
const pkg=()=>JSON.parse(readFileSync(new URL('../examples/research-package.synthetic.json',import.meta.url)));
function request(){const p=pkg();return {schema_version:1,request_id:'fictional-import-1',expected_revision:0,
 approval_request:{schema_version:1,receipt_ref:'fictional-authority-receipt',package_id:p.package_id,revision:p.revision,content_sha256:p.content_sha256,decision:'APPROVE'},package:p};}
const parse=r=>parseResearchApprovalImportRequest(r,{nowMs:now});
test('closed request detaches/freezes input, canonicalizes key order and preserves authority as unverified',()=>{
 const r=request(),before=structuredClone(r),a=parse(r),b=parse(Object.fromEntries(Object.entries(r).reverse()));
 assert.deepEqual(r,before);assert.deepEqual(a,b);assert.equal(a.trust,'UNAUTHENTICATED_INPUT_ONLY');assert.equal(a.engine_approval,'NOT_GRANTED');
 assert.throws(()=>a.request.approval_request.decision='WITHDRAW',TypeError);
 assert.throws(()=>a.request.package.claims.push({}),TypeError);
});
test('request cannot inject owner, role, scope, proof, engine grant, credentials or arbitrary execution fields',()=>{
 for(const mutate of [r=>r.ownerRef='other',r=>r.scope={ownerRef:'other'},r=>r.role='USER_APPROVER',r=>r.verified=true,
  r=>r.proof={verified:true},r=>r.credential='FICTIONAL_PRIVATE_SENTINEL',r=>r.sql='DELETE FROM anything',
  r=>r.approval_request.verified=true,r=>r.approval_request.proof={},r=>r.package.approved=true]){
  const r=request();mutate(r);assert.throws(()=>parse(r),e=>e.code==='INVALID_RESEARCH_APPROVAL_REQUEST'&&!e.message.includes('PRIVATE_SENTINEL'));
 }
});
test('exact package/version/hash binding, explicit decision and finite revision are mandatory',()=>{
 for(const mutate of [r=>r.approval_request.package_id='wrong',r=>r.approval_request.revision++,r=>r.approval_request.content_sha256='a'.repeat(64),
  r=>r.approval_request.decision='APPROVE_TRADE',r=>r.expected_revision=-1,r=>r.expected_revision=NaN,r=>r.expected_revision=Infinity,
  r=>r.expected_revision=Number.MAX_SAFE_INTEGER,r=>r.expected_revision=1.5,r=>r.request_id='',r=>r.approval_request.receipt_ref='']){
  const r=request();mutate(r);assert.throws(()=>parse(r),/INVALID_RESEARCH_APPROVAL_REQUEST/);
 }
 for(const k of Object.keys(request())){const r=request();delete r[k];assert.throws(()=>parse(r));}
});
test('future/mutated/missing-digest packages are rejected without auto-sealing; expired withdrawal stays structurally parseable',()=>{
 const future=request();assert.throws(()=>parseResearchApprovalImportRequest(future,{nowMs:future.package.generated_at_ms-1}));
 const changed=request();changed.package.thesis.state='ADVERSE';assert.throws(()=>parse(changed));
 const unsigned=request();delete unsigned.package.content_sha256;assert.throws(()=>parse(unsigned));
 const withdrawal=request();withdrawal.approval_request.decision='WITHDRAW';
 assert.equal(parseResearchApprovalImportRequest(withdrawal,{nowMs:withdrawal.package.expires_at_ms+1}).request.approval_request.decision,'WITHDRAW');
});
test('unsafe objects, cycles, accessors, oversize and invalid reference times fail without evaluating user code',()=>{
 let invoked=false;const accessor=request();Object.defineProperty(accessor,'extra',{enumerable:true,get(){invoked=true;return 'secret';}});
 assert.throws(()=>parse(accessor));assert.equal(invoked,false);
 const cyc=request();cyc.package=cyc;assert.throws(()=>parse(cyc));
 const huge=request();huge.package.claims[0].text='x'.repeat(140000);assert.throws(()=>parse(huge));
 for(const value of [null,[],Object.create({owner:'other'}),undefined])assert.throws(()=>parse(value));
 for(const n of [NaN,Infinity,-1,0])assert.throws(()=>parseResearchApprovalImportRequest(request(),{nowMs:n}));
});
test('same request is reproducible; changed request ID/revision/decision alters only the request digest and never records approval',()=>{
 const a=parse(request());for(const change of [r=>r.request_id='fictional-import-2',r=>r.expected_revision=1,r=>r.approval_request.decision='WITHDRAW']){
  const r=request();change(r);const b=parse(r);assert.notEqual(a.payload_sha256,b.payload_sha256);assert.equal(a.request.package.content_sha256,b.request.package.content_sha256);
  assert.equal(b.engine_approval,'NOT_GRANTED');
 }
});
