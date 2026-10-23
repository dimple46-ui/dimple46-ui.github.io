// Offline Web Crypto provider. Requires separately approved keys + globally unique durable nonce allocation.
// It does NOT provision/manage keys, allocate persistent nonces, authenticate users or connect a runtime.
import {canonicalJson,scopeValid,opaqueId} from './storage-contract.mjs';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const reject=()=>{throw new Error('PRIVATE_ENVELOPE_REJECTED');};
const kinds=new Set(['REQUEST_TAG','INPUT','ANALYSIS','EVENT_STATE','OUTBOX']);
function validContext(c){return scopeValid(c)&&Object.keys(c).sort().join(',')==='authorizationEpoch,kind,ownerRef,policyEpoch,recordId,restoreEpoch,schemaVersion'&&
 kinds.has(c.kind)&&typeof c.recordId==='string'&&/^[A-Za-z0-9_.:-]{1,256}$/.test(c.recordId);}
function encode(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function decode(s,max){if(typeof s!=='string'||s.length===0||s.length>max||!/^[A-Za-z0-9_-]+$/.test(s))reject();
 const bytes=Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));if(encode(bytes)!==s)reject();return bytes;}
const hex=buffer=>Array.from(new Uint8Array(buffer),x=>x.toString(16).padStart(2,'0')).join('');
export function createPrivateEnvelopeCrypto({encryptionKeys,activeVersion,tagKey,allocateNonce,webCrypto=globalThis.crypto}={}){
 const validKey=(key,name,usages)=>key?.type==='secret'&&key.extractable===false&&key.algorithm?.name===name&&key.algorithm.length===256&&usages.every(u=>key.usages.includes(u));
 if(!Array.isArray(encryptionKeys)||encryptionKeys.length===0||encryptionKeys.length>8||!opaqueId(activeVersion)||
  !validKey(tagKey,'HMAC',['sign'])||tagKey.algorithm.hash?.name!=='SHA-256'||typeof allocateNonce!=='function'||!webCrypto?.subtle)reject();
 const keys=new Map(),handles=new Set();
 for(const entry of encryptionKeys){if(!opaqueId(entry?.version)||keys.has(entry.version)||handles.has(entry.key)||!validKey(entry.key,'AES-GCM',['encrypt','decrypt']))reject();keys.set(entry.version,entry.key);handles.add(entry.key);}
 if(!keys.has(activeVersion))reject();
 // This cache only detects within-instance allocator bugs. Cross-instance/restart uniqueness remains allocator's contract.
 const usedNonces=new Set();
 function aad(c,keyVersion){if(!validContext(c))reject();return encoder.encode(canonicalJson({algorithm:'AES-256-GCM',envelopeVersion:1,keyVersion,context:c}));}
 async function seal(text,c){try{
  if(typeof text!=='string'||canonicalJson(JSON.parse(text),524288)!==text||usedNonces.size>=4096)reject();
  const additionalData=aad(c,activeVersion),allocated=await allocateNonce(activeVersion);
  if(!(allocated instanceof Uint8Array)||allocated.byteLength!==12)reject();
  const iv=new Uint8Array(allocated),nonceTag=activeVersion+':'+encode(iv);if(usedNonces.has(nonceTag))reject();usedNonces.add(nonceTag);
  const ciphertext=await webCrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData,tagLength:128},keys.get(activeVersion),encoder.encode(text));
  return JSON.stringify({v:1,keyVersion:activeVersion,iv:encode(iv),ciphertext:encode(new Uint8Array(ciphertext))});
 }catch{reject();}}
 async function open(sealed,c){try{
  if(typeof sealed!=='string'||encoder.encode(sealed).byteLength>786432)reject();const e=JSON.parse(sealed);
  if(!e||Object.keys(e).sort().join(',')!=='ciphertext,iv,keyVersion,v'||e.v!==1||!keys.has(e.keyVersion))reject();
  const iv=decode(e.iv,16),ciphertext=decode(e.ciphertext,699072);if(iv.byteLength!==12||ciphertext.byteLength<16)reject();
  const raw=await webCrypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(c,e.keyVersion),tagLength:128},keys.get(e.keyVersion),ciphertext);
  const text=decoder.decode(raw),value=JSON.parse(text);if(canonicalJson(value,524288)!==text)reject();return value;
 }catch{reject();}}
 async function tag(text,c){try{
  if(typeof text!=='string'||canonicalJson(JSON.parse(text),131072)!==text||!validContext(c)||c.kind!=='REQUEST_TAG')reject();
  // Stable across AES-key rotation. Rotating this separate HMAC key requires an explicit request/policy epoch policy.
  return hex(await webCrypto.subtle.sign('HMAC',tagKey,encoder.encode(canonicalJson({purpose:'PRIVATE_REQUEST_EQUALITY_V1',context:c})+'\n'+text)));
 }catch{reject();}}
 return {seal,open,tag};
}
