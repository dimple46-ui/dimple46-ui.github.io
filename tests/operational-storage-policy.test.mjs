import test from 'node:test';
import assert from 'node:assert/strict';
import {retentionGate,snapshotCommitPressure,summarizeJsonGrowth} from '../cloudflare/operational-storage-policy.mjs';

test('growth projection uses measured trading days and never invents an empty zero',()=>{
 const empty=summarizeJsonGrowth([]);
 assert.equal(empty.status,'INSUFFICIENT_DATA');assert.equal(empty.averageJsonBytesPerTradingDay,null);
 const measured=summarizeJsonGrowth([
  {trading_day:'20261005',row_count:300,json_bytes:9000000},
  {trading_day:'20261006',row_count:331,json_bytes:10000000},
  {trading_day:'20261007',row_count:320,json_bytes:11000000}
 ]);
 assert.equal(measured.status,'MEASURED_SAMPLE');assert.equal(measured.averageRowsPerTradingDay,317);
 assert.equal(measured.averageJsonBytesPerTradingDay,10000000);
 assert.equal(measured.projectedAnnualJsonBytes,2500000000);
});

test('snapshot projection exposes repository-history pressure',()=>{
 const projection=snapshotCommitPressure({commitsPerTradingDay:331});
 assert.equal(projection.projectedAnnualCommits,82750);
 assert.equal(projection.status,'HIGH_HISTORY_PRESSURE');
});

test('retention gate requires measurements and never authorizes deletion',()=>{
 assert.equal(retentionGate({}).status,'INSUFFICIENT_MEASUREMENT');
 const warning=retentionGate({measuredDatabaseBytes:350,databaseLimitBytes:500,projectedDailyBytes:2});
 assert.equal(warning.status,'ARCHIVE_PLAN_WARNING');assert.equal(warning.automatedDeletionAllowed,false);
 const required=retentionGate({measuredDatabaseBytes:450,databaseLimitBytes:500,projectedDailyBytes:2});
 assert.equal(required.status,'ARCHIVE_PLAN_REQUIRED');assert.equal(required.automatedDeletionAllowed,false);
});

test('unknown measurements cannot become zero growth or a healthy retention result',()=>{
 for (const missing of [null,undefined,'','  ',false,true,[],{},NaN,Infinity,-1]) {
  const growth=summarizeJsonGrowth([{trading_day:'20261012',row_count:330,json_bytes:missing}]);
  assert.equal(growth.status,'INSUFFICIENT_DATA');
  assert.equal(growth.projectedAnnualJsonBytes,null);
  assert.equal(snapshotCommitPressure({commitsPerTradingDay:missing}).status,'INSUFFICIENT_DATA');
  for (const field of ['measuredDatabaseBytes','databaseLimitBytes','projectedDailyBytes','minimumHotTradingDays']) {
   // Omitted optional policy uses the documented 60-day default, not a measurement.
   if (field === 'minimumHotTradingDays' && missing === undefined) continue;
   const gate=retentionGate({measuredDatabaseBytes:100,databaseLimitBytes:1000,projectedDailyBytes:2,minimumHotTradingDays:60,[field]:missing});
   assert.equal(gate.status,'INSUFFICIENT_MEASUREMENT');
   assert.equal(gate.utilizationRatio,null);
   assert.equal(gate.automatedDeletionAllowed,false);
  }
 }
});

test('measured zero and numeric database strings remain valid; missing rows do not dilute averages',()=>{
 const growth=summarizeJsonGrowth([
  {trading_day:'20261012',row_count:null,json_bytes:null},
  {trading_day:'20261013',row_count:'10',json_bytes:'200'}
 ]);
 assert.equal(growth.sampleTradingDays,1);
 assert.equal(growth.averageJsonBytesPerTradingDay,200);
 assert.equal(snapshotCommitPressure({commitsPerTradingDay:0}).projectedAnnualCommits,0);
 const zero=retentionGate({measuredDatabaseBytes:0,databaseLimitBytes:1000,projectedDailyBytes:0});
 assert.equal(zero.status,'MONITOR');assert.equal(zero.utilizationRatio,0);
 assert.equal(zero.estimatedDaysRemaining,null);
});

test('annual projections exclude current and future days without changing source totals',()=>{
 const rows=[
  {trading_day:'20261012',row_count:330,json_bytes:6600000},
  {trading_day:'20261013',row_count:5,json_bytes:100000},
  {trading_day:'20261014',row_count:330,json_bytes:6600000}
 ];
 const copy=structuredClone(rows);
 const result=summarizeJsonGrowth(rows,{excludeOnOrAfterTradingDay:'20261013'});
 assert.equal(result.sampleTradingDays,1);
 assert.equal(result.excludedCurrentOrFutureDays,2);
 assert.equal(result.averageJsonBytesPerTradingDay,6600000);
 assert.equal(result.projectedAnnualJsonBytes,1650000000);
 assert.equal(result.sampleCompleteness,'NOT_VERIFIED');
 assert.deepEqual(rows,copy);
 const empty=summarizeJsonGrowth(rows.slice(1),{excludeOnOrAfterTradingDay:'20261013'});
 assert.equal(empty.status,'INSUFFICIENT_DATA');
 assert.equal(empty.projectedAnnualJsonBytes,null);
 assert.equal(empty.excludedCurrentOrFutureDays,2);
});
