// Synthetic compatibility/failure tests only. Memory SQLite and marker codec are not provider durability or encryption evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {PRIVATE_STORAGE_SCHEMA_V1,createPrivateTransactionStore} from '../private/transaction-store.mjs';
import {createResearchApprovalImportPlanner,approvalImportGenesis,proposeApprovalImportAppend,inspectApprovalImportJournal} from '../domain/research-approval-import.mjs';
const at=1792148400000;
const scope={schemaVersion:1,ownerRef:'fictional-research-only',authorizationEpoch:'a1',policyEpoch:'p1',restoreEpoch:'r1'};
const pkg=()=>JSON.parse(readFileSync(new URL('../examples/research-package.synthetic.json',import.meta.url)));
async function plan(decision='APPROVE',ref='receipt-1',time=at){
 const p=pkg(),request={schema_version:1,receipt_ref:ref,package_id:p.package_id,revision:p.revision,content_sha256:p.content_sha256,decision};
 return createResearchApprovalImportPlanner({clock:()=>time,resolveDecision:async({request:r})=>({...r,verified:true,role:'USER_APPROVER',
 source_kind:'AUTHENTICATED_USER_DECISION',scope,decided_at_ms:time-100,source_recorded_at_ms:time-50})}).prepare({request,package:p,expectedScope:scope});
}
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(PRIVATE_STORAGE_SCHEMA_V1);
 const objects=new Map();let serial=0,fault=null;
 const marker=x=>{const id='fictional-marker-'+(++serial);objects.set(id,structuredClone(x));return id;};
 db.prepare('INSERT INTO private_head VALUES(1,1,?,?,?,?,?,0,0,0,?)').run(scope.ownerRef,scope.authorizationEpoch,scope.policyEpoch,scope.restoreEpoch,'ACTIVE',marker(approvalImportGenesis()));
 const sql={exec(q,...args){const s=db.prepare(q),r=q.startsWith('SELECT')?s.all(...args):(s.run(...args),[]);
  if(fault&&q.startsWith(fault)){fault=null;throw Error('FICTIONAL_STORAGE_CRASH');}return r;}};
 const newStore=()=>createPrivateTransactionStore({sql,transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}});
 let store=newStore();
 const snapshot=()=>Object.fromEntries(['private_head','private_versions','private_requests','private_outbox'].map(t=>[t,db.prepare('SELECT * FROM '+t).all()]));
 function read(now=at){const s=store.readAnalysisSnapshot(scope),entries=s.version?objects.get(s.version.sealedAnalysis):[],head=objects.get(s.head.sealedState);
  return {...inspectApprovalImportJournal({entries,expectedHead:head,expectedScope:scope,asOfMs:now,nowMs:now}),storageRevision:s.head.revision};}
 function prepare(p){const s=read(p.imported_at_ms),proposal=proposeApprovalImportAppend({plan:p,entries:s.entries,expectedHead:s.head,expectedScope:scope,nowMs:p.imported_at_ms});
  return {scope,requestId:p.request.receipt_ref,payloadTag:p.source_attestation_hash,expectedRevision:s.storageRevision,resultStatus:'REDUCED',
   generatedAtMs:p.imported_at_ms,inputCutoffMs:p.source_recorded_at_ms,sealedInput:marker(p),sealedAnalysis:marker(proposal.entries),sealedState:marker(proposal.head),outbox:[]};}
 return {db,read,prepare,snapshot,commit:p=>store.commit(p),failAfter:q=>fault=q,reopenHandle:()=>store=newStore(),close:()=>db.close()};
}
test('existing transaction store can preserve journal plus anchor and receipt in one isolated synthetic commit; no notification',async()=>{
 const f=fixture();try{const p=await plan(),prepared=f.prepare(p),result=f.commit(prepared);
  assert.equal(result.revision,1);const saved=f.read();assert.equal(saved.entries.length,1);assert.equal(saved.head.sequence,1);
  assert.equal(f.snapshot().private_requests.length,1);assert.equal(f.snapshot().private_outbox.length,0);
  f.reopenHandle();assert.deepEqual(f.read(),saved);assert.equal(saved.engine_approval,'NOT_GRANTED');
 }finally{f.close();}
});
test('injected failures after version, head or receipt write roll back all accepted SQLite state',async()=>{
 for(const point of ['INSERT INTO private_versions','UPDATE private_head','INSERT INTO private_requests']){
  const f=fixture();try{const prepared=f.prepare(await plan()),before=f.snapshot();f.failAfter(point);
   assert.throws(()=>f.commit(prepared),/FICTIONAL_STORAGE_CRASH/);assert.deepEqual(f.snapshot(),before);assert.equal(f.read().entries.length,0);
  }finally{f.close();}
 }
});
test('response loss replays the same stored receipt without another event; different payload at same receipt conflicts',async()=>{
 const f=fixture();try{const prepared=f.prepare(await plan()),first=f.commit(prepared),saved=f.snapshot();
  f.reopenHandle();const replay=f.commit(prepared);assert.equal(replay.replayed,true);assert.equal(replay.revision,first.revision);assert.deepEqual(f.snapshot(),saved);
  assert.throws(()=>f.commit({...prepared,payloadTag:'changed-source-tag'}),e=>e.code==='IDEMPOTENCY_CONFLICT');assert.deepEqual(f.snapshot(),saved);
 }finally{f.close();}
});
test('a competing stale withdrawal proposal cannot overwrite committed approval; explicit reload preserves both events',async()=>{
 const f=fixture();try{const approved=f.prepare(await plan()),withdraw=await plan('WITHDRAW','withdraw-1',at+100),stale=f.prepare(withdraw);
  f.commit(approved);const saved=f.snapshot();assert.throws(()=>f.commit(stale),e=>e.code==='REVISION_CONFLICT');assert.deepEqual(f.snapshot(),saved);
  const reloaded=f.prepare(withdraw);f.commit(reloaded);f.reopenHandle();const history=f.read(at+100);
  assert.equal(history.entries.length,2);assert.equal(history.entries[1].plan.request.decision,'WITHDRAW');assert.equal(history.head.sequence,2);
  assert.equal(history.entries[0].plan.request.decision,'APPROVE');assert.equal(f.snapshot().private_outbox.length,0);
 }finally{f.close();}
});
