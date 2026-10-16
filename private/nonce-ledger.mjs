// Offline fixed-SQL nonce reservations; never a shared-D1 migration or automatic key registration.
// Requires ONE persistent authority per actual AES key, scoped keys and an externally fenced restore process.
import {PrivateStorageError,opaqueId,scopeValid,sameScope} from './storage-contract.mjs';
export const PRIVATE_NONCE_SCHEMA_V1=`
CREATE TABLE private_nonce_keys(
 key_version TEXT PRIMARY KEY,schema_version INTEGER NOT NULL CHECK(schema_version=1),key_authority_ref TEXT NOT NULL UNIQUE,
 nonce_prefix_hex TEXT NOT NULL,restore_epoch TEXT NOT NULL,
 last_counter INTEGER NOT NULL,max_counter INTEGER NOT NULL,mode TEXT NOT NULL);`;
const reject=()=>{throw new PrivateStorageError('NONCE_RESERVATION_REJECTED');};
const prefix=x=>typeof x==='string'&&/^[a-f0-9]{8}$/.test(x);
const limit=n=>Number.isSafeInteger(n)&&n>0&&n<=4294967295;
export function createPrivateNonceAllocator({sql,transactionSync,readHead,scope,keyBindings}={}){
 if(typeof sql?.exec!=='function'||typeof transactionSync!=='function'||typeof readHead!=='function'||!scopeValid(scope)||
  !Array.isArray(keyBindings)||!keyBindings.length||keyBindings.length>8)throw new TypeError('INVALID_NONCE_CONFIGURATION');
 // Pin a detached control-plane scope. Never infer a new restore epoch from the restored database itself.
 const expected=Object.fromEntries(['schemaVersion','ownerRef','authorizationEpoch','policyEpoch','restoreEpoch'].map(k=>[k,scope[k]]));
 const keys=new Map(),authorities=new Set();
 for(const entry of keyBindings){
  if(!opaqueId(entry?.version)||!opaqueId(entry?.keyAuthorityRef)||!prefix(entry?.noncePrefixHex)||
   keys.has(entry.version)||authorities.has(entry.keyAuthorityRef))throw new TypeError('INVALID_NONCE_CONFIGURATION');
  keys.set(entry.version,{keyAuthorityRef:entry.keyAuthorityRef,noncePrefixHex:entry.noncePrefixHex});authorities.add(entry.keyAuthorityRef);
 }
 return function allocateNonce(keyVersion){
  try{
   const binding=keys.get(keyVersion);if(!binding)reject();
   const reserved=transactionSync(()=>{
    // readHead/sql/transactionSync MUST refer to the SAME private actor/database and stay synchronous.
    const head=readHead();if(!sameScope(head,expected)||head.mode!=='ACTIVE')reject();
    const rows=Array.from(sql.exec('SELECT key_version,schema_version,key_authority_ref,nonce_prefix_hex,restore_epoch,last_counter,max_counter,mode FROM private_nonce_keys WHERE key_version=?',keyVersion));
    if(rows.length!==1)reject();const row=rows[0];
    if(row.schema_version!==1||row.key_version!==keyVersion||row.key_authority_ref!==binding.keyAuthorityRef||row.nonce_prefix_hex!==binding.noncePrefixHex||
     row.restore_epoch!==expected.restoreEpoch||row.mode!=='ACTIVE'||!Number.isSafeInteger(row.last_counter)||row.last_counter<0||
     !limit(row.max_counter)||row.last_counter>=row.max_counter)reject();
    const counter=row.last_counter+1;
    sql.exec('UPDATE private_nonce_keys SET last_counter=? WHERE key_version=?',counter,keyVersion);
    const iv=new Uint8Array(12);for(let i=0;i<4;i++)iv[i]=Number.parseInt(binding.noncePrefixHex.slice(i*2,i*2+2),16);
    new DataView(iv.buffer).setBigUint64(4,BigInt(counter),false);
    return iv; // transaction wrapper must commit before returning; never return inside an unresolved async transaction.
   });
   if(!(reserved instanceof Uint8Array)||reserved.byteLength!==12)reject();return reserved;
  }catch{reject();} // No raw database/key/owner error disclosure; no empty/reset fallback.
 };
}
