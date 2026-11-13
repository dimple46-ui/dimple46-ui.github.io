// DESIGN REFERENCE MODEL ONLY. In-memory Node SQLite, fictional envelope markers.
// Not a Cloudflare Durable Object adapter, encryption implementation, migration, auth or delivery test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(`
 CREATE TABLE head(id INTEGER PRIMARY KEY CHECK(id=1),epoch TEXT NOT NULL,revision INTEGER NOT NULL,sealed_state TEXT NOT NULL);
 INSERT INTO head VALUES(1,'fictional-epoch-a',0,'fictional-sealed-initial');
 CREATE TABLE inputs(request_id TEXT PRIMARY KEY,payload_tag TEXT NOT NULL,revision INTEGER NOT NULL);
 CREATE TABLE outbox(epoch TEXT NOT NULL,intent_id TEXT NOT NULL,sealed_payload TEXT NOT NULL,PRIMARY KEY(epoch,intent_id));`);
 return db;
}
const prepared=(patch={})=>({requestId:'fictional-request-a',payloadTag:'fictional-canonical-tag-a',
 epoch:'fictional-epoch-a',expectedRevision:0,resultStatus:'REDUCED',sealedState:'fictional-sealed-state-a',
 intentId:'fictional-event:1:OPENED',sealedIntent:'fictional-sealed-intent-a',...patch});
function commit(db,p,{fault}={}){
 if(p.resultStatus!=='REDUCED'||typeof p.sealedState!=='string')throw new Error('PREPARED_STATE_NOT_COMMITTABLE');
 // BEGIN/COMMIT here are local model primitives only. A future DO must use transactionSync, not these statements.
 db.exec('BEGIN');
 try{
  const prior=db.prepare('SELECT payload_tag,revision FROM inputs WHERE request_id=?').get(p.requestId);
  if(prior){
   if(prior.payload_tag!==p.payloadTag)throw new Error('IDEMPOTENCY_CONFLICT');
   db.exec('COMMIT');return {revision:prior.revision,replayed:true};
  }
  const head=db.prepare('SELECT epoch,revision FROM head WHERE id=1').get();
  if(head.epoch!==p.epoch||head.revision!==p.expectedRevision)throw new Error('REVISION_OR_EPOCH_CONFLICT');
  const next=head.revision+1;
  db.prepare('INSERT INTO inputs VALUES(?,?,?)').run(p.requestId,p.payloadTag,next);
  if(fault==='AFTER_INPUT')throw new Error('SIMULATED_CRASH');
  db.prepare('UPDATE head SET revision=?,sealed_state=? WHERE id=1').run(next,p.sealedState);
  if(fault==='AFTER_HEAD')throw new Error('SIMULATED_CRASH');
  db.prepare('INSERT INTO outbox VALUES(?,?,?)').run(p.epoch,p.intentId,p.sealedIntent);
  if(fault==='AFTER_OUTBOX')throw new Error('SIMULATED_CRASH');
  db.exec('COMMIT');return {revision:next,replayed:false};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
const snapshot=db=>({head:db.prepare('SELECT * FROM head').get(),
 inputs:db.prepare('SELECT * FROM inputs ORDER BY request_id').all(),outbox:db.prepare('SELECT * FROM outbox ORDER BY epoch,intent_id').all()});
test('design model: crash at each write boundary leaves no partial input/state/outbox',()=>{
 for(const fault of ['AFTER_INPUT','AFTER_HEAD','AFTER_OUTBOX']){
  const db=fixture();try{const before=snapshot(db);assert.throws(()=>commit(db,prepared(),{fault}),/SIMULATED_CRASH/);
   assert.deepEqual(snapshot(db),before);}finally{db.close();}
 }
});
test('design model: lost response after commit replays one receipt without duplicate state/outbox',()=>{
 const db=fixture();try{
  const first=commit(db,prepared()); // Pretend response was lost, not storage rollback.
  const saved=snapshot(db),replay=commit(db,prepared());
  assert.equal(replay.revision,first.revision);assert.equal(replay.replayed,true);assert.deepEqual(snapshot(db),saved);
 }finally{db.close();}
});
test('design model: same request ID with changed payload is a conflict, not overwritten input',()=>{
 const db=fixture();try{commit(db,prepared());const saved=snapshot(db);
  assert.throws(()=>commit(db,prepared({payloadTag:'fictional-changed'})),/IDEMPOTENCY_CONFLICT/);
  assert.deepEqual(snapshot(db),saved);
 }finally{db.close();}
});
test('design model: stale concurrent preparation cannot replace a newer committed revision',()=>{
 const db=fixture();try{const first=prepared(),second=prepared({requestId:'fictional-b',intentId:'fictional-other:1:OPENED'});
  commit(db,first);const saved=snapshot(db);
  assert.throws(()=>commit(db,second),/REVISION_OR_EPOCH_CONFLICT/);assert.deepEqual(snapshot(db),saved);
 }finally{db.close();}
});
test('design model: new epoch may reuse local intent ID without collision; old epoch write is fenced',()=>{
 const db=fixture();try{commit(db,prepared());
  // Simulates approved epoch control in the reference model, not an implemented restore procedure.
  db.prepare('UPDATE head SET epoch=? WHERE id=1').run('fictional-epoch-b');
  commit(db,prepared({requestId:'fictional-b',epoch:'fictional-epoch-b',expectedRevision:1}));
  assert.equal(snapshot(db).outbox.length,2);const saved=snapshot(db);
  assert.throws(()=>commit(db,prepared({requestId:'fictional-old',expectedRevision:2})),/REVISION_OR_EPOCH_CONFLICT/);
  assert.deepEqual(snapshot(db),saved);
 }finally{db.close();}
});
test('design model: blocked/null workflow state cannot clear a prior event state',()=>{
 const db=fixture();try{commit(db,prepared());const saved=snapshot(db);
  assert.throws(()=>commit(db,prepared({resultStatus:'BLOCKED',sealedState:null})),/PREPARED_STATE_NOT_COMMITTABLE/);
  assert.deepEqual(snapshot(db),saved);
 }finally{db.close();}
});
