// Fictional SQLite tests only. No actual DO/key registration, migration, production or real assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PRIVATE_NONCE_SCHEMA_V1,createPrivateNonceAllocator} from '../private/nonce-ledger.mjs';
import {createPrivateEnvelopeCrypto} from '../private/envelope-crypto.mjs';
import {context,canonicalJson} from '../private/storage-contract.mjs';
const scope={schemaVersion:1,ownerRef:'fictional-owner',authorizationEpoch:'auth-a',policyEpoch:'policy-a',restoreEpoch:'restore-a'};
const bindings=[{version:'fictional-key-v1',keyAuthorityRef:'fictional-authority-a',noncePrefixHex:'01020304'}];
const bytes=b=>Buffer.from(b).toString('hex');
function handles(db){let head={...scope,mode:'ACTIVE'},fault=false;
 const sql={exec(query,...args){const stmt=db.prepare(query);if(/^SELECT/.test(query))return stmt.all(...args);
 stmt.run(...args);if(fault){fault=false;throw Error('PRIVATE_SENTINEL_WRITE_FAILED');}return [];}};
 const transactionSync=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}};
 const deps={sql,transactionSync,readHead:()=>head,scope,keyBindings:bindings};
 return {deps,allocate:createPrivateNonceAllocator(deps),head:h=>head=h,fault:()=>fault=true};
}
function initialize(db){db.exec(PRIVATE_NONCE_SCHEMA_V1);db.prepare('INSERT INTO private_nonce_keys VALUES(?,?,?,?,?,?,?,?)')
 .run('fictional-key-v1',1,'fictional-authority-a','01020304','restore-a',0,100,'ACTIVE');}
function fixture(){const db=new DatabaseSync(':memory:');initialize(db);return {db,...handles(db)};}
async function use(fn){const f=fixture();try{await fn(f);}finally{f.db.close();}}
const counter=f=>f.db.prepare('SELECT last_counter FROM private_nonce_keys').get().last_counter;
test('nonce allocator commits monotonically increasing 96-bit values before returning',async()=>use(async f=>{
 assert.equal(bytes(f.allocate('fictional-key-v1')),'010203040000000000000001');assert.equal(counter(f),1);
 assert.equal(bytes(f.allocate('fictional-key-v1')),'010203040000000000000002');assert.equal(counter(f),2);
}));
test('nonce allocator state survives separate instances and file SQLite close/reopen (not provider restart proof)',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fictional-nonce-')),path=join(dir,'fixture.sqlite');let db;
 try{
  db=new DatabaseSync(path);initialize(db);const first=handles(db).allocate('fictional-key-v1');
  const second=handles(db).allocate('fictional-key-v1');db.close();db=new DatabaseSync(path);
  const third=handles(db).allocate('fictional-key-v1');assert.equal(new Set([first,second,third].map(bytes)).size,3);
  assert.equal(bytes(third),'010203040000000000000003');
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});
test('nonce allocator failed reservation rolls back; no nonce escapes a failed transaction',async()=>use(async f=>{
 f.fault();assert.throws(()=>f.allocate('fictional-key-v1'),/^Error: NONCE_RESERVATION_REJECTED$/);assert.equal(counter(f),0);
 assert.equal(bytes(f.allocate('fictional-key-v1')),'010203040000000000000001');
}));
test('nonce allocator lost caller response burns reservation; no duplicate on retry',async()=>use(async f=>{
 f.allocate('fictional-key-v1'); // simulated committed response loss: never undo this reservation.
 const next=f.allocate('fictional-key-v1');assert.equal(bytes(next),'010203040000000000000002');assert.equal(counter(f),2);
}));
test('nonce allocator burns a committed nonce even when later encryption or business write fails',async()=>use(async f=>{
 const wc=globalThis.crypto,key=await wc.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const tagKey=await wc.subtle.generateKey({name:'HMAC',length:256,hash:'SHA-256'},false,['sign']);
 const crypto=createPrivateEnvelopeCrypto({encryptionKeys:[{version:'fictional-key-v1',key}],activeVersion:'fictional-key-v1',tagKey,allocateNonce:f.allocate,
 webCrypto:{subtle:{encrypt:async()=>{throw Error('FICTIONAL_ENCRYPTION_FAILURE');}}}});
 await assert.rejects(()=>crypto.seal(canonicalJson({fictionalValue:1}),context(scope,'INPUT','1')),/PRIVATE_ENVELOPE_REJECTED/);
 assert.equal(counter(f),1);f.db.exec('BEGIN');try{f.db.exec('CREATE TABLE fictional_business(value INTEGER)');throw Error('BUSINESS_FAILURE');}catch{f.db.exec('ROLLBACK');}
 assert.equal(bytes(f.allocate('fictional-key-v1')),'010203040000000000000002');
}));
test('nonce allocator missing/frozen/exhausted/malformed registration never creates, resets or wraps',async()=>{
 for(const patch of ["DELETE FROM private_nonce_keys","UPDATE private_nonce_keys SET mode='FROZEN'",'UPDATE private_nonce_keys SET last_counter=100',
 'UPDATE private_nonce_keys SET last_counter=-1','UPDATE private_nonce_keys SET max_counter=4294967296',"UPDATE private_nonce_keys SET nonce_prefix_hex='bad'"])
 await use(async f=>{f.db.exec(patch);const before=f.db.prepare('SELECT * FROM private_nonce_keys').all();
 assert.throws(()=>f.allocate('fictional-key-v1'),/NONCE_RESERVATION_REJECTED/);assert.deepEqual(f.db.prepare('SELECT * FROM private_nonce_keys').all(),before);});
});
test('nonce allocator authority/version mismatch rejects without spending another registered key',async()=>use(async f=>{
 assert.throws(()=>f.allocate('missing'),/NONCE_RESERVATION_REJECTED/);
 f.db.exec("UPDATE private_nonce_keys SET key_authority_ref='different-authority'");assert.throws(()=>f.allocate('fictional-key-v1'),/NONCE_RESERVATION_REJECTED/);assert.equal(counter(f),0);
}));
test('nonce allocator pins detached control scope; changed auth/policy/restore and maintenance freeze reject',async()=>{
 for(const patch of [{ownerRef:'other'},{authorizationEpoch:'auth-b'},{policyEpoch:'policy-b'},{restoreEpoch:'restore-b'},{mode:'MAINTENANCE_FROZEN'},{schemaVersion:2}])
 await use(async f=>{f.head({...scope,mode:'ACTIVE',...patch});assert.throws(()=>f.allocate('fictional-key-v1'),/NONCE_RESERVATION_REJECTED/);assert.equal(counter(f),0);});
});
test('declared restore with new external epoch rejects old DB/key registration; it cannot self-initialize',async()=>use(async f=>{
 f.allocate('fictional-key-v1');const restoredScope={...scope,restoreEpoch:'restore-b'};
 const afterRestore=createPrivateNonceAllocator({...f.deps,scope:restoredScope});
 assert.throws(()=>afterRestore('fictional-key-v1'),/NONCE_RESERVATION_REJECTED/); // old restored head vs external scope
 f.head({...restoredScope,mode:'ACTIVE'});
 assert.throws(()=>afterRestore('fictional-key-v1'),/NONCE_RESERVATION_REJECTED/); // old key registration still fenced
 assert.equal(counter(f),1);
}));
test('nonce allocator budget applies across restarts of the adapter; last permitted value never wraps',async()=>use(async f=>{
 f.db.exec('UPDATE private_nonce_keys SET last_counter=4294967294,max_counter=4294967295');
 assert.equal(bytes(f.allocate('fictional-key-v1')),'0102030400000000ffffffff');
 assert.throws(()=>createPrivateNonceAllocator(f.deps)('fictional-key-v1'),/NONCE_RESERVATION_REJECTED/);assert.equal(counter(f),4294967295);
}));
test('nonce allocator requires unique authority registration per version and explicit configuration',async()=>use(async f=>{
 for(const keyBindings of [[],[bindings[0],{...bindings[0],version:'alias'}],[{...bindings[0],noncePrefixHex:'unknown'}]])
 assert.throws(()=>createPrivateNonceAllocator({...f.deps,keyBindings}),/INVALID_NONCE_CONFIGURATION/);
}));
test('nonce allocator rejects an asynchronous transaction wrapper without returning a usable nonce',async()=>use(async f=>{
 const allocate=createPrivateNonceAllocator({...f.deps,transactionSync:async fn=>fn()});
 assert.throws(()=>allocate('fictional-key-v1'),/NONCE_RESERVATION_REJECTED/);
}));
