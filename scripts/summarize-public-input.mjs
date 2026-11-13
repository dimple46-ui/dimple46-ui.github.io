import {openSync,fstatSync,readSync,closeSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {buildPublicConsumerSummary} from '../cloudflare/public-consumer-summary.mjs';
const MAX_BYTES=2*1024*1024;
const FILE_FLAGS=new Set(['--snapshot','--state','--features']);
const NUMBER_FLAGS=new Set(['--as-of-ms','--max-observation-age-ms','--max-feature-age-ms']);
const fail=code=>{throw new Error(code);};
function loadPublicFile(path,kind){
 let fd;
 try {
  fd=openSync(path,'r');const stat=fstatSync(fd);
  if(!stat.isFile()||stat.size>MAX_BYTES)fail('INVALID_OR_OVERSIZED_FILE');
  const buffer=Buffer.alloc(MAX_BYTES+1);let size=0;
  while(size<buffer.length){const n=readSync(fd,buffer,size,buffer.length-size,null);if(n===0)break;size+=n;}
  if(size>MAX_BYTES)fail('INVALID_OR_OVERSIZED_FILE');
  const value=JSON.parse(buffer.subarray(0,size).toString('utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_PUBLIC_SCHEMA');
  if(['privateComparison','privateResult','ledger','accounts','authorization','token','secrets']
    .some(key=>Object.hasOwn(value,key))||String(value.classification??'').startsWith('PRIVATE'))fail('PRIVATE_INPUT_REJECTED');
  if(kind==='--snapshot'?value.schemaVersion!==3:
    value.apiSchemaVersion!==1||!Object.hasOwn(value,kind==='--state'?'state':'feature'))fail('INVALID_PUBLIC_SCHEMA');
  return value;
 } finally {if(fd!==undefined)closeSync(fd);}
}
export function summarizePublicInputArgs(args){
 const flags=new Map();
 for(let i=0;i<args.length;i+=2){
  const key=args[i],value=args[i+1];
  if((!FILE_FLAGS.has(key)&&!NUMBER_FLAGS.has(key))||flags.has(key)||!value||value.startsWith('--'))fail('INVALID_ARGUMENTS');
  flags.set(key,value);
 }
 const number=key=>{
  const v=flags.get(key);if(!/^\d+$/.test(v??''))fail('EXPLICIT_TIME_POLICY_REQUIRED');
  const n=Number(v);if(!Number.isSafeInteger(n))fail('INVALID_TIME_POLICY');return n;
 };
 const policy={nowMs:number('--as-of-ms'),maxObservationAgeMs:number('--max-observation-age-ms'),
  maxFeatureAgeMs:number('--max-feature-age-ms')};
 if(policy.nowMs<=0||!Number.isFinite(new Date(policy.nowMs).getTime()))fail('INVALID_TIME_POLICY');
 if(!flags.has('--state')&&!flags.has('--snapshot'))fail('PUBLIC_OBSERVATION_FILE_REQUIRED');
 const market={};
 for(const [flag,key]of [['--snapshot','githubSnapshot'],['--state','candidateState'],['--features','candidateFeatures']])
  if(flags.has(flag))market[key]=loadPublicFile(flags.get(flag),flag);
 return buildPublicConsumerSummary(market,policy);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=summarizePublicInputArgs(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result)+'\n');
  if(result.status==='UNAVAILABLE')process.exitCode=2;
 }catch{
  // Deliberately never echo argv, filenames, exception text or original JSON.
  process.stderr.write(JSON.stringify({status:'FAIL',code:'PUBLIC_INPUT_OR_POLICY_INVALID'})+'\n');
  process.exitCode=1;
 }
}
