// Locally signed fictional JWTs with ephemeral RSA keys. No real Access token/issuer/network/storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinnedAccessAuthorizer} from '../private/access-identity.mjs';
const wc=globalThis.crypto,now=1792132200000,sec=now/1000;
const pairPromise=wc.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
const scope={schemaVersion:1,ownerRef:'fictional-owner',authorizationEpoch:'auth-a',policyEpoch:'policy-a',restoreEpoch:'restore-a'};
const issuer='https://fictional-team.cloudflareaccess.com',audience='fictional-audience';
const base={iss:issuer,aud:[audience],type:'app',iat:sec-10,exp:sec+100,nbf:sec-10,sub:'fictional-sub'};
const b64=x=>Buffer.from(x).toString('base64url');
async function signed(claims=base,header={alg:'RS256',kid:'fictional-kid',typ:'JWT'},pair){
 pair??=await pairPromise;
 const text=b64(JSON.stringify(header))+'.'+b64(JSON.stringify(claims)),sig=await wc.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(text));
 return 'Bearer '+text+'.'+b64(sig);
}
async function setup(extra={}){return createPinnedAccessAuthorizer({issuer,audience,publicKeys:[{kid:'fictional-kid',key:(await pairPromise).publicKey}],
 identities:[{...scope,kind:'USER',subject:'fictional-sub',roles:['OWNER_WRITE','OWNER_READ']},
 {...scope,kind:'SERVICE',commonName:'fictional-service.access',roles:['MACHINE_READ']}],
 clock:()=>now,maxTokenAgeSeconds:300,maxLifetimeSeconds:3600,...extra});}
test('pinned local JWT verifies signature and maps user to server scope, ignoring token owner/role claims',async()=>{
 const auth=await setup(),r=await auth(await signed({...base,ownerRef:'attacker-owner',roles:['MACHINE_READ']}),'OWNER_WRITE');
 assert.equal(r.verified,true);assert.equal(r.ownerRef,scope.ownerRef);assert.deepEqual(r.roles,['OWNER_WRITE','OWNER_READ']);
 assert.equal(await auth(await signed(),'MACHINE_READ'),null);
});
test('pinned local JWT missing/wrong bearer, unsigned/algorithm/unknown kid/tampered signature reject',async()=>{
 const auth=await setup(),token=await signed();
 for(const credential of [undefined,'wrong-secret',token.slice(7),token.slice(0,-3)+'xxx','Bearer a.b.c','Bearer '+'x'.repeat(16384),
 await signed(base,{alg:'none',kid:'fictional-kid'}),await signed(base,{alg:'HS256',kid:'fictional-kid'}),await signed(base,{alg:'RS256',kid:'unknown'}),
 await signed(base,{alg:'RS256',kid:'fictional-kid',jku:'https://untrusted.invalid/keys'}),await signed(base,{alg:'RS256',kid:'fictional-kid',crit:['owner']})])
 assert.equal(await auth(credential,'OWNER_WRITE'),null);
});
test('pinned local JWT wrong issuer/audience/type/unmapped subject cannot select an actor',async()=>{
 const auth=await setup();
 for(const patch of [{iss:'https://other.cloudflareaccess.com'},{aud:['wrong']},{type:'org'},{sub:'unmapped'},{sub:''},{sub:null},
 {sub:'fictional-sub',common_name:'fictional-service.access'},{aud:Array(9).fill(audience)}])assert.equal(await auth(await signed({...base,...patch}),'OWNER_WRITE'),null);
});
test('pinned local JWT expired/not-yet-valid/future issuance/old issuance/excessive lifetime reject',async()=>{
 const auth=await setup();
 for(const patch of [{exp:sec},{nbf:sec+1},{iat:sec+1},{iat:sec-301},{exp:sec+3600},{iat:NaN},{exp:null},{nbf:'123'}])
 assert.equal(await auth(await signed({...base,...patch}),'OWNER_WRITE'),null);
});
test('pinned local JWT service empty subject maps only by approved service identity and read role',async()=>{
 const auth=await setup(),service={...base,sub:'',common_name:'fictional-service.access'};delete service.nbf;
 assert.equal((await auth(await signed(service),'MACHINE_READ')).ownerRef,scope.ownerRef);
 assert.equal(await auth(await signed(service),'OWNER_WRITE'),null);
 assert.equal(await auth(await signed({...service,common_name:'unmapped.access'}),'MACHINE_READ'),null);
});
test('pinned local JWT rechecks expiry after asynchronous verification, fails closed on crypto error',async()=>{
 const auth=await setup({webCrypto:{subtle:{verify:async()=>{throw Error('PRIVATE_SENTINEL');}}}});
 assert.equal(await auth(await signed(),'OWNER_WRITE'),null);
 let n=0;const later=await setup({clock:()=>++n===1?now:now+101000});assert.equal(await later(await signed(),'OWNER_WRITE'),null);
});
test('pinned local JWT configuration rejects duplicate mappings, implicit service write and arbitrary issuer',async()=>{
 const key=(await pairPromise).publicKey;
 for(const extra of [{issuer:'https://untrusted.invalid'},{publicKeys:[{kid:'k',key},{kid:'k',key}]},
 {identities:[{...scope,kind:'SERVICE',commonName:'fictional-service.access',roles:['OWNER_WRITE']}]},
 {identities:[{...scope,kind:'USER',subject:'same',roles:['OWNER_READ']},{...scope,kind:'USER',subject:'same',roles:['OWNER_READ']}]},
 {maxTokenAgeSeconds:Infinity}])await assert.rejects(()=>setup(extra),/INVALID_PRIVATE_AUTH_CONFIGURATION/);
});
