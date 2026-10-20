import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const sha='74855080042caac2dc8789e78c6403acc712afab';
function cases(){
 const now=Date.now(),cutoff='2026-10-08T02:26:43.951Z';
 const snapshot={schemaVersion:3,koreaDate:new Date(now+9*3600000).toISOString().slice(0,10).replaceAll('-',''),relayUpdatedAt:new Date(now).toISOString()};
 return [
  {script:'validate-stock-flow-snapshot.mjs',input:snapshot,args:[],errorKey:'code',error:'INVALID_SNAPSHOT_INPUT'},
  {script:'validate-stock-flow-v3-replay.mjs',input:JSON.parse(readFileSync(new URL('./fixtures/stock-flow-20261016.json',import.meta.url))),args:[sha],errorKey:'code',error:'INVALID_REPLAY_INPUT'},
  {script:'validate-signal-replay.mjs',input:{mode:'READ_ONLY_REPLAY',replayCutoffMs:Date.parse(cutoff)+1000,queryMeta:{current:{rowsWritten:0}},features:{version:2,inputCutoff:cutoff,bucketChanges:{},windows:{},sameTimeHistorical:{windows:{}}}},args:['--engine-sha',sha],errorKey:'error',error:'INVALID_REPLAY_INPUT'},
  {script:'summarize-public-input.mjs',input:JSON.parse(readFileSync(new URL('./fixtures/closed-snapshot.json',import.meta.url))),args:['--as-of-ms',String(Date.parse('2026-09-30T11:00:07.732Z')),'--max-observation-age-ms','120000','--max-feature-age-ms','300000'],flag:'--snapshot',errorKey:'code',error:'PUBLIC_INPUT_OR_POLICY_INVALID'}
 ];
}
const run=(c,path)=>spawnSync(process.execPath,[new URL('../scripts/'+c.script,import.meta.url).pathname,...(c.flag?[c.flag]:[]),path,...c.args],{encoding:'utf8',timeout:5000});
test('public summary and replay CLIs reject malformed UTF-8 rather than repair valid-looking JSON',()=>{
 const dir=mkdtempSync(join(tmpdir(),'public-replay-utf8-')),path=join(dir,'PRIVATE_UTF8_SENTINEL.json');
 try{
  const inputs=cases();
  for(const invalid of [Buffer.from([0xff]),Buffer.from([0xc2]),Buffer.from([0xc0,0xaf]),Buffer.from([0xed,0xa0,0x80])]){
   const results=inputs.map(c=>{
    const replacement=invalid.toString('utf8'),valid=Buffer.from(JSON.stringify({...c.input,extra:{text:'PRIVATE_UTF8_SENTINEL'+replacement}}));
    const start=valid.indexOf(Buffer.from(replacement));assert.ok(start>=0);
    const bytes=Buffer.concat([valid.subarray(0,start),invalid,valid.subarray(start+Buffer.byteLength(replacement))]);
    writeFileSync(path,bytes);const result=run(c,path);assert.deepEqual(readFileSync(path),bytes);return {c,result};
   });
   assert.deepEqual(results.map(x=>x.result.status),[1,1,1,1]);
   for(const {c,result} of results){assert.equal(result.stdout,'');assert.deepEqual(JSON.parse(result.stderr),{status:'FAIL',[c.errorKey]:c.error});assert.ok(!result.stderr.includes('PRIVATE_')&&!result.stderr.includes(dir));}
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('valid Unicode and literal replacement characters remain accepted; leading BOM stays rejected',()=>{
 const dir=mkdtempSync(join(tmpdir(),'public-replay-unicode-')),path=join(dir,'input.json');
 try{
  for(const c of cases()){
   const bytes=Buffer.from(JSON.stringify({...c.input,extra:{text:'한글 😀 e\u0301 \ufffd'}}));writeFileSync(path,bytes);
   const result=run(c,path);assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');assert.deepEqual(readFileSync(path),bytes);
   const bom=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes]);writeFileSync(path,bom);
   const rejected=run(c,path);assert.equal(rejected.status,1);assert.equal(rejected.stdout,'');assert.deepEqual(readFileSync(path),bom);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
