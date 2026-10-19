// Synthetic authority test doubles only; no existing user approval, credentials or private data are loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createResearchApprovalPreflight} from '../private/research-approval-preflight.mjs';
const at=1792148400000;
const scope={schemaVersion:1,ownerRef:'fictional-owner',authorizationEpoch:'a1',policyEpoch:'p1',restoreEpoch:'r1'};
function body(){const p=JSON.parse(readFileSync(new URL('../examples/research-package.synthetic.json',import.meta.url)));return {
 schema_version:1,request_id:'fictional-request',expected_revision:0,package:p,approval_request:{schema_version:1,
 receipt_ref:'fictional-receipt',package_id:p.package_id,revision:1,content_sha256:p.content_sha256,decision:'APPROVE'}};}
const principal=()=>({...scope,verified:true,roles:['RESEARCH_APPROVAL_IMPORT'],expiresAtMs:at+10000});
function fixture(overrides={}){let calls=0;const boundary=createResearchApprovalPreflight({clock:()=>at,authorize:async()=>principal(),
 resolveDecision:async({request:r,expectedScope})=>{calls++;assert.deepEqual(expectedScope,scope);return {...r,verified:true,role:'USER_APPROVER',
 source_kind:'AUTHENTICATED_USER_DECISION',scope,decided_at_ms:at-1000,source_recorded_at_ms:at-500};},...overrides});
 return {boundary,lookups:()=>calls};}
test('unauthorized, read-only or expired principals reject before parsing body or resolving source',async()=>{
 let invoked=false;const request=Object.defineProperty({},'schema_version',{enumerable:true,get(){invoked=true;throw Error('BODY_EVALUATED');}});
 for(const p of [null,{...principal(),verified:false},{...principal(),roles:['MACHINE_READ']},{...principal(),expiresAtMs:at},
  {...principal(),expiresAtMs:null},{...principal(),ownerRef:''}]){
  const f=fixture({authorize:async()=>p}),r=await f.boundary.prepare({credential:'fictional',request});assert.equal(r.code,'UNAUTHORIZED');assert.equal(f.lookups(),0);
 }assert.equal(invoked,false);
});
test('authorized request flows through strict parsing and trusted scoped lookup to immutable staging only',async()=>{
 const f=fixture(),r=await f.boundary.prepare({credential:'fictional',request:body()});assert.equal(f.lookups(),1);
 assert.equal(r.status,'STAGING_PREPARED_NOT_COMMITTED');assert.equal(r.expected_revision,0);assert.equal(r.engine_approval,'NOT_GRANTED');
 assert.throws(()=>r.plan.scope.ownerRef='other',TypeError);assert.ok(!JSON.stringify(r).includes('credential'));
});
test('client scope/proof and malformed version are refused before trusted source lookup',async()=>{
 for(const change of [b=>b.scope=scope,b=>b.proof={verified:true},b=>b.expected_revision=-1,b=>b.approval_request.role='USER_APPROVER']){
  const b=body();change(b);const f=fixture(),r=await f.boundary.prepare({request:b});
  assert.equal(r.code,'INVALID_RESEARCH_APPROVAL_REQUEST');assert.equal(r.write_outcome,'NOT_ATTEMPTED');assert.equal(f.lookups(),0);
 }
});
test('authorization expiry during lookup discards plan without a write or engine grant',async()=>{
 let now=at;const f=fixture({clock:()=>now,authorize:async()=>({...principal(),expiresAtMs:at+10}),resolveDecision:async({request:r})=>{
  now=at+10;return {...r,verified:true,role:'USER_APPROVER',source_kind:'AUTHENTICATED_USER_DECISION',scope,decided_at_ms:at-1000,source_recorded_at_ms:at-500};}});
 const r=await f.boundary.prepare({request:body()});assert.equal(r.code,'UNAUTHORIZED');assert.equal(r.plan,undefined);assert.equal(r.write_outcome,'NOT_ATTEMPTED');
});
test('authorizer/source/clock errors never expose credential, raw exceptions or partial plans',async()=>{
 for(const override of [{authorize:async()=>{throw Error('FICTIONAL_SECRET_SENTINEL');}},
  {resolveDecision:async()=>{throw Error('FICTIONAL_SECRET_SENTINEL');}},{clock:()=>{throw Error('FICTIONAL_SECRET_SENTINEL');}}]){
  const f=fixture(override),r=await f.boundary.prepare({credential:'FICTIONAL_SECRET_SENTINEL',request:body()});
  assert.equal(r.status,'REJECTED');assert.equal(r.engine_approval,'NOT_GRANTED');assert.equal(r.plan,undefined);assert.ok(!JSON.stringify(r).includes('SECRET_SENTINEL'));
 }
});
test('trusted receipt for a different owner cannot become a prepared plan',async()=>{
 const f=fixture({resolveDecision:async({request:r})=>({...r,verified:true,role:'USER_APPROVER',source_kind:'AUTHENTICATED_USER_DECISION',
 scope:{...scope,ownerRef:'other'},decided_at_ms:at-1000,source_recorded_at_ms:at-500})});
 assert.equal((await f.boundary.prepare({request:body()})).code,'TRUSTED_DECISION_NOT_VERIFIED');
});
test('no default provider dependencies; duplicate identical requests stay deterministic and cause no persistence',async()=>{
 assert.throws(()=>createResearchApprovalPreflight(),/TRUSTED_PREFLIGHT_DEPENDENCIES_REQUIRED/);
 const f=fixture(),a=await f.boundary.prepare({request:body()}),b=await f.boundary.prepare({request:body()});assert.deepEqual(a,b);
 assert.equal(a.status,'STAGING_PREPARED_NOT_COMMITTED');assert.equal(f.lookups(),2);
});
test('outer authorization/parser clock cannot roll back before planner, or cross the research deadline on final return',async()=>{
 let calls=0;const f=fixture({clock:()=>calls++===0?at:at-1});
 assert.equal((await f.boundary.prepare({request:body()})).code,'IMPORT_CLOCK_REGRESSION');
 calls=0;const b=body(),g=fixture({clock:()=>++calls===4?b.package.review_at_ms:at,authorize:async()=>({...principal(),expiresAtMs:b.package.review_at_ms+1})});
 assert.equal((await g.boundary.prepare({request:b})).code,'RESEARCH_REVIEW_OR_EXPIRY_DUE');
});
test('temporary outer clock rollback rejects before lookup even if later readings recover',async()=>{
 const ticks=[at,at-1,at,at];let reads=0;
 const f=fixture({clock:()=>ticks[reads++]}),r=await f.boundary.prepare({request:body()});
 assert.equal(r.code,'IMPORT_CLOCK_REGRESSION');assert.equal(r.status,'REJECTED');
 assert.equal(r.plan,undefined);assert.equal(r.write_outcome,'NOT_ATTEMPTED');assert.equal(f.lookups(),0);
});
