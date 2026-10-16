import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildPublicConsumerSummary as direct} from '../cloudflare/public-consumer-summary.mjs';
import {buildPublicConsumerSummary as compatible} from '../domain/local-consumer-workflow.mjs';
const root=new URL('../',import.meta.url);
const fixture=JSON.parse(readFileSync(new URL('./fixtures/public-state-20261016-1338.json',import.meta.url)));
const policy={nowMs:1792125581965,maxObservationAgeMs:180000,maxFeatureAgeMs:300000};
test('public-only entry and compatibility export are identical with unchanged saved-source output',()=>{
 assert.equal(direct,compatible);
 assert.deepEqual(direct({githubSnapshot:fixture},policy),compatible({githubSnapshot:fixture},policy));
 assert.equal(direct({githubSnapshot:fixture},policy).sourceQuality.knownIssueCount,1);
});
test('native linker checks public, CLI and candidate graphs without private domain imports',()=>{
 // Native linker catches static/re-export/transitive dependencies, including multiline imports.
 // Reject dynamic loading/require/eval in the current graph so it cannot evade static linking.
 const audit=`
 import {SourceTextModule,SyntheticModule} from 'node:vm';
 import {readFileSync} from 'node:fs';
 import {pathToFileURL,fileURLToPath} from 'node:url';
 import assert from 'node:assert/strict';
 const root=pathToFileURL(process.argv[1]+'/');
 const allowed=new Set(['cloudflare/public-consumer-summary.mjs','cloudflare/consumer-fallback.mjs','scripts/summarize-public-input.mjs','cloudflare/intelligence-read-worker.mjs','cloudflare/operational-storage-policy.mjs']);
 const visited=new Set(),cache=new Map();
 function load(url){
  const path=fileURLToPath(url).slice(fileURLToPath(root).length);
  assert.ok(allowed.has(path),'UNAPPROVED_PUBLIC_DEPENDENCY');visited.add(path);
  if(cache.has(url.href))return cache.get(url.href);
  const source=readFileSync(url,'utf8');
  assert.ok(!/\\b(?:import|require|eval|Function)\\s*\\(/.test(source),'DYNAMIC_CODE_NOT_ALLOWED');
  const mod=new SourceTextModule(source,{identifier:url.href});cache.set(url.href,mod);return mod;
 }
 async function linker(specifier,referencing){
  if(specifier.startsWith('node:')){
   assert.ok(referencing.identifier.endsWith('/scripts/summarize-public-input.mjs'));
   assert.ok(['node:fs','node:url'].includes(specifier));
   const native=await import(specifier),names=Object.keys(native);
   return new SyntheticModule(names,function(){for(const n of names)this.setExport(n,native[n]);});
  }
  assert.ok(specifier.startsWith('.'),'BARE_IMPORT_NOT_ALLOWED');
  return load(new URL(specifier,referencing.identifier));
 }
 await load(new URL('scripts/summarize-public-input.mjs',root)).link(linker);
 await load(new URL('cloudflare/intelligence-read-worker.mjs',root)).link(linker);
 assert.equal(visited.size,5);
 process.stdout.write(JSON.stringify([...visited].sort()));
 `;
 const result=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',audit,fileURLToPath(root)],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout),['cloudflare/consumer-fallback.mjs','cloudflare/intelligence-read-worker.mjs','cloudflare/operational-storage-policy.mjs','cloudflare/public-consumer-summary.mjs','scripts/summarize-public-input.mjs']);
});
