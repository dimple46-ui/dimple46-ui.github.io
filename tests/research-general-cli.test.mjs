import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareGeneralResearchDraft} from '../domain/research-general-draft.mjs';
import {sealResearchPackage} from '../domain/research-handoff.mjs';
const now=Date.parse('2026-10-18T03:00:00Z');
function fixture(){return {
 schema_version:2,package_type:'GENERAL_RESEARCH_DRAFT',package_id:'synthetic.cli.general',revision:1,
 disclosure:'SYNTHETIC_PUBLIC_EXAMPLE',target:{ticker:'000660',market:'KRX',currency:'KRW'},
 horizon:'UNSPECIFIED',analysis_cutoff_ms:now-1000,generated_at_ms:now,review_at_ms:null,expires_at_ms:null,
 review_condition:{kind:'DATE_ONLY',date:'2026-10-19',timezone:'Asia/Seoul',event_id:null,description:null},
 expiry_condition:{kind:'EVENT',date:null,timezone:null,event_id:'secret.event',description:'PRIVATE_SENTINEL_EVENT'},
 sources:[{source_id:'synthetic.source',issuer_id:'synthetic.issuer',author:'PRIVATE_SENTINEL_AUTHOR',
  url:'https://example.invalid/PRIVATE_SENTINEL_URL',location:'PRIVATE_SENTINEL_LOCATION',published_date:'2026-10-16',
  acquired:{precision:'DATE_ONLY',at_ms:null,date:'2026-10-16',timezone:'Asia/Seoul'},access:'NOT_CONFIRMED',
  quantities:[{quantity_id:'synthetic.quantity',metric:'revenue',value:'123.450',unit:'KRW_BILLION',currency:'KRW',
   fiscal_period:'2026Q2',scope:'CONSOLIDATED',figure_status:'PRELIMINARY_ESTIMATE'}]}],
 claims:[{claim_id:'support',kind:'ESTIMATE',text:'PRIVATE_SENTINEL_CLAIM',source_refs:['synthetic.source'],quantity_ref:'synthetic.quantity'},
  {claim_id:'contrary',kind:'HYPOTHESIS',text:'PRIVATE_SENTINEL_CONTRARY',source_refs:['synthetic.source'],quantity_ref:null}],
 thesis:{state:'UNCLASSIFIED',supporting_claim_refs:['support'],contrary_claim_refs:['contrary'],invalidation:'PRIVATE_SENTINEL_INVALIDATION'},
 report_comparison:null};}
const cli=new URL('../scripts/validate-research-package.mjs',import.meta.url).pathname;
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:5000});
test('explicit general CLI preserves exact digest, lifecycle precision and pending classification without echoing source text',()=>{
 const dir=mkdtempSync(join(tmpdir(),'general-cli-'));
 try{
  const path=join(dir,'input.json'),input=fixture();writeFileSync(path,JSON.stringify(input));
  const result=run(path,String(now),'--general-draft');assert.equal(result.status,0,result.stderr);
  const value=JSON.parse(result.stdout),expected=prepareGeneralResearchDraft(input,{nowMs:now});
  assert.equal(value.content_sha256,expected.content_sha256);assert.equal(value.schema_version,2);
  assert.equal(value.classification_pending,true);assert.equal(value.historical_replay_allowed,false);
  assert.equal(value.lifecycle.review.at_ms,null);assert.equal(value.temporal_status,'MANUAL_EVENT_REVIEW_REQUIRED');
  assert.equal(value.approval,'NOT_RECORDED');assert.equal(value.receipt,'NOT_RECORDED');
  assert.equal(value.consumer_status,'UNSUPPORTED_BY_LEGACY_CONSUMER');
  assert.ok(!result.stdout.includes('PRIVATE_SENTINEL'));assert.ok(!result.stdout.includes('secret.event'));
  const due=JSON.parse(run(path,String(Date.parse('2026-10-19T00:00:00Z')),'--general-draft').stdout);
  assert.equal(due.temporal_status,'DATE_REQUIRES_MANUAL_REVIEW');assert.equal(due.content_sha256,value.content_sha256);
  assert.equal(readFileSync(path,'utf8'),JSON.stringify(input));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('general review requires explicit mode, never accepts schema1 or caller approval/digest fields',()=>{
 const dir=mkdtempSync(join(tmpdir(),'general-cli-'));
 try{
  const path=join(dir,'input.json');writeFileSync(path,JSON.stringify(fixture()));
  for(const flags of [[],['--draft'],['--general-draft','--draft'],['--approve']])assert.equal(run(path,String(now),...flags).status,1);
  const v1=readFileSync(new URL('../examples/research-package.synthetic.json',import.meta.url),'utf8');
  writeFileSync(path,v1);assert.equal(run(path,String(now),'--general-draft').status,1);
  for(const extra of [{approved:true},{content_sha256:'a'.repeat(64)},{holdings:1}]){
   writeFileSync(path,JSON.stringify({...fixture(),...extra}));assert.equal(run(path,String(now),'--general-draft').status,1);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('all validator modes bound regular-file reads and sanitize corrupt, symlink, nonregular and oversized inputs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'general-cli-'));
 try{
  const path=join(dir,'PRIVATE_SENTINEL.json'),link=join(dir,'link.json');writeFileSync(path,'PRIVATE_SENTINEL_BAD_JSON');symlinkSync(path,link);
  for(const mode of [[],['--draft'],['--general-draft']]){
   for(const input of [path,link,dir]){
    const result=run(input,String(now),...mode);assert.equal(result.status,1);assert.equal(result.stdout,'');
    assert.equal(result.stderr.trim(),''+JSON.stringify({status:'REJECTED',code:'RESEARCH_PACKAGE_VALIDATION_FAILED'}));
   }
  }
  writeFileSync(path,' '.repeat(131073));assert.equal(run(path,String(now),'--general-draft').status,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
function unicodeInput(mode,text){
 const input=mode==='--general-draft'?fixture():JSON.parse(readFileSync(new URL('../examples/research-package.synthetic.json',import.meta.url),'utf8'));
 input.claims[0].text=text;
 if(mode==='--general-draft')return input;
 delete input.content_sha256;
 return mode==='--draft'?input:sealResearchPackage(input);
}
test('all validator modes reject malformed UTF-8 instead of silently replacing source bytes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'general-cli-utf8-'));
 try{
  const path=join(dir,'PRIVATE_UTF8_SENTINEL.json');
  for(const mode of ['', '--draft','--general-draft'])for(const invalid of [Buffer.from([0xff]),Buffer.from([0xc2]),Buffer.from([0xc0,0xaf]),Buffer.from([0xed,0xa0,0x80])]){
   // Bind even sealed-v1 to the text a permissive decoder would invent. Byte validation must still reject it.
   const replacement=invalid.toString('utf8'),valid=Buffer.from(JSON.stringify(unicodeInput(mode,'PRIVATE_UTF8_SENTINEL'+replacement)));
   const start=valid.indexOf(Buffer.from(replacement));assert.ok(start>=0);
   const bytes=Buffer.concat([valid.subarray(0,start),invalid,valid.subarray(start+Buffer.byteLength(replacement))]);
   writeFileSync(path,bytes);const result=run(path,String(now),...(mode?[mode]:[]));
   assert.equal(result.status,1,`mode=${mode||'sealed'} bytes=${invalid.toString('hex')}`);
   assert.equal(result.stdout,'');
   assert.equal(result.stderr.trim(),JSON.stringify({status:'REJECTED',code:'RESEARCH_PACKAGE_VALIDATION_FAILED'}));
   assert.deepEqual(readFileSync(path),bytes);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('valid Unicode and literal replacement characters retain their hashes; BOM rejection stays unchanged',()=>{
 const dir=mkdtempSync(join(tmpdir(),'general-cli-utf8-'));
 try{
  const path=join(dir,'input.json');
  for(const mode of ['', '--draft','--general-draft']){
   const input=unicodeInput(mode,'한글 · 😀 · e\u0301 · \ufffd'),bytes=Buffer.from(JSON.stringify(input));writeFileSync(path,bytes);
   const result=run(path,String(now),...(mode?[mode]:[]));assert.equal(result.status,0,result.stderr);
   const expected=mode==='--general-draft'?prepareGeneralResearchDraft(input,{nowMs:now}).content_sha256:
    (mode==='--draft'?sealResearchPackage(input).content_sha256:input.content_sha256);
   assert.equal(JSON.parse(result.stdout).content_sha256,expected);assert.deepEqual(readFileSync(path),bytes);
   writeFileSync(path,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes]));
   const bom=run(path,String(now),...(mode?[mode]:[]));assert.equal(bom.status,1);assert.equal(bom.stdout,'');
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
