// Offline private adapter primitives. No HTTP entry point, credentials, runtime or database binding.
export class PrivateStorageError extends Error {
 constructor(code){super(code);this.code=code;}
}
export const fail=code=>{throw new PrivateStorageError(code);};
export const opaqueId=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(x);
export const intentId=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,256}$/.test(x);
export const timestamp=x=>Number.isSafeInteger(x)&&x>0&&Number.isFinite(new Date(x).getTime());
export function scopeValid(s){return s?.schemaVersion===1&&['ownerRef','authorizationEpoch','policyEpoch','restoreEpoch'].every(k=>opaqueId(s[k]));}
export function sameScope(a,b){return scopeValid(a)&&scopeValid(b)&&['schemaVersion','ownerRef','authorizationEpoch','policyEpoch','restoreEpoch'].every(k=>a[k]===b[k]);}
export const context=(scope,kind,recordId)=>({schemaVersion:1,ownerRef:scope.ownerRef,authorizationEpoch:scope.authorizationEpoch,
 policyEpoch:scope.policyEpoch,restoreEpoch:scope.restoreEpoch,kind,recordId});
export function canonicalJson(value,maxBytes=131072){
 let nodes=0;
 function visit(v,depth){
  if(++nodes>20000||depth>32)fail('INVALID_OR_OVERSIZED_JSON');
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v))fail('INVALID_OR_OVERSIZED_JSON');return v;}
  if(typeof v==='string'){if(v.length>16384)fail('INVALID_OR_OVERSIZED_JSON');return v;}
  if(typeof v!=='object')fail('INVALID_OR_OVERSIZED_JSON');
  const proto=Object.getPrototypeOf(v);
  if(Array.isArray(v)){
   if(v.length>1024||Object.keys(v).length!==v.length)fail('INVALID_OR_OVERSIZED_JSON');
   const out=[];for(let i=0;i<v.length;i++){
    const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!('value'in d))fail('INVALID_OR_OVERSIZED_JSON');
    out.push(visit(d.value,depth+1));
   }return out;
  }
  if(proto!==Object.prototype&&proto!==null)fail('INVALID_OR_OVERSIZED_JSON');
  const out=Object.create(null),descriptors=Object.getOwnPropertyDescriptors(v),keys=Object.keys(descriptors).sort();
  if(keys.length>1024||Reflect.ownKeys(v).length!==keys.length)fail('INVALID_OR_OVERSIZED_JSON');
  for(const k of keys){const d=descriptors[k];
   if(['__proto__','constructor','prototype'].includes(k)||!d.enumerable||!('value'in d))fail('INVALID_OR_OVERSIZED_JSON');
   out[k]=visit(d.value,depth+1);
  }return out;
 }
 const text=JSON.stringify(visit(value,0));
 if(new TextEncoder().encode(text).byteLength>maxBytes)fail('INVALID_OR_OVERSIZED_JSON');return text;
}
export function envelopeValid(s){return typeof s==='string'&&s.length>0&&new TextEncoder().encode(s).byteLength<=786432;}
