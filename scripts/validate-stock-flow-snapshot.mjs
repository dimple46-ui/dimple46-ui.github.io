import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const BUCKETS = {'1':'09:30','2':'10:00','3':'11:20','4':'13:20','5':'14:30'};
const STOCKS = {samsung:'005930',skHynix:'000660'};
const kstDay = ms => new Date(ms + 9*3600000).toISOString().slice(0,10).replaceAll('-','');
function requireValue(condition, code) {if (!condition) throw new Error(code);}
function sourceTime(day, time) {
  return Date.parse(`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}T${time}:00+09:00`);
}

// Local evidence audit only. No network, SQL, Feature writer or trading action.
export function validateStockFlowSnapshot(snapshot, {asOfMs=Date.now()}={}) {
  requireValue(Number.isSafeInteger(asOfMs), 'INVALID_AS_OF');
  const observedAtMs=Date.parse(snapshot?.relayUpdatedAt);
  requireValue(Number.isFinite(observedAtMs) && observedAtMs<=asOfMs, 'INVALID_SNAPSHOT_TIME');
  requireValue(snapshot.schemaVersion===3, 'UNSUPPORTED_SNAPSHOT_SCHEMA');
  const day=snapshot.koreaDate;
  requireValue(typeof day==='string' && /^\d{8}$/.test(day) &&
    kstDay(observedAtMs)===day && kstDay(asOfMs)===day, 'TRADING_DAY_MISMATCH');
  const stocks={};
  for(const [stock,ticker] of Object.entries(STOCKS)) {
    const value=snapshot.stockFlowEstimates?.[stock];
    const meta=snapshot.dataMeta?.stockFlowEstimates?.[stock];
    if (!value?.latest || !meta?.hasValue) {
      stocks[stock]={ticker,status:'WAITING_FOR_LIVE_DATA',reason:meta?.status??'MISSING'};
      continue;
    }
    requireValue(value.source==='KIS_OPEN_API' && value.isEstimate===true && value.stockCode===ticker,
      'INVALID_FLOW_IDENTITY');
    requireValue(value.businessDate===day, 'TRADING_DAY_MISMATCH');
    requireValue(meta.status==='CURRENT_BUCKET' && meta.timeBasis==='SOURCE_SCHEDULED_BUCKET', 'UNUSABLE_FLOW_QUALITY');
    requireValue(Array.isArray(value.rows) && value.rows.length>0, 'INVALID_BUCKET_ROWS');
    const times=value.rows.map(row=>{
      requireValue(BUCKETS[String(row.bucket)]===row.inputTimeKst, 'INVALID_BUCKET_TIME');
      const time=sourceTime(day,row.inputTimeKst);
      requireValue(time<=observedAtMs, 'FUTURE_BUCKET');
      for(const field of ['foreignNetBuyQty','institutionNetBuyQty'])
        requireValue(Number.isSafeInteger(row[field]), 'INVALID_FLOW_QUANTITY');
      return time;
    });
    requireValue(times.every((time,i)=>i===0||time>times[i-1]), 'UNORDERED_OR_DUPLICATE_BUCKET');
    const last=value.rows.at(-1);
    requireValue(['bucket','inputTimeKst','foreignNetBuyQty','institutionNetBuyQty']
      .every(field=>last[field]===value.latest[field]), 'LATEST_BUCKET_MISMATCH');
    requireValue(value.scheduledBucket===last.inputTimeKst.replace(':','') &&
      Date.parse(meta.marketTime)===times.at(-1), 'LATEST_BUCKET_MISMATCH');
    if(value.rows.length<3) {
      stocks[stock]={ticker,status:'WAITING_FOR_LIVE_DATA',reason:'INSUFFICIENT_BUCKET_HISTORY',bucketCount:value.rows.length};
      continue;
    }
    const rows=value.rows.slice(-3),sampleTimes=times.slice(-3);
    const intervalMinutes=[(sampleTimes[1]-sampleTimes[0])/60000,(sampleTimes[2]-sampleTimes[1])/60000];
    const flows={};
    for(const [flow,field] of [['foreign','foreignNetBuyQty'],['institution','institutionNetBuyQty']]) {
      const cumulative=rows.map(row=>row[field]);
      const delta=[cumulative[1]-cumulative[0],cumulative[2]-cumulative[1]];
      const deltaDifference=delta[1]-delta[0];
      requireValue([...delta,deltaDifference].every(Number.isSafeInteger), 'FLOW_ARITHMETIC_OVERFLOW');
      const sharesPerMinute=delta.map((quantity,i)=>quantity/intervalMinutes[i]);
      flows[flow]={cumulative,delta,deltaDifference,
        direction:delta.map(quantity=>quantity>0?'INCREASING':quantity<0?'DECREASING':'UNCHANGED_VALUE'),
        sharesPerMinute,rateChangeSharesPerMinute:sharesPerMinute[1]-sharesPerMinute[0]};
    }
    stocks[stock]={ticker,status:'PASS',bucketTimes:rows.map(row=>row.inputTimeKst),intervalMinutes,flows};
  }
  return {status:Object.values(stocks).every(stock=>stock.status==='PASS')?'PASS':'WAITING_FOR_LIVE_DATA',
    validation:'PUBLIC_SNAPSHOT_BUCKET_ARITHMETIC_ONLY',tradingDay:day,observedAt:snapshot.relayUpdatedAt,
    snapshotAgeMs:asOfMs-observedAtMs,isEstimate:true,unit:'shares',
    accelerationDefinition:'DELTA_DIFFERENCE_NOT_TIME_NORMALIZED',stocks,
    pipelineStatus:snapshot.pipelineStatus??null,sourceErrors:snapshot.sourceErrors??null,
    limitations:['Capture-time CURRENT_BUCKET metadata is not independent exchange verification',
      'Unequal bucket durations require per-minute rates; delta difference alone is not comparable speed',
      'Does not validate D1 rows, Feature v2 persistence or deployed Signal output']};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const snapshot=JSON.parse(await readFile(process.argv[2],'utf8'));
    console.log(JSON.stringify(validateStockFlowSnapshot(snapshot),null,2));
  } catch(error) {
    console.error(JSON.stringify({status:'FAIL',code:/^[A-Z_]+$/.test(error.message)?error.message:'INVALID_SNAPSHOT_INPUT'}));
    process.exitCode=1;
  }
}
