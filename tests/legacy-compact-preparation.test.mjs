import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {legacyCompactParts,prepareLegacyCompactSource} from '../cloudflare/legacy-compact-preparation.mjs';
const relay=readFileSync(new URL('../cloudflare/market-relay-worker.js',import.meta.url),'utf8');
const parts=legacyCompactParts(relay);
// The legacy contract is reproduced from the pre-existing raw-persistence prefix, without runtime audit data.
const begin=relay.indexOf('async function persistMarketHistory(');
const end=relay.indexOf('  const useV2=featureEngineV2Enabled(env);',begin);
const legacy=relay.slice(begin,end)+`  const features=historyFeatures(decodeHistoryRow(stored),rows.results);
  const updated=await db.prepare("UPDATE market_observations SET features_json = ? WHERE slot_ms = ? AND features_json IS NULL").bind(JSON.stringify(features),current.slot_ms).run();
  if(!updated.success) throw new Error("HISTORY_FEATURE_WRITE_FAILED");
  return {status:"STORED",slotMs:current.slot_ms};
}
`;
const prefix=`const untouchedPublication='PRESERVE';
function historyFeatures(){return {version:1,legacySentinel:true};}
`;
const suffix=`function scheduleMarketHistory(){return 'unchanged-schedule';}\n`;
const base=prefix+legacy+suffix;

test('preparation preserves all non-history bytes and keeps compact helpers in a separate scope',()=>{
 const p=prepareLegacyCompactSource(base,parts);
 assert.equal(p.unchangedPrefix,prefix);assert.equal(p.unchangedSuffix,suffix);
 assert.ok(p.patchedHistory.includes('const features=historyFeatures(decodeHistoryRow(stored),rows.results);'));
 const context=vm.createContext({TextEncoder,Date,console});vm.runInContext(p.source,context);
 assert.equal(vm.runInContext('historyFeatures().version',context),1);
 assert.equal(vm.runInContext('scheduleMarketHistory()',context),'unchanged-schedule');
 assert.equal(vm.runInContext('untouchedPublication',context),'PRESERVE');
});
test('unknown legacy contracts and repeat application fail rather than broadly replacing source',()=>{
 const prepared=prepareLegacyCompactSource(base,parts);
 assert.throws(()=>prepareLegacyCompactSource(prepared.source,parts),/BASE_ALREADY_HAS_COMPACT_PATH/);
 assert.throws(()=>prepareLegacyCompactSource(base.replace('const features=historyFeatures(','const features=otherFeatures('),parts),/LEGACY_FEATURE_PATH_CHANGED/);
 assert.throws(()=>prepareLegacyCompactSource(base.replace('status:"STORED",slotMs:current.slot_ms','status:"OTHER",slotMs:current.slot_ms'),parts),/LEGACY_RETURN_CONTRACT_CHANGED/);
 assert.throws(()=>legacyCompactParts('unsupported source'),/COMPACT_EXTRACTION_BOUNDARY_CHANGED/);
});
const trialSlot=Date.parse('2026-10-01T00:00:00Z');
const trialEnd=trialSlot+60000;
const cases=[
 {name:'default off',enabled:false},
 {name:'explicitly enabled',enabled:true},
 {name:'trial exact slot',enabled:true,trial:{slot:String(trialSlot),end:String(trialEnd)},expected:'INSERTED'},
 {name:'trial other slot',enabled:true,trial:{slot:String(trialSlot-120000),end:String(trialEnd)},expected:'SKIPPED',reason:'COMPACT_TRIAL_SLOT_MISMATCH'},
 {name:'trial expired at boundary',enabled:true,trial:{slot:String(trialSlot),end:String(trialSlot+1000)},expected:'SKIPPED',reason:'COMPACT_TRIAL_EXPIRED'},
 {name:'trial partial configuration',enabled:true,trial:{slot:String(trialSlot)},expected:'FAILED',reason:'COMPACT_TRIAL_CONFIG_INVALID'},
 {name:'trial noncanonical number',enabled:true,trial:{slot:String(trialSlot),end:'1e15'},expected:'FAILED',reason:'COMPACT_TRIAL_CONFIG_INVALID'},
 {name:'trial unsafe integer',enabled:true,trial:{slot:'9007199254740992',end:String(trialEnd)},expected:'FAILED',reason:'COMPACT_TRIAL_CONFIG_INVALID'},
 {name:'trial expires during history read',enabled:true,trial:{slot:String(trialSlot),end:String(trialEnd)},expireOnRead:true,expected:'SKIPPED',reason:'COMPACT_TRIAL_EXPIRED'}
];
for(const {name,enabled,trial,expected,reason,expireOnRead} of cases) test(`legacy SQLite preserves v1: compact ${name}`,async()=>{
 const sqlite=new DatabaseSync(':memory:');
 let now=trialSlot+1000;
 try {
  sqlite.exec(readFileSync(new URL('../migrations/0001_market_history.sql',import.meta.url),'utf8'));
  if(enabled) sqlite.exec(readFileSync(new URL('../migrations/0002_feature_runs.sql',import.meta.url),'utf8'));
  const db={prepare(sql){return {bind(...args){return {
   run:async()=>({success:true,meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}),
   first:async()=>sqlite.prepare(sql).get(...args)??null,
   all:async()=>{if(expireOnRead&&sql.includes('WITH recent_days'))now=trialEnd;
    return {success:true,results:sqlite.prepare(sql).all(...args)};}
  };}};}};
  class Clock extends Date {static now(){return now;}}
  const context=vm.createContext({TextEncoder,Date:Clock,console,db});
  vm.runInContext(prepareLegacyCompactSource(base,parts).source,context);
  context.row={slot_ms:Date.parse('2026-10-01T00:00:00Z'),observed_at_ms:Date.parse('2026-10-01T00:00:01Z'),
   available_at_ms:Date.parse('2026-10-01T00:00:01Z'),trading_day:'20261001',schema_version:3,
   quality_version:'fictional',pipeline_status:'DEGRADED',metrics:{},quality:{}};
  context.env={MARKET_HISTORY:db,...(enabled?{FEATURE_COMPACT_WRITE_ENABLED:'true',
   FEATURE_COMPACT_ENGINE_GIT_SHA:'a'.repeat(40),FEATURE_COMPACT_ENGINE_SOURCE_SHA256:'b'.repeat(64)}:{})};
  if(trial){context.env.FEATURE_COMPACT_TRIAL_SLOT_MS=trial.slot;
   if(trial.end!==undefined)context.env.FEATURE_COMPACT_TRIAL_EXPIRES_AT_MS=trial.end;}
  vm.runInContext(`function historyEnabled(){return true;}function historyObservation(){return row;}
   function isKoreaMarketRelayWindow(){return true;}function decodeHistoryRow(value){return value;}`,context);
  const result=await vm.runInContext('persistMarketHistory(env,{})',context);
  assert.equal(result.status,'STORED');
  assert.equal(JSON.parse(sqlite.prepare('SELECT features_json FROM market_observations').get().features_json).version,1);
  if(enabled) {
   assert.equal(result.compact.status,expected??'INSERTED');
   if(reason) assert.equal(result.compact.reason,reason);
   if(!expected||expected==='INSERTED') {
    assert.equal(sqlite.prepare('SELECT feature_version FROM feature_runs').get().feature_version,2);
    if(trial){const again=await vm.runInContext('persistMarketHistory(env,{})',context);
     assert.equal(again.compact.status,'EXISTS');assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM feature_runs').get().n,1);}
   } else assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM feature_runs').get().n,0);
  }
  else assert.equal(Object.hasOwn(result,'compact'),false);
 } finally {sqlite.close();}
});
