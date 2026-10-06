// Generated from PR candidate; do not edit.
const CANDIDATE_SHA256 = "73758483c22f7d411f25cbf940f28f7f4dd676062b5e5cd1306086467d2c3a90";
const FEATURE_VERSION = 2;
const SAME_TIME_TOLERANCE_MS = 150000;
const KST_OFFSET_MS = 32400000;
function usableHistoryMetric(metric, atMs) {
  if (!metric || metric.value == null || !Number.isFinite(metric.value)) return false;
  const available = Date.parse(metric.availableAt);
  if (!Number.isFinite(available) || available > atMs) return false;
  if (!["LIVE", "RECENT_FETCH", "CURRENT_BUCKET"].includes(metric.status)) return false;
  const timestamp = Date.parse(metric.marketTime || metric.fetchedAt);
  if (!Number.isFinite(timestamp) || timestamp > atMs + 60000) return false;
  return metric.status === "CURRENT_BUCKET" || atMs - timestamp <= 300000;
}
function decodeHistoryRow(row) {
  return {...row, metrics: row.metrics ?? JSON.parse(row.metrics_json), quality: row.quality ?? JSON.parse(row.quality_json)};
}
function featureMetricQuality(metric) {
  if (!metric || metric.value == null || !Number.isFinite(metric.value)) return "MISSING_INPUT";
  if (["STALE", "STALE_BUCKET"].includes(metric.status)) return "STALE_INPUT";
  if (metric.status === "RECENT_FETCH") return "UNVERIFIED_TIME";
  return ["LIVE", "CURRENT_BUCKET"].includes(metric.status) ? "VERIFIED" : "UNUSABLE_INPUT";
}
function featureValue(value=null,status="INSUFFICIENT_HISTORY",sampleCount=0,quality="UNKNOWN",extra={}) {
  return {value,status,sampleCount,quality,...extra};
}
function combinedFeatureQuality(...items) {
  const qualities=items.map(item=>item?.quality).filter(Boolean);
  if(qualities.includes("MISSING_INPUT")) return "MISSING_INPUT";
  if(qualities.includes("STALE_INPUT")) return "STALE_INPUT";
  if(qualities.includes("UNUSABLE_INPUT")) return "UNUSABLE_INPUT";
  if(qualities.includes("UNVERIFIED_TIME")) return "UNVERIFIED_TIME";
  return qualities.length&&qualities.every(value=>value==="VERIFIED") ? "VERIFIED" : "UNKNOWN";
}
function average(values) { return values.reduce((sum,value)=>sum+value,0)/values.length; }
function median(values) {
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
}
function standardDeviation(values,mean=average(values)) {
  return Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length);
}
function sameTimeHistoricalBaselines(current, rawRows) {
  const rows=rawRows.map(decodeHistoryRow).filter(row=>row.trading_day<current.trading_day &&
    row.observed_at_ms<=current.observed_at_ms && row.available_at_ms<=current.observed_at_ms)
    .sort((a,b)=>b.observed_at_ms-a.observed_at_ms);
  const generatedAt=new Date(current.observed_at_ms).toISOString();
  const metricNames=["samsung.volume","skHynix.volume","samsung.foreignFlow","samsung.institutionFlow",
    "skHynix.foreignFlow","skHynix.institutionFlow","market.foreigner","market.institution","market.individual",
    "program.arbitrageNet","program.nonArbitrageNet","program.totalNet","futures.foreignNet","futures.institutionNet",
    "futures.individualNet","futures.openInterest","futures.basis","futures.marketBasis"];
  const windows={};
  for(const days of [5,10,20]){
    const selected=rows.slice(0,days),metrics={};
    for(const name of metricNames){
      const currentMetric=current.metrics[name],quality=featureMetricQuality(currentMetric);
      const values=selected.filter(row=>usableHistoryMetric(row.metrics[name],row.observed_at_ms)).map(row=>row.metrics[name].value);
      let result={status:"INSUFFICIENT_HISTORY",value:null,sampleCount:values.length,requiredSampleCount:days,
        mean:null,median:null,standardDeviation:null,percentile:null,zScore:null,ratioToMean:null,quality};
      if(!usableHistoryMetric(currentMetric,current.observed_at_ms)) result.status=quality;
      else if(selected.length>=days && values.length>=days){
        const mean=average(values),sd=standardDeviation(values,mean);
        result={...result,status:"VALID",value:currentMetric.value,mean,median:median(values),standardDeviation:sd,
          percentile:values.filter(value=>value<=currentMetric.value).length/values.length*100,
          zScore:sd>0?(currentMetric.value-mean)/sd:null,ratioToMean:mean!==0?currentMetric.value/mean:null};
        if(sd===0) result.limitations=["ZERO_VARIANCE_ZSCORE_UNAVAILABLE"];
      }
      metrics[name]=result;
    }
    windows[`${days}d`]={status:selected.length>=days?"AVAILABLE":"INSUFFICIENT_HISTORY",requestedTradingDays:days,
      sampleCount:selected.length,generatedAt,inputCutoff:generatedAt,metrics};
  }
  return {status:rows.length>=5?"AVAILABLE":"INSUFFICIENT_HISTORY",generatedAt,inputCutoff:generatedAt,
    availableTradingDays:rows.length,selection:"LATEST_OBSERVATION_AT_OR_BEFORE_SAME_KST_TIME_WITHIN_150_SECONDS",windows};
}
function pairDirection(primary,secondary,primaryLabel,secondaryLabel) {
  const usableStatuses=new Set(["OK","BUCKET_CHANGE_ONLY"]);
  if(primary?.value==null || secondary?.value==null || !usableStatuses.has(primary?.status) || !usableStatuses.has(secondary?.status))
    return {state:null,status:"INSUFFICIENT_OR_UNUSABLE_INPUT",strength:null,supportingEvidence:[],contraryEvidence:[]};
  const a=Math.sign(primary.value),b=Math.sign(secondary.value);
  let state="MIXED_OR_FLAT";
  if(a!==0&&a===b) state="CONFIRMING";
  else if(a>0&&b<0) state=`${primaryLabel}_UP_${secondaryLabel}_DOWN`;
  else if(a<0&&b>0) state=`${primaryLabel}_DOWN_${secondaryLabel}_UP`;
  return {state,status:"VALID",strength:Math.abs(primary.value),confidence:"UNVALIDATED",
    quality:combinedFeatureQuality(primary,secondary),
    supportingEvidence:[{metric:primaryLabel,value:primary.value},{metric:secondaryLabel,value:secondary.value}],
    contraryEvidence:a!==0&&b!==0&&a!==b?[{reason:"DIRECTION_CONFLICT"}]:[]};
}
function futuresPositionClassification(window) {
  const price=window.metrics["futures.price"],oi=window.metrics["futures.openInterest"];
  if(price?.value==null||oi?.value==null||price?.status!=="OK"||oi?.status!=="OK")
    return {state:null,status:"INSUFFICIENT_OR_UNUSABLE_INPUT",confidence:"NONE",supportingEvidence:[],contraryEvidence:[]};
  const priceDirection=Math.sign(price.value),oiDirection=Math.sign(oi.value);
  let state="MIXED_OR_FLAT";
  if(priceDirection>0&&oiDirection>0) state="NEW_LONG_CANDIDATE";
  else if(priceDirection<0&&oiDirection>0) state="NEW_SHORT_CANDIDATE";
  else if(priceDirection>0&&oiDirection<0) state="SHORT_COVER_CANDIDATE";
  else if(priceDirection<0&&oiDirection<0) state="LONG_LIQUIDATION_CANDIDATE";
  const contraryEvidence=[];
  const supportingEvidence=[{metric:"futures.priceReturnPct",value:price.value},
    {metric:"futures.openInterestDelta",value:oi.value}];
  const foreign=window.metrics["futures.foreignNet"],basis=window.metrics["futures.basis"];
  for(const [name,result] of [["futures.foreignNet",foreign],["futures.basis",basis]]){
    if(result?.status!=="OK"||Math.sign(result.value)===0) continue;
    if(Math.sign(result.value)===priceDirection) supportingEvidence.push({metric:name,value:result.value});
    else contraryEvidence.push({metric:name,value:result.value,reason:"OPPOSES_PRICE_DIRECTION"});
  }
  return {state,status:"VALID",confidence:supportingEvidence.length>=3&&contraryEvidence.length===0?"MEDIUM":"LOW",
    quality:combinedFeatureQuality(price,oi),supportingEvidence,contraryEvidence,
    limitations:["PRICE_AND_OI_HEURISTIC_NOT_CONFIRMED_POSITION_DATA"]};
}
function historyFeatures(current, rawRows, rawSameTimeRows=[]) {
  const now = current.observed_at_ms;
  // The as-of cutoff rejects records collected later, even if backdated.
  const rows = rawRows.map(decodeHistoryRow).filter(r => r.trading_day === current.trading_day &&
    r.observed_at_ms <= now && r.available_at_ms <= now).sort((a,b) => a.observed_at_ms-b.observed_at_ms);
  const windows = {};
  for (const minutes of [2,5,10,30]) {
    const target = now - minutes * 60000;
    // Use only a sample at/before target; no interpolation or future sample.
    const candidates = rows.filter(r => r.observed_at_ms <= target && target-r.observed_at_ms <= 150000);
    const baseline = candidates.at(-1);
    const window = {status: baseline ? "AVAILABLE" : "INSUFFICIENT_HISTORY", requestedMinutes:minutes,
      baselineAt:baseline ? new Date(baseline.observed_at_ms).toISOString() : null,
      actualElapsedSeconds:baseline ? (now-baseline.observed_at_ms)/1000 : null,
      generatedAt:new Date(now).toISOString(),inputCutoff:new Date(now).toISOString(),sampleCount:baseline?2:1,metrics:{}};
    for (const [name, metric] of Object.entries(current.metrics)) {
      const old = baseline?.metrics?.[name];
      const result = featureValue(null,"INSUFFICIENT_HISTORY",baseline?2:1,featureMetricQuality(metric));
      if (baseline) {
        result.status = "UNUSABLE_DATA";
        if (usableHistoryMetric(metric,now) && usableHistoryMetric(old,baseline.observed_at_ms)) {
          result.status = "OK";
          const bucket = name.endsWith("Flow");
          const isFuture = name.startsWith("futures.");
          if (isFuture && (!current.quality.futuresCode || current.quality.futuresCode !== baseline.quality.futuresCode)) {
            result.status = "CONTRACT_CHANGED";
          } else if (bucket) {
            // Bucket data is stepwise; repeated observations are not fresh zero flows.
            if (metric.marketTime === old.marketTime) {
              result.status = "UNCHANGED_BUCKET";
            } else {
              result.value = metric.value - old.value;
              result.status = "BUCKET_CHANGE_ONLY";
              result.unit = "shares";
              result.bucketElapsedSeconds = (Date.parse(metric.marketTime) - Date.parse(old.marketTime)) / 1000;
            }
          } else if (name.endsWith(".price")) {
            result.value = old.value > 0 ? (metric.value/old.value-1)*100 : null;
            result.status = result.value == null ? "INVALID_BASELINE" : "OK";
            result.unit = "percent";
          } else if (!/\.(previousClose|open|high|low)$/.test(name)) {
            result.value = metric.value-old.value;
            if (/\.(volume|tradingValue)$/.test(name) && result.value < 0) {
              result.value=null; result.status="COUNTER_RESET";
            }
          } else { result.status="NOT_APPLICABLE"; }
          result.timeBasis = metric.timeBasis;
        }
      }
      window.metrics[name]=result;
    }
    // Acceleration is change in shares/minute across two actual sampled windows.
    const previousTarget = baseline ? baseline.observed_at_ms-minutes*60000 : null;
    const earlier = baseline ? rows.filter(r => r.observed_at_ms<=previousTarget && previousTarget-r.observed_at_ms<=150000).at(-1) : null;
    window.volumeAcceleration = {};
    window.volumeRate = {};
    window.realizedVolatility = {};
    window.momentumAcceleration = {};
    for (const name of ["samsung","skHynix"]) {
      const field=`${name}.volume`, metric=current.metrics[field], old=baseline?.metrics[field], prev=earlier?.metrics[field];
      const result=featureValue(null,"INSUFFICIENT_HISTORY",earlier?3:baseline?2:1,featureMetricQuality(metric),
        {unit:"shares_per_minute_change"});
      if (baseline && earlier && usableHistoryMetric(metric,now) && usableHistoryMetric(old,baseline.observed_at_ms) && usableHistoryMetric(prev,earlier.observed_at_ms)) {
        const d1=metric.value-old.value,d0=old.value-prev.value;
        if(d1>=0 && d0>=0){result.value=d1/((now-baseline.observed_at_ms)/60000)-d0/((baseline.observed_at_ms-earlier.observed_at_ms)/60000);result.status="OK";}
        else result.status="COUNTER_RESET";
      }
      window.volumeAcceleration[name]=result;
      const volumeDelta=window.metrics[field];
      window.volumeRate[name]=featureValue(volumeDelta?.value!=null&&window.actualElapsedSeconds>0?
        volumeDelta.value/(window.actualElapsedSeconds/60):null,volumeDelta?.status??"INSUFFICIENT_HISTORY",
        volumeDelta?.sampleCount??0,volumeDelta?.quality??"UNKNOWN",{unit:"shares_per_minute"});
      const priceField=`${name}.price`,series=baseline?rows.filter(row=>row.observed_at_ms>=baseline.observed_at_ms)
        .filter(row=>usableHistoryMetric(row.metrics[priceField],row.observed_at_ms)).map(row=>row.metrics[priceField].value):[];
      const returns=[];for(let i=1;i<series.length;i++) if(series[i-1]>0&&series[i]>0) returns.push(Math.log(series[i]/series[i-1])*100);
      window.realizedVolatility[name]=featureValue(returns.length?Math.sqrt(returns.reduce((sum,value)=>sum+value**2,0)):null,
        returns.length?"OK":"INSUFFICIENT_HISTORY",returns.length,featureMetricQuality(current.metrics[priceField]),{unit:"log_return_rss_percent"});
      const currentReturn=window.metrics[priceField],oldPrice=baseline?.metrics[priceField],previousPrice=earlier?.metrics[priceField];
      let acceleration=null,status="INSUFFICIENT_HISTORY";
      if(currentReturn?.status==="OK"&&usableHistoryMetric(oldPrice,baseline.observed_at_ms)&&usableHistoryMetric(previousPrice,earlier?.observed_at_ms)&&previousPrice.value>0){
        acceleration=currentReturn.value-(oldPrice.value/previousPrice.value-1)*100;status="OK";
      }
      window.momentumAcceleration[name]=featureValue(acceleration,status,acceleration==null?0:3,featureMetricQuality(current.metrics[priceField]),{unit:"percentage_points"});
    }
    window.acceleration={};
    window.direction={};
    for(const field of ["market.foreigner","market.institution","market.individual","program.arbitrageNet",
      "program.nonArbitrageNet","program.totalNet","futures.foreignNet","futures.institutionNet",
      "futures.individualNet","futures.openInterest"]){
      const currentDelta=window.metrics[field],old=baseline?.metrics[field],previous=earlier?.metrics[field];
      let value=null,status="INSUFFICIENT_HISTORY";
      if(currentDelta?.status==="OK"&&usableHistoryMetric(old,baseline?.observed_at_ms)&&
        usableHistoryMetric(previous,earlier?.observed_at_ms)){
        const currentMinutes=(now-baseline.observed_at_ms)/60000;
        const previousMinutes=(baseline.observed_at_ms-earlier.observed_at_ms)/60000;
        if(currentMinutes>0&&previousMinutes>0){
          value=currentDelta.value/currentMinutes-(old.value-previous.value)/previousMinutes;status="OK";
        }
      }
      window.acceleration[field]=featureValue(value,status,value==null?0:3,featureMetricQuality(current.metrics[field]),
        {unit:"value_per_minute_change"});
      window.direction[field]={state:currentDelta?.value==null?null:currentDelta.value>0?"INCREASING":
        currentDelta.value<0?"DECREASING":"UNCHANGED",status:currentDelta?.status??"INSUFFICIENT_HISTORY",
        quality:currentDelta?.quality??"UNKNOWN"};
    }
    window.relativeStrength={};
    for(const [a,b] of [["samsung","skHynix"],["samsung","kospi"],["skHynix","kospi"],["samsung","kospi200"],["skHynix","kospi200"]]) {
      const av=window.metrics[`${a}.price`],bv=window.metrics[`${b}.price`];
      window.relativeStrength[`${a}_vs_${b}`]=featureValue(av?.value!=null&&bv?.value!=null?av.value-bv.value:null,
        av?.status==="OK"&&bv?.status==="OK"?"OK":"INSUFFICIENT_OR_UNUSABLE_INPUT",
        Math.min(av?.sampleCount??0,bv?.sampleCount??0),combinedFeatureQuality(av,bv),{unit:"percentage_points",
          components:{primaryReturnPct:av?.value??null,secondaryReturnPct:bv?.value??null}});
    }
    window.futuresPosition=futuresPositionClassification(window);
    window.divergences={
      cashVsFutures:pairDirection(window.metrics["kospi.price"],window.metrics["futures.price"],"CASH","FUTURES"),
      samsungVsSkHynix:pairDirection(window.metrics["samsung.price"],window.metrics["skHynix.price"],"SAMSUNG","SK_HYNIX"),
      samsungPriceVsForeignFlow:pairDirection(window.metrics["samsung.price"],window.metrics["samsung.foreignFlow"],"PRICE","FOREIGN_FLOW"),
      samsungPriceVsInstitutionFlow:pairDirection(window.metrics["samsung.price"],window.metrics["samsung.institutionFlow"],"PRICE","INSTITUTION_FLOW"),
      skHynixPriceVsForeignFlow:pairDirection(window.metrics["skHynix.price"],window.metrics["skHynix.foreignFlow"],"PRICE","FOREIGN_FLOW"),
      skHynixPriceVsInstitutionFlow:pairDirection(window.metrics["skHynix.price"],window.metrics["skHynix.institutionFlow"],"PRICE","INSTITUTION_FLOW"),
      samsungPriceVsProgram:pairDirection(window.metrics["samsung.price"],window.metrics["program.totalNet"],"PRICE","PROGRAM"),
      skHynixPriceVsProgram:pairDirection(window.metrics["skHynix.price"],window.metrics["program.totalNet"],"PRICE","PROGRAM"),
      samsungPriceVsFuturesForeign:pairDirection(window.metrics["samsung.price"],window.metrics["futures.foreignNet"],"PRICE","FUTURES_FOREIGN"),
      skHynixPriceVsFuturesForeign:pairDirection(window.metrics["skHynix.price"],window.metrics["futures.foreignNet"],"PRICE","FUTURES_FOREIGN"),
      samsungPriceVsOpenInterest:pairDirection(window.metrics["samsung.price"],window.metrics["futures.openInterest"],"PRICE","OPEN_INTEREST"),
      skHynixPriceVsOpenInterest:pairDirection(window.metrics["skHynix.price"],window.metrics["futures.openInterest"],"PRICE","OPEN_INTEREST")
    };
    windows[`${minutes}m`]=window;
  }
  const bucketChanges={};
  for(const name of ["samsung","skHynix"]){
    bucketChanges[name]={};
    for(const field of ["foreignFlow","institutionFlow"]){
      const key=`${name}.${field}`,metric=current.metrics[key];
      const sameBucket=rows.filter(r=>r.observed_at_ms<now&&usableHistoryMetric(r.metrics[key],r.observed_at_ms)&&
        r.metrics[key].marketTime===metric?.marketTime).at(-1);
      const previous=rows.filter(r=>r.observed_at_ms<now&&usableHistoryMetric(r.metrics[key],r.observed_at_ms)&&
        r.metrics[key].marketTime!==metric?.marketTime).at(-1);
      const previousPrevious=previous?rows.filter(r=>r.observed_at_ms<previous.observed_at_ms&&usableHistoryMetric(r.metrics[key],r.observed_at_ms)&&
        r.metrics[key].marketTime!==previous.metrics[key].marketTime).at(-1):null;
      const validCurrent=usableHistoryMetric(metric,now),isNewBucket=validCurrent&&!sameBucket;
      const value=isNewBucket&&previous?metric.value-previous.metrics[key].value:null;
      const priorDelta=previous&&previousPrevious?previous.metrics[key].value-previousPrevious.metrics[key].value:null;
      const stockVolume=current.metrics[`${name}.volume`];
      bucketChanges[name][field]={value,status:!validCurrent?featureMetricQuality(metric):sameBucket?"BUCKET_UNCHANGED":
        previous?"BUCKET_DELTA":"INSUFFICIENT_BUCKET_HISTORY",unit:"shares",sampleCount:value==null?0:2,
        quality:featureMetricQuality(metric),direction:value==null?null:value>0?"INCREASING":value<0?"DECREASING":"UNCHANGED",
        acceleration:value!=null&&priorDelta!=null?value-priorDelta:null,
        accelerationStatus:value!=null&&priorDelta!=null?"VALID":"INSUFFICIENT_BUCKET_HISTORY",
        shareOfVolumePct:value!=null&&usableHistoryMetric(stockVolume,now)&&stockVolume.value>0?value/stockVolume.value*100:null,
        previousBucketTime:previous?.metrics[key]?.marketTime??null,currentBucketTime:metric?.marketTime??null,
        limitations:["DISCRETE_ESTIMATE_BUCKET_NOT_CONTINUOUS_FLOW","SHARE_OF_VOLUME_USES_QUANTITY_NOT_TRADING_VALUE"]};
    }
  }
  const intraday={returns:{},relativeStrength:{}};
  const firstRow=rows.find(row=>row.observed_at_ms<now);
  for(const name of ["samsung","skHynix","kospi","kospi200","futures"]){
    const key=`${name}.price`,metric=current.metrics[key],first=firstRow?.metrics?.[key];
    intraday.returns[name]=featureValue(usableHistoryMetric(metric,now)&&usableHistoryMetric(first,firstRow?.observed_at_ms)&&first.value>0?
      (metric.value/first.value-1)*100:null,usableHistoryMetric(metric,now)&&usableHistoryMetric(first,firstRow?.observed_at_ms)&&first.value>0?"OK":"INSUFFICIENT_HISTORY",
      firstRow?2:1,featureMetricQuality(metric),{unit:"percent",baselineAt:firstRow?new Date(firstRow.observed_at_ms).toISOString():null});
  }
  for(const [a,b] of [["samsung","skHynix"],["samsung","kospi"],["skHynix","kospi"],["samsung","kospi200"],["skHynix","kospi200"]]){
    const av=intraday.returns[a],bv=intraday.returns[b];intraday.relativeStrength[`${a}_vs_${b}`]=featureValue(
      av.value!=null&&bv.value!=null?av.value-bv.value:null,av.value!=null&&bv.value!=null?"OK":"INSUFFICIENT_HISTORY",
      Math.min(av.sampleCount,bv.sampleCount),av.quality==="VERIFIED"&&bv.quality==="VERIFIED"?"VERIFIED":"UNVERIFIED_TIME",{unit:"percentage_points"});
  }
  for(const name of ["samsung","skHynix"]){
    const m=current.metrics,price=m[`${name}.price`],open=m[`${name}.open`],close=m[`${name}.previousClose`];
    const valid=usableHistoryMetric(price,now);
    const high=m[`${name}.high`],low=m[`${name}.low`],volume=m[`${name}.volume`],tradingValue=m[`${name}.tradingValue`];
    const vwap=valid&&usableHistoryMetric(volume,now)&&usableHistoryMetric(tradingValue,now)&&volume.value>0?tradingValue.value/volume.value:null;
    const intradayQuality=featureMetricQuality(price);
    intraday[name]={fromOpenPct:valid&&usableHistoryMetric(open,now)&&open.value>0?(price.value/open.value-1)*100:null,
      fromPreviousClosePct:valid&&usableHistoryMetric(close,now)&&close.value>0?(price.value/close.value-1)*100:null,
      highLowPosition:valid&&usableHistoryMetric(high,now)&&usableHistoryMetric(low,now)&&high.value>low.value?(price.value-low.value)/(high.value-low.value):null,
      vwap,vwapDeviationPct:vwap>0?(price.value/vwap-1)*100:null,
      status:valid?"VALID":intradayQuality,quality:intradayQuality,
      metrics:{fromOpenPct:featureValue(valid&&usableHistoryMetric(open,now)&&open.value>0?(price.value/open.value-1)*100:null,
          valid&&usableHistoryMetric(open,now)&&open.value>0?"VALID":"MISSING_OR_UNUSABLE_INPUT",2,combinedFeatureQuality(
            {quality:intradayQuality},{quality:featureMetricQuality(open)}),{unit:"percent"}),
        fromPreviousClosePct:featureValue(valid&&usableHistoryMetric(close,now)&&close.value>0?(price.value/close.value-1)*100:null,
          valid&&usableHistoryMetric(close,now)&&close.value>0?"VALID":"MISSING_OR_UNUSABLE_INPUT",2,combinedFeatureQuality(
            {quality:intradayQuality},{quality:featureMetricQuality(close)}),{unit:"percent"}),
        highLowPosition:featureValue(valid&&usableHistoryMetric(high,now)&&usableHistoryMetric(low,now)&&high.value>low.value?
          (price.value-low.value)/(high.value-low.value):null,valid&&usableHistoryMetric(high,now)&&usableHistoryMetric(low,now)&&high.value>low.value?
          "VALID":"MISSING_OR_UNUSABLE_INPUT",3,combinedFeatureQuality({quality:intradayQuality},{quality:featureMetricQuality(high)},
            {quality:featureMetricQuality(low)}),{unit:"zero_to_one"}),
        vwapDeviationPct:featureValue(vwap>0?(price.value/vwap-1)*100:null,vwap>0?"VALID":"MISSING_OR_UNUSABLE_INPUT",3,
          combinedFeatureQuality({quality:intradayQuality},{quality:featureMetricQuality(volume)},{quality:featureMetricQuality(tradingValue)}),
          {unit:"percent",vwap})}};
  }
  const relativeStrength={availableHorizons:["2m","5m","10m","30m","intraday"],
    locations:{pointInTime:"windows.<horizon>.relativeStrength",intraday:"intraday.relativeStrength"}};
  const sameTimeHistorical=sameTimeHistoricalBaselines(current,rawSameTimeRows);
  return {version:FEATURE_VERSION,generatedAt:new Date(now).toISOString(),inputCutoff:new Date(now).toISOString(),windows,bucketChanges,intraday,
    relativeStrength,sameTimeHistorical,sameTimeHistoricalAverage:{status:"RENAMED",path:"sameTimeHistorical"},
    limitations:["2-minute sampling: inspect actualElapsedSeconds", "RECENT_FETCH has unverified exchange time", "stock flows use bucket deltas, not fabricated continuous flows", "stock-flow/trading-value ratio is unavailable because stock flow is quantity, not value", "same-time statistics require complete trading-day samples", "divergence and futures position states are descriptive, not BUY/SELL signals"]};
}

export default {
  async fetch(request, env) {
    if (!env.VALIDATION_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.VALIDATION_TOKEN}`)
      return Response.json({error:'UNAUTHORIZED'}, {status:401});
    if (request.method !== 'GET') return Response.json({error:'METHOD_NOT_ALLOWED'}, {status:405});
    const started = Date.now();
    try {
      const db = env.MARKET_HISTORY;
      const current = await db.prepare('SELECT * FROM market_observations WHERE available_at_ms <= ? ORDER BY slot_ms DESC LIMIT 1').bind(Date.now()).first();
      if (!current) return Response.json({error:'NO_OBSERVATIONS'}, {status:409});
      const rows = await db.prepare('SELECT * FROM market_observations WHERE trading_day = ? AND slot_ms <= ? ORDER BY slot_ms DESC LIMIT 331').bind(current.trading_day, current.slot_ms).all();
      const time = (current.observed_at_ms + KST_OFFSET_MS) % 86400000;
      const historical = await db.prepare(`WITH recent_days AS (
        SELECT trading_day FROM market_observations WHERE trading_day < ? GROUP BY trading_day ORDER BY trading_day DESC LIMIT 20
      ) SELECT * FROM (
        SELECT observation.*, ROW_NUMBER() OVER (PARTITION BY trading_day ORDER BY observed_at_ms DESC) AS same_time_rank
        FROM market_observations AS observation INNER JOIN recent_days USING (trading_day)
        WHERE available_at_ms <= ? AND ((observed_at_ms + ?) % 86400000) BETWEEN ? AND ?
      ) WHERE same_time_rank = 1 ORDER BY trading_day DESC LIMIT 20`).bind(current.trading_day, current.observed_at_ms, KST_OFFSET_MS, Math.max(0,time-SAME_TIME_TOLERANCE_MS), time).all();
      if (!rows.success || !historical.success) throw new Error('READ_FAILED');
      const features = historyFeatures(decodeHistoryRow(current), rows.results, historical.results);
      const bytes = value => new TextEncoder().encode(value).length;
      return Response.json({mode:'READ_ONLY_REPLAY',candidateSha256:CANDIDATE_SHA256,
        storedFeatureVersion:current.features_json ? JSON.parse(current.features_json).version : null,
        observedAt:new Date(current.observed_at_ms).toISOString(),observationAgeSeconds:(Date.now()-current.observed_at_ms)/1000,
        distinctSlots:new Set(rows.results.map(r=>r.slot_ms)).size,
        featuresBytes:bytes(JSON.stringify(features)),hypotheticalRowJsonBytes:bytes(current.metrics_json)+bytes(current.quality_json)+bytes(JSON.stringify(features)),
        elapsedWallMs:Date.now()-started,measurementNote:'Wall time is not Worker CPU. No v2 row was stored.',features},
        {headers:{'Cache-Control':'no-store'}});
    } catch {
      return Response.json({error:'VALIDATION_READ_FAILED'}, {status:503,headers:{'Cache-Control':'no-store'}});
    }
  }
};
