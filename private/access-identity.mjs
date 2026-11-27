// Offline pinned Access application-JWT verifier. No network/JWKS fetch, header trust or resource creation.
// A future runtime must supply reviewed public keys from a FIXED trusted issuer and server-side mappings.
import {opaqueId,scopeValid,timestamp} from './storage-contract.mjs';
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const validSecond=x=>Number.isSafeInteger(x)&&x>0;
function decoded(segment,max){if(typeof segment!=='string'||segment.length===0||segment.length>max||!/^[A-Za-z0-9_-]+$/.test(segment))throw Error('INVALID_SEGMENT');
 const data=atob(segment.replace(/-/g,'+').replace(/_/g,'/'));const encoded=btoa(data).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
 if(encoded!==segment)throw Error('INVALID_SEGMENT');return Uint8Array.from(data,c=>c.charCodeAt(0));}
export function createPinnedAccessAuthorizer({issuer,audience,publicKeys,identities,clock,maxTokenAgeSeconds,maxLifetimeSeconds,webCrypto=globalThis.crypto}={}){
 const invalid=()=>{throw new TypeError('INVALID_PRIVATE_AUTH_CONFIGURATION');};
 if(typeof issuer!=='string'||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)||!opaqueId(audience)||
  !Array.isArray(publicKeys)||publicKeys.length===0||publicKeys.length>8||!Array.isArray(identities)||identities.length===0||identities.length>64||
  typeof clock!=='function'||!validSecond(maxTokenAgeSeconds)||!validSecond(maxLifetimeSeconds)||maxTokenAgeSeconds>maxLifetimeSeconds||maxLifetimeSeconds>86400||!webCrypto?.subtle)invalid();
 const keys=new Map(),mapped=new Map();
 for(const {kid,key} of publicKeys){if(!opaqueId(kid)||keys.has(kid)||key?.type!=='public'||key.algorithm?.name!=='RSASSA-PKCS1-v1_5'||
  key.algorithm.hash?.name!=='SHA-256'||key.algorithm.modulusLength<2048||!key.usages.includes('verify'))invalid();keys.set(kid,key);}
 for(const i of identities){
  const name=i?.kind==='USER'?i.subject:i?.kind==='SERVICE'?i.commonName:null;
  if(!opaqueId(name)||!scopeValid(i)||!Array.isArray(i.roles)||!i.roles.length||i.roles.length>2||
   new Set(i.roles).size!==i.roles.length||i.roles.some(r=>!(i.kind==='USER'?['OWNER_WRITE','OWNER_READ']:['MACHINE_READ']).includes(r)))invalid();
  const id=i.kind+':'+name;if(mapped.has(id))invalid();
  mapped.set(id,{schemaVersion:1,ownerRef:i.ownerRef,authorizationEpoch:i.authorizationEpoch,policyEpoch:i.policyEpoch,restoreEpoch:i.restoreEpoch,roles:[...i.roles]});
 }
 function timing(claims){const ms=clock();if(!timestamp(ms))return false;const now=Math.floor(ms/1000),{iat,exp,nbf}=claims;
  return validSecond(iat)&&validSecond(exp)&&exp>iat&&iat<=now&&now<exp&&now-iat<=maxTokenAgeSeconds&&exp-iat<=maxLifetimeSeconds&&
   (nbf===undefined||(validSecond(nbf)&&nbf<=now&&nbf<exp));}
 return async function authorize(credential,action){try{
  if(!['OWNER_WRITE','OWNER_READ','MACHINE_READ'].includes(action)||typeof credential!=='string'||credential.length>16384||!credential.startsWith('Bearer '))return null;
  const token=credential.slice(7),parts=token.split('.');if(parts.length!==3)return null;
  const header=JSON.parse(dec.decode(decoded(parts[0],2048))),claims=JSON.parse(dec.decode(decoded(parts[1],12288)));
  if(!header||Array.isArray(header)||header.alg!=='RS256'||!opaqueId(header.kid)||!keys.has(header.kid)||
   Object.keys(header).some(k=>!['alg','kid','typ'].includes(k))||(header.typ!==undefined&&header.typ!=='JWT')||
   !claims||Array.isArray(claims)||claims.iss!==issuer||claims.type!=='app'||!timing(claims))return null;
  const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(aud.length===0||aud.length>8||aud.some(x=>typeof x!=='string'||x.length>128)||!aud.includes(audience))return null;
  const valid=await webCrypto.subtle.verify('RSASSA-PKCS1-v1_5',keys.get(header.kid),decoded(parts[2],2048),enc.encode(parts[0]+'.'+parts[1]));
  if(!valid||!timing(claims))return null;
  // Signed token roles/owner/email are NOT authorization. Only explicit server mappings grant scope.
  let identity;
  if(typeof claims.sub==='string'&&claims.sub.length>0&&claims.common_name===undefined)identity=mapped.get('USER:'+claims.sub);
  else if(claims.sub===''&&opaqueId(claims.common_name))identity=mapped.get('SERVICE:'+claims.common_name);
  if(!identity||!identity.roles.includes(action))return null;
  return {...identity,roles:[...identity.roles],verified:true,expiresAtMs:claims.exp*1000};
 }catch{return null;}};
}
