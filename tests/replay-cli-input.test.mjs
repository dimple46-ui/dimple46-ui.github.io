import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateStockFlowV3Replay} from '../scripts/validate-stock-flow-v3-replay.mjs';
import {validateSignalReplay} from '../cloudflare/signal-replay-validator.mjs';
const sha='74855080042caac2dc8789e78c6403acc712afab';
const scripts=['validate-stock-flow-snapshot.mjs','validate-stock-flow-v3-replay.mjs','validate-signal-replay.mjs'];
const run=(name,path)=>spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/'+name,import.meta.url)),path,
 ...(name==='validate-signal-replay.mjs'?['--engine-sha',sha]:name.includes('v3')?[sha]:[])],
 {encoding:'utf8',timeout:5000});
test('existing replay CLIs reject unwritten FIFOs instead of waiting for input',{skip:process.platform==='win32'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'replay-fifo-'));
 try{
  const path=join(dir,'PRIVATE_FIFO_SENTINEL');assert.equal(spawnSync('mkfifo',[path]).status,0);
  const results=scripts.map(name=>run(name,path));
  assert.deepEqual(results.map(r=>r.error?.code??null),[null,null,null]);
  for(const r of results){assert.equal(r.status,1);assert.equal(r.stdout,'');
   assert.ok(!r.stderr.includes('PRIVATE_FIFO_SENTINEL')&&!r.stderr.includes(dir));}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('replay CLI failures bound files and redact OS paths and malformed input',()=>{
 const dir=mkdtempSync(join(tmpdir(),'replay-invalid-'));
 try{
  const path=join(dir,'PRIVATE_PATH_SENTINEL.json');
  for(const name of scripts){
   for(const input of ['missing','malformed','oversized','directory']){
    rmSync(path,{force:true});
    if(input==='malformed')writeFileSync(path,'{"PRIVATE_VALUE_SENTINEL":');
    if(input==='oversized')writeFileSync(path,' '.repeat(2*1024*1024+1));
    const r=run(name,input==='directory'?dir:path);
    assert.equal(r.error,undefined);assert.equal(r.status,1);assert.equal(r.stdout,'');
    assert.ok(!r.stderr.includes('PRIVATE_')&&!r.stderr.includes(dir));
    assert.equal(JSON.parse(r.stderr).status,'FAIL');
   }
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('normal replay files preserve existing validator outputs and snapshot waiting status',()=>{
 const dir=mkdtempSync(join(tmpdir(),'replay-normal-'));
 try{
  const path=join(dir,'input.json');
  const snapshot=JSON.parse(readFileSync(new URL('./fixtures/stock-flow-20261016.json',import.meta.url),'utf8'));
  writeFileSync(path,JSON.stringify(snapshot));let r=run(scripts[1],path);assert.equal(r.status,0,r.stderr);
  assert.deepEqual(JSON.parse(r.stdout),validateStockFlowV3Replay(snapshot,{engineGitSha:sha}));
  const cutoff='2026-10-08T02:26:43.951Z';
  const replay={mode:'READ_ONLY_REPLAY',replayCutoffMs:Date.parse(cutoff)+1000,
   queryMeta:{current:{rowsWritten:0}},features:{version:2,inputCutoff:cutoff,bucketChanges:{},windows:{},sameTimeHistorical:{windows:{}}}};
  writeFileSync(path,JSON.stringify(replay));r=run(scripts[2],path);assert.equal(r.status,0,r.stderr);
  assert.deepEqual(JSON.parse(r.stdout),validateSignalReplay(replay,{engineGitSha:sha}));
  const now=Date.now(),koreaDate=new Date(now+9*3600000).toISOString().slice(0,10).replaceAll('-','');
  writeFileSync(path,JSON.stringify({schemaVersion:3,koreaDate,relayUpdatedAt:new Date(now).toISOString()}));
  r=run(scripts[0],path);assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).status,'WAITING_FOR_LIVE_DATA');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
