// Fictional integration only: memory SQLite and injected auth/crypto doubles, NOT Cloudflare/JWT/AEAD proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {createPrivateInputAdapter} from '../private/input-adapter.mjs';
import {PRIVATE_STORAGE_SCHEMA_V1,createPrivateTransactionStore} from '../private/transaction-store.mjs';
import {createCashRiskEventState} from '../domain/cash-risk-events.mjs';
const now=1792132200000,day=86400000,horizon=now+2*day;
const scope={schemaVersion:1,ownerRef:'fictional-owner',authorizationEpoch:'auth-a',policyEpoch:'policy-a',restoreEpoch:'restore-a'};
function inputs(at=now,withdrawable=1000){return {ledger:{schemaVersion:1,currency:'KRW',asOfMs:at,accounts:[{
 accountRef:'fictional-A',sourceRef:'synthetic',verifiedAtMs:at,coverage:{holdings:true,cash:true,debts:true,obligations:true},
 holdings:[{ticker:'005930',quantity:10},{ticker:'000660',quantity:2}],cash:{balanceKrw:5000,withdrawableKrw:withdrawable},
 debts:[{principalKrw:4000}],additionalOutflowsKrw:1500}]},
 prices:Object.fromEntries([['005930',100],['000660',500]].map(([t,priceKrw])=>[t,
 {priceKrw,currency:'KRW',quality:'VERIFIED',sourceRef:'synthetic',observedAtMs:at}])),
 scenario:{schemaVersion:1,id:'fictional-downside',shocksBps:{'005930':-1000,'000660':-1500}},
 schedule:{schemaVersion:1,ledgerAsOfMs:at,accounts:[{accountRef:'fictional-A',coverageComplete:true,obligations:[{
 obligationRef:'fictional-payment',amountKrw:1500,dueAtMs:now+day,status:'OPEN',cashTreatment:'NOT_DEDUCTED_FROM_WITHDRAWABLE',
 sourceRef:'synthetic',verifiedAtMs:at}]}]}};}
const request=(patch={})=>({schemaVersion:1,requestId:'fictional-request',expectedRevision:0,inputs:inputs(),...patch});
function fixture(overrides={}){
 const db=new DatabaseSync(':memory:');db.exec(PRIVATE_STORAGE_SCHEMA_V1);
 const initial=createCashRiskEventState({horizonAtMs:horizon,bindings:[{accountRef:'fictional-A',
 shortfall:{eventId:'fictional-A.shortfall',severity:'CRITICAL'},overdue:{eventId:'fictional-A.overdue',severity:'WARNING'}}]});
 const sealed=new Map([['fictional-initial',JSON.stringify(initial)]]);let serial=0,storeCalls=0,at=now,fault=null;
 const crypto={async tag(text,ctx){return createHmac('sha256','FICTIONAL_TEST_DOUBLE_NOT_A_RUNTIME_KEY').update(JSON.stringify(ctx)+text).digest('hex');},
 async seal(text,ctx){const marker=`fictional-sealed-${++serial}`;sealed.set(marker,JSON.stringify({text,ctx}));return marker;},
 async open(marker,ctx){if(marker==='fictional-initial')return JSON.parse(sealed.get(marker));
 const item=JSON.parse(sealed.get(marker));assert.deepEqual(item.ctx,ctx);return JSON.parse(item.text);}};
 db.prepare('INSERT INTO private_head VALUES(1,1,?,?,?,?,?,0,0,0,?)').run(scope.ownerRef,scope.authorizationEpoch,scope.policyEpoch,scope.restoreEpoch,'ACTIVE','fictional-initial');
 const sql={exec(query,...args){const stmt=db.prepare(query);let result;
  if(/^SELECT/.test(query))result=stmt.all(...args);else {stmt.run(...args);result=[];}
  if(fault&&query.startsWith(fault)){fault=null;throw new Error('PRIVATE_SENTINEL_SQL_CRASH');}return result;}};
 const store=createPrivateTransactionStore({sql,transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}});
 const deps={authorize:async token=>token==='fictional-valid'?{...scope,roles:['OWNER_WRITE'],verified:true}:null,
 getStore:async owner=>{storeCalls++;assert.equal(owner,scope.ownerRef);return store;},
 getPolicy:async(s,t)=>({analysisPolicy:{nowMs:t,maxLedgerAgeMs:1000,maxPriceAgeMs:1000,horizonAtMs:horizon},eventPolicy:{nowMs:t,maxCaptureAgeMs:1000,maxInputAgeMs:1000}}),
 clock:()=>at,crypto,...overrides};
 const adapter=createPrivateInputAdapter(deps);
 return {db,store,crypto,deps,adapter,sealed,close:()=>db.close(),storeCalls:()=>storeCalls,setTime:t=>at=t,setFault:p=>fault=p,
 snapshot:()=>Object.fromEntries(['private_head','private_versions','private_requests','private_outbox'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]))};
}
async function withFixture(fn,overrides){const f=fixture(overrides);try{await fn(f);}finally{f.close();}}
const submit=(f,r=request())=>f.adapter.submit({credential:'fictional-valid',request:r});
test('offline adapter: missing/unverified/read-only identities rejected before store resolution',async()=>{
 for(const proof of [null,{...scope,verified:false,roles:['OWNER_WRITE']},{...scope,verified:true,roles:['MACHINE_READ']},{...scope,verified:true,ownerRef:'',roles:['OWNER_WRITE']}])
  await withFixture(async f=>{assert.equal((await submit(f)).code,'UNAUTHORIZED');assert.equal(f.storeCalls(),0);},{authorize:async()=>proof});
});
test('offline adapter: auth exception has no credential/body/exception echo and touches no store',async()=>withFixture(async f=>{
 const r=await submit(f);assert.equal(r.code,'PRIVATE_DEPENDENCY_FAILURE');assert.equal(f.storeCalls(),0);assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));
},{authorize:async()=>{throw new Error('PRIVATE_SENTINEL');}}));
test('offline adapter: body-selected owner/policy, unknown input, nonfinite, cyclic and oversized JSON reject before store',async()=>{
 const cycle={};cycle.self=cycle;
 for(const r of [request({ownerRef:'other'}),request({inputs:{ownerRef:'other'}}),request({inputs:{ledger:{amount:NaN}}}),request({inputs:cycle}),request({inputs:{ledger:{text:'x'.repeat(16385)}}}),request({expectedRevision:-1})])
  await withFixture(async f=>{assert.equal((await submit(f,r)).status,'REJECTED');assert.equal(f.storeCalls(),0);});
});
test('offline adapter: accepted workflow is sealed and input/analysis/state/receipt/outbox commit atomically',async()=>withFixture(async f=>{
 const r=await submit(f);assert.equal(r.status,'COMMITTED');assert.equal(r.revision,1);assert.equal(r.notificationStatus,'PENDING_REVIEW_NOT_SENT');
 const snap=f.snapshot();assert.equal(snap.private_versions.length,1);assert.equal(snap.private_requests.length,1);assert.equal(snap.private_outbox.length,1);
 assert.equal(snap.private_outbox[0].status,'PENDING_REVIEW');assert.ok(!JSON.stringify(snap).includes('fictional-payment'));
 const stored=f.sealed.get(snap.private_versions[0].sealed_analysis);const result=JSON.parse(JSON.parse(stored).text);
 assert.equal(result.summary.components.cashDeadlines.totals.accountShortfallSumKrw,500);assert.equal(result.capabilities.tax,'UNAVAILABLE');
}));
test('offline adapter: lost response replays original receipt; canonical key order does not duplicate writes',async()=>withFixture(async f=>{
 const a=await submit(f),before=f.snapshot(),original=request();
 const reversed={inputs:original.inputs,expectedRevision:0,requestId:original.requestId,schemaVersion:1};f.setTime(now+100);
 const b=await submit(f,reversed);assert.equal(b.status,'REPLAYED');assert.equal(b.generatedAtMs,a.generatedAtMs);assert.deepEqual(f.snapshot(),before);
}));
test('offline adapter: changed payload for same request conflicts without overwrite',async()=>withFixture(async f=>{
 await submit(f);const before=f.snapshot();const r=await submit(f,request({inputs:inputs(now,2000)}));
 assert.equal(r.code,'IDEMPOTENCY_CONFLICT');assert.deepEqual(f.snapshot(),before);
}));
test('offline adapter: stale expected revision is not retried',async()=>withFixture(async f=>{
 await submit(f);const before=f.snapshot();const r=await submit(f,request({requestId:'fictional-other'}));
 assert.equal(r.code,'REVISION_CONFLICT');assert.deepEqual(f.snapshot(),before);
}));
test('offline adapter: stale cash, future cutoff and expired horizon preserve accepted active risk',async()=>withFixture(async f=>{
 await submit(f);const before=f.snapshot();
 for(const [at,input] of [[now+2000,inputs()],[now+100,inputs(now+1000)],[horizon+1,inputs(horizon+1)]]){
  f.setTime(at);assert.equal((await submit(f,request({requestId:'fictional-invalid',expectedRevision:1,inputs:input}))).code,'WORKFLOW_NOT_COMMITTABLE');assert.deepEqual(f.snapshot(),before);
 }
}));
test('offline adapter: stale market quote keeps independent cash risk and is not promoted to verified',async()=>withFixture(async f=>{
 const i=inputs();i.prices['005930'].quality='STALE_INPUT';const r=await submit(f,request({inputs:i}));assert.equal(r.status,'COMMITTED');
 const record=f.snapshot().private_versions[0],analysis=JSON.parse(JSON.parse(f.sealed.get(record.sealed_analysis)).text);
 assert.equal(analysis.capabilities.valuation,'UNAVAILABLE');assert.equal(analysis.capabilities.cashDeadlines,'AVAILABLE');assert.equal(analysis.events.intents[0].transition,'OPENED');
}));
test('offline adapter: explicit maintenance freeze/missing head/schema mismatch prevent implicit initialization',async()=>{
 for(const sql of ["UPDATE private_head SET mode='MAINTENANCE_FROZEN'",'DELETE FROM private_head','UPDATE private_head SET schema_version=2'])await withFixture(async f=>{
  f.db.exec(sql);const before=f.snapshot();assert.equal((await submit(f)).code,'STORE_FROZEN_OR_SCOPE_MISMATCH');assert.deepEqual(f.snapshot(),before);
 });
});
test('offline adapter: crypto/open/seal errors never commit or expose exception details',async()=>{
 for(const name of ['tag','open','seal'])await withFixture(async f=>{
  f.deps.crypto[name]=async()=>{throw new Error('PRIVATE_SENTINEL');};const before=f.snapshot(),r=await submit(f);
  assert.equal(r.code,'PRIVATE_DEPENDENCY_FAILURE');assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));assert.deepEqual(f.snapshot(),before);
 });
});
test('offline adapter: oversized sealed payload is rejected before transaction',async()=>withFixture(async f=>{
 f.deps.crypto.seal=async()=> 'x'.repeat(786433);const before=f.snapshot();assert.equal((await submit(f)).code,'INVALID_CRYPTO_RESULT');assert.deepEqual(f.snapshot(),before);
}));
test('offline adapter: write failures after each table mutation roll back all accepted records',async()=>{
 for(const query of ['INSERT INTO private_versions','UPDATE private_head','INSERT INTO private_outbox','INSERT INTO private_requests'])await withFixture(async f=>{
  f.setFault(query);const before=f.snapshot(),r=await submit(f);assert.equal(r.code,'PRIVATE_DEPENDENCY_FAILURE');assert.deepEqual(f.snapshot(),before);
 });
});
test('offline adapter: async competing preparations commit one revision with no lost update',async()=>withFixture(async f=>{
 const pending=[];const tag=f.crypto.tag;f.crypto.tag=async(...args)=>{const value=await tag(...args);await new Promise(resolve=>{pending.push(resolve);if(pending.length===2)pending.forEach(x=>x());});return value;};
 const results=await Promise.all([submit(f),submit(f,request({requestId:'fictional-concurrent'}))]);
 assert.deepEqual(results.map(x=>x.status).sort(),['COMMITTED','REJECTED']);assert.ok(results.some(x=>x.code==='REVISION_CONFLICT'));
 assert.equal(f.snapshot().private_versions.length,1);assert.equal(f.snapshot().private_outbox.length,1);
}));
test('offline adapter: auth/policy/restore epoch changes during encryption fence the old preparation',async()=>{
 for(const column of ['authorization_epoch','policy_epoch','restore_epoch'])await withFixture(async f=>{
  const seal=f.crypto.seal;let once=false;f.crypto.seal=async(...args)=>{if(!once){once=true;f.db.exec(`UPDATE private_head SET ${column}='new-epoch'`);}return seal(...args);};
  const r=await submit(f);assert.equal(r.code,'STORE_FROZEN_OR_SCOPE_MISMATCH');const snap=f.snapshot();
  assert.equal(snap.private_head[0].revision,0);assert.equal(snap.private_versions.length,0);assert.equal(snap.private_outbox.length,0);
 });
});
test('offline adapter: mismapped actor is rejected rather than accepting body or auth owner as a DB authority',async()=>withFixture(async f=>{
 f.db.exec("UPDATE private_head SET owner_ref='fictional-other-owner'");assert.equal((await submit(f)).code,'STORE_FROZEN_OR_SCOPE_MISMATCH');assert.equal(f.snapshot().private_versions.length,0);
}));
test('offline adapter: next unchanged capture advances revision without duplicating an intent; recovery remains explicit',async()=>withFixture(async f=>{
 await submit(f);f.setTime(now+100);
 const b=await submit(f,request({requestId:'fictional-second',expectedRevision:1,inputs:inputs(now+100)}));
 assert.equal(b.status,'COMMITTED');assert.equal(b.revision,2);assert.equal(f.snapshot().private_outbox.length,1);
 f.setTime(now+200);const c=await submit(f,request({requestId:'fictional-recovery',expectedRevision:2,inputs:inputs(now+200,2000)}));
 assert.equal(c.status,'COMMITTED');assert.equal(c.revision,3);assert.equal(f.snapshot().private_outbox.length,2);
 const saved=f.sealed.get(f.snapshot().private_versions[2].sealed_analysis),analysis=JSON.parse(JSON.parse(saved).text);
 assert.equal(analysis.events.intents[0].transition,'RESOLVED');assert.equal(analysis.events.notificationConnection,'NOT_CONNECTED');
}));
test('offline adapter: authorization expiring during async sealing cannot commit',async()=>withFixture(async f=>{
 f.deps.authorize=async()=>({...scope,roles:['OWNER_WRITE'],verified:true,expiresAtMs:now+100});
 // Factory captures functions, so construct a fresh adapter with the deliberately expiring verifier.
 f.adapter=createPrivateInputAdapter(f.deps);const seal=f.crypto.seal;
 f.crypto.seal=async(...args)=>{f.setTime(now+101);return seal(...args);};
 const before=f.snapshot();assert.equal((await submit(f)).code,'UNAUTHORIZED');assert.deepEqual(f.snapshot(),before);
}));
test('offline end-to-end: real signature, AEAD and memory SQLite preserve sealed state/replay and reject tampering',async()=>withFixture(async f=>{
 const {createPrivateEnvelopeCrypto}=await import('../private/envelope-crypto.mjs');
 const {createPinnedAccessAuthorizer}=await import('../private/access-identity.mjs');
 const {canonicalJson,context}=await import('../private/storage-contract.mjs');
 const wc=globalThis.crypto;
 const key=await wc.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const tagKey=await wc.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const pair=await wc.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
 const {PRIVATE_NONCE_SCHEMA_V1,createPrivateNonceAllocator}=await import('../private/nonce-ledger.mjs');
 f.db.exec(PRIVATE_NONCE_SCHEMA_V1);
 f.db.prepare('INSERT INTO private_nonce_keys VALUES(?,?,?,?,?,?,?,?)').run('fictional-v1',1,'fictional-authority-a','01020304',scope.restoreEpoch,0,100,'ACTIVE');
 const allocateNonce=createPrivateNonceAllocator({sql:{exec(query,...args){const s=f.db.prepare(query);if(/^SELECT/.test(query))return s.all(...args);s.run(...args);return [];}},
 transactionSync(fn){f.db.exec('BEGIN IMMEDIATE');try{const r=fn();f.db.exec('COMMIT');return r;}catch(e){f.db.exec('ROLLBACK');throw e;}},
 readHead:f.store.readHead,scope,keyBindings:[{version:'fictional-v1',keyAuthorityRef:'fictional-authority-a',noncePrefixHex:'01020304'}]});
 const nonceCounter=()=>f.db.prepare('SELECT last_counter FROM private_nonce_keys').get().last_counter;
 const crypto=createPrivateEnvelopeCrypto({encryptionKeys:[{version:'fictional-v1',key}],activeVersion:'fictional-v1',tagKey,allocateNonce});
 const initial=JSON.parse(f.sealed.get('fictional-initial'));
 f.db.prepare('UPDATE private_head SET sealed_state=?').run(await crypto.seal(canonicalJson(initial),context(scope,'EVENT_STATE','0')));
 const issuer='https://fictional-team.cloudflareaccess.com',audience='fictional-aud';
 const authorize=createPinnedAccessAuthorizer({issuer,audience,publicKeys:[{kid:'fictional-kid',key:pair.publicKey}],
 identities:[{...scope,kind:'USER',subject:'fictional-user',roles:['OWNER_WRITE']}],clock:()=>now,maxTokenAgeSeconds:300,maxLifetimeSeconds:3600});
 const b64=x=>Buffer.from(x).toString('base64url'),sec=now/1000;
 const signing=b64(JSON.stringify({alg:'RS256',kid:'fictional-kid'}))+'.'+b64(JSON.stringify({iss:issuer,aud:[audience],type:'app',sub:'fictional-user',iat:sec-1,exp:sec+100}));
 const token='Bearer '+signing+'.'+b64(await wc.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(signing)));
 const adapter=createPrivateInputAdapter({...f.deps,authorize,crypto});
 const r=await adapter.submit({credential:token,request:request()});assert.equal(r.status,'COMMITTED');
 const saved=f.snapshot();assert.ok(!JSON.stringify(saved).includes('fictional-payment'));
 assert.equal((await adapter.submit({credential:token,request:request()})).status,'REPLAYED');assert.deepEqual(f.snapshot(),saved);
 const analysis=await crypto.open(saved.private_versions[0].sealed_analysis,context(scope,'ANALYSIS','1'));
 assert.equal(analysis.summary.components.cashDeadlines.totals.accountShortfallSumKrw,500);assert.equal(analysis.events.intents.length,1);
 assert.equal(nonceCounter(),5);const committed=f.snapshot(),beforeNonce=nonceCounter();
 f.setFault('INSERT INTO private_requests');const second=request({requestId:'fictional-next',expectedRevision:1});
 assert.equal((await adapter.submit({credential:token,request:second})).status,'REJECTED');assert.deepEqual(f.snapshot(),committed);
 assert.ok(nonceCounter()>beforeNonce);const failedCounter=nonceCounter();
 assert.equal((await adapter.submit({credential:token,request:second})).status,'COMMITTED');assert.ok(nonceCounter()>failedCounter);
 f.db.exec("UPDATE private_head SET sealed_state='tampered'");const corrupted=f.snapshot();
 assert.equal((await adapter.submit({credential:token,request:request({requestId:'fictional-new',expectedRevision:2})})).status,'REJECTED');assert.deepEqual(f.snapshot(),corrupted);
}));
test('offline adapter: corrupted receipt cannot become a replay success or clear accepted state',async()=>withFixture(async f=>{
 await submit(f);f.db.exec('UPDATE private_requests SET revision=100');const before=f.snapshot();
 assert.equal((await submit(f)).code,'STORE_FROZEN_OR_SCOPE_MISMATCH');assert.deepEqual(f.snapshot(),before);
}));
test('offline adapter: older input cutoff is rejected by the existing workflow before replacing accepted state',async()=>withFixture(async f=>{
 await submit(f);f.setTime(now+100);const before=f.snapshot();
 const r=await submit(f,request({requestId:'fictional-older-input',expectedRevision:1,inputs:inputs(now-100)}));
 assert.equal(r.code,'WORKFLOW_NOT_COMMITTABLE');assert.deepEqual(f.snapshot(),before);
}));
