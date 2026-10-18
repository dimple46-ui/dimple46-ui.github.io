// Opt-in preparation primitive only. No schema v1 coercion, receipt or approval.
const fail=()=>{throw new Error('INVALID_RESEARCH_DECIMAL');};
export function parseResearchDecimal(value){
 if(typeof value!=='string'||value.length>29||! /^-?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,9})?$/.test(value))fail();
 const negative=value.startsWith('-'),unsigned=negative?value.slice(1):value;
 const [whole,fraction='']=unsigned.split('.');
 const magnitude=BigInt(whole+fraction);
 if(negative&&magnitude===0n)fail();
 return Object.freeze({text:value,coefficient:(negative?-magnitude:magnitude).toString(),scale:fraction.length});
}
export function compareResearchDecimals(left,right){
 const a=parseResearchDecimal(left),b=parseResearchDecimal(right),scale=Math.max(a.scale,b.scale);
 const x=BigInt(a.coefficient)*10n**BigInt(scale-a.scale);
 const y=BigInt(b.coefficient)*10n**BigInt(scale-b.scale);
 return x===y?0:x<y?-1:1;
}
