// Ephemeral keys generated only in memory; never saved, printed or used with actual personal data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateEnvelopeCrypto} from '../private/envelope-crypto.mjs';
import {canonicalJson,context} from '../private/storage-contract.mjs';
const wc=globalThis.crypto;
const scope={schemaVersion:1,ownerRef:'fictional-owner',authorizationEpoch:'auth-a',policyEpoch:'policy-a',restoreEpoch:'restore-a'};
const ctx=context(scope,'EVENT_STATE','1'),plain=canonicalJson({fictionalAmount:1000,active:true});
async function keys(){return {key:await wc.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),
 tagKey:await wc.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign'])};}
function provider(k,extra={}){let nonce=0;return createPrivateEnvelopeCrypto({encryptionKeys:[{version:'fictional-key-v1',key:k.key}],activeVersion:'fictional-key-v1',
 tagKey:k.tagKey,allocateNonce:async()=>{const iv=new Uint8Array(12);new DataView(iv.buffer).setUint32(8,++nonce);return iv;},...extra});}
test('real local AEAD round-trip encrypts fictional values with versioned owner/record context',async()=>{
 const p=provider(await keys()),sealed=await p.seal(plain,ctx);assert.deepEqual(await p.open(sealed,ctx),JSON.parse(plain));
 assert.ok(!sealed.includes('fictionalAmount'));assert.ok(!sealed.includes('fictional-owner'));
 assert.notEqual(JSON.parse(sealed).iv,JSON.parse(await p.seal(plain,ctx)).iv);
});
test('real local AEAD rejects ciphertext/IV/version tampering and all context substitutions',async()=>{
 const p=provider(await keys()),sealed=await p.seal(plain,ctx);
 for(const [k,v] of Object.entries({ownerRef:'other-owner',authorizationEpoch:'auth-b',policyEpoch:'policy-b',restoreEpoch:'restore-b',kind:'ANALYSIS',recordId:'2',schemaVersion:2}))
  await assert.rejects(()=>p.open(sealed,{...ctx,[k]:v}),/^Error: PRIVATE_ENVELOPE_REJECTED$/);
 const e=JSON.parse(sealed);
 for(const change of [{ciphertext:(e.ciphertext[0]==='A'?'B':'A')+e.ciphertext.slice(1)},{iv:'AAAAAAAAAAAAAAAA'},{keyVersion:'missing'},{v:2},{extra:'unexpected'}])
  await assert.rejects(()=>p.open(JSON.stringify({...e,...change}),ctx),/PRIVATE_ENVELOPE_REJECTED/);
});
test('real local AEAD wrong key and lost key do not fabricate state or expose plaintext',async()=>{
 const k=await keys(),sealed=await provider(k).seal(plain,ctx),wrong=provider(await keys());
 await assert.rejects(()=>wrong.open(sealed,ctx),/^Error: PRIVATE_ENVELOPE_REJECTED$/);
 assert.throws(()=>provider(k,{activeVersion:'absent'}),/PRIVATE_ENVELOPE_REJECTED/);
});
test('real local AEAD local nonce reuse/invalid allocator fails closed (not durable allocation proof)',async()=>{
 const k=await keys(),p=provider(k,{allocateNonce:async()=>new Uint8Array(12)});await p.seal(plain,ctx);
 await assert.rejects(()=>p.seal(plain,ctx),/PRIVATE_ENVELOPE_REJECTED/);
 for(const allocateNonce of [async()=>new Uint8Array(11),async()=>{throw Error('PRIVATE_SENTINEL');}])
  await assert.rejects(()=>provider(k,{allocateNonce}).seal(plain,ctx),/^Error: PRIVATE_ENVELOPE_REJECTED$/);
});
test('real local AEAD rotation reads old key; private request tag stable under AES rotation',async()=>{
 const a=await keys(),b=await keys(),old=provider(a),keyring=[{version:'fictional-key-v1',key:a.key},{version:'fictional-key-v2',key:b.key}];
 const next=provider(a,{encryptionKeys:keyring,activeVersion:'fictional-key-v2'}),sealed=await old.seal(plain,ctx);
 assert.deepEqual(await next.open(sealed,ctx),JSON.parse(plain));assert.equal(JSON.parse(await next.seal(plain,ctx)).keyVersion,'fictional-key-v2');
 const tagCtx=context(scope,'REQUEST_TAG','fictional-request');assert.equal(await old.tag(plain,tagCtx),await next.tag(plain,tagCtx));
 assert.notEqual(await old.tag(plain,tagCtx),await old.tag(plain,{...tagCtx,ownerRef:'other-owner'}));
 assert.notEqual(await old.tag(plain,tagCtx),await old.tag(canonicalJson({fictionalAmount:1001}),tagCtx));
});
test('real local AEAD rejects extractable/incorrect keys and malformed/oversized/noncanonical payloads',async()=>{
 const k=await keys(),extractable=await wc.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
 assert.throws(()=>provider({...k,key:extractable}),/PRIVATE_ENVELOPE_REJECTED/);
 const p=provider(k);
 for(const text of ['{bad','{"b":2,"a":1}',canonicalJson({text:'x'.repeat(16384)})+' '])await assert.rejects(()=>p.seal(text,ctx),/PRIVATE_ENVELOPE_REJECTED/);
 for(const text of ['null','{}','x'.repeat(786433),'{"v":1}'])await assert.rejects(()=>p.open(text,ctx),/PRIVATE_ENVELOPE_REJECTED/);
});
test('real local keyed tags accept bounded requests above 16KB without serializing an oversized nested text field',async()=>{
 const p=provider(await keys()),text=canonicalJson({a:'a'.repeat(12000),b:'b'.repeat(12000)}),tagCtx=context(scope,'REQUEST_TAG','fictional-large-request');
 assert.match(await p.tag(text,tagCtx),/^[a-f0-9]{64}$/);
});
test('real local AEAD rejects one CryptoKey handle registered under multiple version aliases',async()=>{
 const k=await keys();assert.throws(()=>provider(k,{encryptionKeys:[{version:'fictional-key-v1',key:k.key},{version:'alias',key:k.key}]}),/PRIVATE_ENVELOPE_REJECTED/);
});
