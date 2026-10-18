// Node SQLite and a minimal base-class double only: NOT a Cloudflare runtime test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {registerHooks} from 'node:module';
import {PRIVATE_STORAGE_SCHEMA_V1} from '../private/transaction-store.mjs';
import {createDurablePrivateTransactionStore} from '../private/durable-transaction-store.mjs';

// Hook only the test process's import; production entry imports the real built-in.
const hook=registerHooks({resolve(specifier,context,nextResolve){
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class DurableObject { constructor() {} }',shortCircuit:true};
 return nextResolve(specifier,context);
}});
let entry;
try {entry=await import('../private/cloudflare-candidate.mjs');} finally {hook.deregister();}

const scope={schemaVersion:1,ownerRef:'fictional-owner',authorizationEpoch:'auth-a',policyEpoch:'policy-a',restoreEpoch:'restore-a'};
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(PRIVATE_STORAGE_SCHEMA_V1);
 db.prepare('INSERT INTO private_head VALUES(1,1,?,?,?,?,?,0,0,0,?)').run(
  scope.ownerRef,scope.authorizationEpoch,scope.policyEpoch,scope.restoreEpoch,'ACTIVE','fictional-initial');
 let sqlCalls=0,transactions=0,fault=false;
 const sql={exec(query,...args){
  assert.equal(this,sql);sqlCalls++;
  const result=db.prepare(query).all(...args);
  if(fault&&query.startsWith('INSERT INTO private_requests'))throw Error('FICTIONAL_PROVIDER_FAILURE');
  return result[Symbol.iterator]();
 }};
 const storage={sql,transactionSync(fn){
  assert.equal(this,storage);transactions++;db.exec('BEGIN');
  try {const value=fn();db.exec('COMMIT');return value;} catch(error){db.exec('ROLLBACK');throw error;}
 }};
 return {db,storage,calls:()=>({sqlCalls,transactions}),failReceipt:()=>{fault=true;}};
}
function proposal(){return {scope,requestId:'fictional-request',payloadTag:'fictional-tag',expectedRevision:0,
 resultStatus:'REDUCED',sealedInput:'fictional-input',sealedAnalysis:'fictional-analysis',sealedState:'fictional-state',
 generatedAtMs:1792132200000,inputCutoffMs:1792132200000,outbox:[]};}

test('candidate provider: missing SQLite or synchronous transaction capability fails before initialization',()=>{
 for(const storage of [undefined,{}, {sql:{exec(){throw Error('must not call');}}},
  {sql:{},transactionSync(){throw Error('must not call');}}])
  assert.throws(()=>createDurablePrivateTransactionStore(storage),/PRIVATE_SQLITE_PROVIDER_REQUIRED/);
 assert.throws(()=>new entry.PrivateRiskStore({storage:{}},{}),/PRIVATE_SQLITE_PROVIDER_REQUIRED/);
});

test('candidate ingress: edge and actor reject without body, credential, binding or SQL access',async()=>{
 const f=fixture();
 try {
  const store=createDurablePrivateTransactionStore(f.storage);
  const actor=new entry.PrivateRiskStore({storage:f.storage},{});
  assert.deepEqual(f.calls(),{sqlCalls:0,transactions:0});
  assert.ok(Object.isFrozen(store));
  assert.deepEqual(Object.getOwnPropertyNames(entry.PrivateRiskStore.prototype).sort(),['constructor','fetch']);
  assert.deepEqual(Object.keys(actor),[]);
  const forbidden=new Proxy({}, {get(){throw Error('FICTIONAL_PRIVATE_SENTINEL');}});
  for(const response of [await entry.default.fetch(forbidden,forbidden,forbidden),await actor.fetch(forbidden)]){
   assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');
   assert.equal(await response.text(),'');
  }
  assert.deepEqual(f.calls(),{sqlCalls:0,transactions:0});
 } finally {f.db.close();}
});

test('candidate provider: bound platform receivers preserve existing atomic commit and receipt replay',()=>{
 const f=fixture();
 try {
  const store=createDurablePrivateTransactionStore(f.storage),p=proposal();
  const first=store.commit(p),replay=store.commit(p);
  assert.equal(first.revision,1);assert.equal(first.replayed,false);assert.equal(replay.replayed,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM private_versions').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM private_requests').get().n,1);
  assert.equal(f.calls().transactions,2);
 } finally {f.db.close();}
});

test('candidate provider: provider rollback preserves head and versions when receipt storage fails',()=>{
 const f=fixture();
 try {
  const store=createDurablePrivateTransactionStore(f.storage);f.failReceipt();
  assert.throws(()=>store.commit(proposal()),/FICTIONAL_PROVIDER_FAILURE/);
  assert.equal(f.db.prepare('SELECT revision,sealed_state FROM private_head').get().revision,0);
  assert.equal(f.db.prepare('SELECT sealed_state FROM private_head').get().sealed_state,'fictional-initial');
  for(const table of ['private_versions','private_requests','private_outbox'])
   assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
  assert.equal(f.calls().transactions,1);
 } finally {f.db.close();}
});
