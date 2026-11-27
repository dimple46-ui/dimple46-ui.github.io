import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

// Use the actual Worker SELECTs and shipped schemas. No remote D1 connection.
const source=readFileSync(new URL('../cloudflare/intelligence-read-worker.mjs',import.meta.url),'utf8');
const queries=[...source.matchAll(/`(SELECT trading_day,COUNT\(\*\).*?)`/gs)].map(match=>match[1]);

function measure(days) {
 const db=new DatabaseSync(':memory:');
 try {
  for(const file of ['0001_market_history.sql','0002_feature_runs.sql'])
   db.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
  const insertObservation=db.prepare('INSERT INTO market_observations VALUES(?,?,?,?,?,?,?,?,?,?)');
  const insertFeature=db.prepare('INSERT INTO feature_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  const expected=[];
  db.exec('BEGIN');
  for(let day=0;day<days;day++) {
   const tradingDay=new Date(Date.UTC(2026,0,1+day)).toISOString().slice(0,10).replaceAll('-','');
   expected.unshift({trading_day:tradingDay,row_count:20,json_bytes:120});
   for(let row=0;row<20;row++) {
    const slot=(day*20+row)*120000;
    insertObservation.run(slot,slot,slot,tradingDay,1,'test','OK','{}','{}','{}');
    for(const version of [1,2]) insertFeature.run(slot,version,slot,tradingDay,'a'.repeat(40),'b'.repeat(64),slot,slot,'VERIFIED','SUCCESS','{}','{}');
   }
  }
  db.exec('COMMIT');
  let lengthCalls=0;
  // Count aggregate payload evaluations; this is neither CPU time nor D1 rows_read.
  db.function('length',value=>{lengthCalls++;return value==null?null:[...String(value)].length;});
  assert.equal(queries.length,2);
  return queries.map((sql,index)=>{
   lengthCalls=0;
   const args=index===1?[2]:[];
   const rows=db.prepare(sql).all(...args).map(row=>({...row}));
   const expectedRows=expected.slice(0,5).map(row=>({...row,json_bytes:index===1?80:120}));
   assert.deepEqual(rows,expectedRows);
   const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail).join('\n');
   assert.match(plan,index===1?/idx_feature_runs_version_day_slot/:/idx_history_day_slot/);
   assert.doesNotMatch(plan,/USE TEMP B-TREE/);
   return lengthCalls;
  });
 } finally {db.close();}
}

test('existing health aggregation keeps identical latest-five totals and bounded payload reads as history grows',()=>{
 const small=measure(10),large=measure(100);
 assert.deepEqual(large,small);
 assert.deepEqual(large,[5*20*3,5*20*2]);
});
