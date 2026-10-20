// All approval services, identities and packages in this file are synthetic test doubles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createResearchApprovalImportPlanner,approvalImportGenesis,inspectApprovalImportJournal,proposeApprovalImportAppend} from '../domain/research-approval-import.mjs';
import {researchHash} from '../domain/research-handoff.mjs';
const at=1792148400000;
const pkg=()=>JSON.parse(readFileSync(new URL('../examples/research-package.synthetic.json',import.meta.url)));
const scope={schemaVersion:1,ownerRef:'fictional-owner',authorizationEpoch:'auth1',policyEpoch:'policy1',restoreEpoch:'restore1'};
const request=(decision='APPROVE',ref='fictional-receipt-1')=>({schema_version:1,receipt_ref:ref,package_id:pkg().package_id,revision:1,content_sha256:pkg().content_sha256,decision});
const proof=r=>({...r,verified:true,role:'USER_APPROVER',source_kind:'AUTHENTICATED_USER_DECISION',scope,decided_at_ms:at-1000,source_recorded_at_ms:at-500});
const planner=(resolveDecision=async({request:r})=>proof(r),clock=()=>at)=>createResearchApprovalImportPlanner({resolveDecision,clock});
const prepare=(r=request(),p=planner())=>p.prepare({request:r,package:pkg(),expectedScope:scope});
const append=(plan,entries=[],head=approvalImportGenesis(),now=at)=>proposeApprovalImportAppend({plan,entries,expectedHead:head,expectedScope:scope,nowMs:now});
const inspect=(entries,head,asOf=at,now=at,expectedScope=scope)=>inspectApprovalImportJournal({entries,expectedHead:head,expectedScope,asOfMs:asOf,nowMs:now});
const code=c=>e=>e.code===c;
test('planner requires explicit trusted dependencies; a conversation record or self-declared approval is not a source proof',async()=>{
 assert.throws(()=>createResearchApprovalImportPlanner(),code('TRUSTED_IMPORT_DEPENDENCIES_REQUIRED'));
 await assert.rejects(()=>prepare(request(),planner(async()=>({record_type:'USER_CONVERSATION_CONTENT_APPROVAL',decision:'APPROVE_RESEARCH_CONTENT'}))),code('TRUSTED_DECISION_NOT_VERIFIED'));
 await assert.rejects(()=>prepare(request(),planner(async({request})=>request)),code('TRUSTED_DECISION_NOT_VERIFIED'));
});
test('staging preserves original decision/source-record times and never constructs a new engine approval',async()=>{
 const r=request(),before=structuredClone(r),p=await prepare(r);
 assert.deepEqual(r,before);assert.equal(p.source_decided_at_ms,at-1000);assert.equal(p.source_recorded_at_ms,at-500);assert.equal(p.imported_at_ms,at);
 assert.equal(p.effect,'STAGING_ONLY_NOT_ENGINE_APPROVAL');assert.equal(p.request.content_sha256,pkg().content_sha256);
 assert.throws(()=>p.request.decision='WITHDRAW',TypeError);
 const result=append(p);assert.equal(result.status,'APPEND_PROPOSED_NOT_COMMITTED');assert.equal(result.engine_approval,'NOT_GRANTED');
});
test('exact revision/hash/decision/receipt, authority source and owner/epoch are bound before preparing',async()=>{
 for(const mutate of [p=>p.verified=false,p=>p.role='PROJECT_AUTHOR',p=>p.source_kind='PROJECT_AUTHOR',p=>p.package_id='another',p=>p.revision++,p=>p.content_sha256='a'.repeat(64),
  p=>p.decision='WITHDRAW',p=>p.receipt_ref='other',p=>p.scope={...scope,ownerRef:'other'},p=>p.scope={...scope,restoreEpoch:'restore2'}]){
  await assert.rejects(()=>prepare(request(),planner(async({request:r})=>{const p=proof(r);mutate(p);return p;})),code('TRUSTED_DECISION_NOT_VERIFIED'));
 }
 await assert.rejects(()=>prepare({...request(),content_sha256:'a'.repeat(64)}),code('IMPORT_PACKAGE_BINDING_MISMATCH'));
 await assert.rejects(()=>prepare({...request(),sql:'SELECT 1'}),code('INVALID_IMPORT_REQUEST'));
});
test('future or invalid source time, backdated decisions, expired approval, clock regression and source errors fail closed',async()=>{
 for(const mutate of [p=>p.decided_at_ms=at+1,p=>p.source_recorded_at_ms=at+1,p=>p.source_recorded_at_ms=p.decided_at_ms-1,p=>p.decided_at_ms=pkg().generated_at_ms-1]){
  await assert.rejects(()=>prepare(request(),planner(async({request:r})=>{const p=proof(r);mutate(p);return p;})),code('INVALID_SOURCE_DECISION_TIME'));
 }
 await assert.rejects(()=>prepare(request(),planner(undefined,()=>pkg().review_at_ms)),code('RESEARCH_REVIEW_OR_EXPIRY_DUE'));
 let calls=0;await assert.rejects(()=>prepare(request(),planner(undefined,()=>calls++?at-1:at)),code('IMPORT_CLOCK_REGRESSION'));
 let ticks=0;await assert.rejects(()=>prepare(request(),planner(undefined,()=>ticks++?pkg().review_at_ms:at)),code('RESEARCH_REVIEW_OR_EXPIRY_DUE'));
 await assert.rejects(()=>prepare(request(),planner(undefined,()=>{throw Error('PRIVATE_CLOCK');})),code('IMPORT_CLOCK_FAILED'));
 await assert.rejects(()=>prepare(request(),planner(async()=>{throw Error('DO_NOT_EXPOSE_PRIVATE_SOURCE');})),e=>e.code==='TRUSTED_DECISION_LOOKUP_FAILED'&&!e.message.includes('PRIVATE_SOURCE'));
});
test('serialization/restart keeps import knowledge time: earlier source approval never becomes available before local import',async()=>{
 const first=append(await prepare());const disk=JSON.parse(JSON.stringify(first.entries));
 const past=inspect(disk,first.head,at-1);assert.equal(past.visible_entries.length,0);
 const present=inspect(disk,first.head);assert.equal(present.visible_entries.length,1);assert.equal(present.authentication,'NOT_PROVEN_BY_HASH_CHAIN');
 assert.equal(present.persistence,'CALLER_STORAGE_NOT_IMPLEMENTED');assert.equal(present.engine_approval,'NOT_GRANTED');
 assert.deepEqual(inspect(disk,first.head),inspect(disk,first.head));
});
test('receipt retry at a later import time is idempotent; changed trusted proof using same receipt conflicts',async()=>{
 const initial=await prepare(),first=append(initial);
 const later=await prepare(request(),planner(undefined,()=>at+100));assert.notEqual(later.plan_hash,initial.plan_hash);
 const duplicate=append(later,first.entries,first.head,at+100);assert.equal(duplicate.status,'DUPLICATE_NO_APPEND');assert.equal(duplicate.head.event_hash,first.head.event_hash);
 const conflict=await prepare(request(),planner(async({request:r})=>({...proof(r),source_recorded_at_ms:at-400}),()=>at+100));
 assert.throws(()=>append(conflict,first.entries,first.head,at+100),code('IMPORT_RECEIPT_CONFLICT'));
});
test('withdrawal is append-only, survives serialized history and cannot reactivate the same revision',async()=>{
 const first=append(await prepare());
 const withdrawal=await prepare(request('WITHDRAW','withdraw-1'),planner(async({request:r})=>({...proof(r),decided_at_ms:at+100,source_recorded_at_ms:at+100}),()=>at+100));
 const second=append(withdrawal,first.entries,first.head,at+100);
 assert.equal(second.entries[0].event_hash,first.entries[0].event_hash);assert.equal(inspect(second.entries,second.head,at,at+100).visible_entries.length,1);
 const reactivation=await prepare(request('APPROVE','approve-later'),planner(async({request:r})=>({...proof(r),decided_at_ms:at+200,source_recorded_at_ms:at+200}),()=>at+200));
 assert.throws(()=>append(reactivation,JSON.parse(JSON.stringify(second.entries)),second.head,at+200),code('WITHDRAWAL_REQUIRES_NEW_REVISION'));
});
test('withdrawal may be imported even after package review/expiry so revocation is never blocked by freshness',async()=>{
 const late=pkg().expires_at_ms+1;
 const p=await prepare(request('WITHDRAW'),planner(async({request:r})=>({...proof(r),decided_at_ms:late-1,source_recorded_at_ms:late}),()=>late));
 assert.equal(append(p,[],approvalImportGenesis(),late).entries[0].plan.request.decision,'WITHDRAW');
});
test('trusted head detects truncation/stale append; checksum detects corruption; scope and as-of bounds are enforced',async()=>{
 const first=append(await prepare());
 assert.throws(()=>inspect([],first.head),code('TRUSTED_JOURNAL_HEAD_MISMATCH'));
 assert.throws(()=>append(first.entries[0].plan,first.entries,approvalImportGenesis()),code('TRUSTED_JOURNAL_HEAD_MISMATCH'));
 const corrupt=structuredClone(first.entries);corrupt[0].plan.request.decision='WITHDRAW';
 assert.throws(()=>inspect(corrupt,first.head),code('IMPORT_PLAN_HASH_MISMATCH'));
 assert.throws(()=>inspect(first.entries,first.head,at,at,{...scope,policyEpoch:'policy2'}),code('JOURNAL_SCOPE_MISMATCH'));
 assert.throws(()=>inspect(first.entries,first.head,at+1),code('INVALID_JOURNAL_INPUT'));
});
test('out-of-order source decisions cannot erase newer state even with a different receipt',async()=>{
 const first=append(await prepare());
 const old=await prepare(request('WITHDRAW','older-source'),planner(async({request:r})=>({...proof(r),source_recorded_at_ms:at-800}),()=>at+1));
 assert.throws(()=>append(old,first.entries,first.head,at+1),code('SOURCE_DECISION_OUT_OF_ORDER'));
 // Client-recomputed hashes cannot authenticate an authority; integrity API explicitly reports this limit.
 assert.equal(researchHash(first.entries[0].plan.request).length,64);
});
