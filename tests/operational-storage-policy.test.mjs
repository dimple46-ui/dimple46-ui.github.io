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
