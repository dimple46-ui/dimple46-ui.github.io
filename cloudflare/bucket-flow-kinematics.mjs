// Query-time candidate contract. Not wired to the Feature writer or Signal v2.
export const BUCKET_KINEMATICS_VERSION = 1;
const kstDay = ms => new Date(ms+9*3600000).toISOString().slice(0,10);
function requireInput(condition, code) {if(!condition) throw new Error(code);}

export function bucketFlowKinematics(samples, {inputCutoffMs}={}) {
  requireInput(Number.isSafeInteger(inputCutoffMs) && inputCutoffMs>0, 'INVALID_INPUT_CUTOFF');
  const empty={version:BUCKET_KINEMATICS_VERSION,inputCutoffMs,
    deltaShares:null,deltaDifferenceShares:null,intervalMinutes:null,
    averageFlowSharesPerMinute:null,rateChangeSharesPerMinute:null,
    midpointDistanceMinutes:null,accelerationSharesPerMinuteSquared:null};
  if(!Array.isArray(samples) || samples.length<3)
    return {...empty,status:'INSUFFICIENT_BUCKET_HISTORY'};
  requireInput(samples.length===3, 'EXPECTED_THREE_BUCKETS');
  const day=kstDay(inputCutoffMs);
  for(const sample of samples) {
    requireInput(sample && Number.isSafeInteger(sample.marketTimeMs) && sample.marketTimeMs>0 &&
      Number.isSafeInteger(sample.availableAtMs), 'INVALID_BUCKET_TIME');
    requireInput(sample.marketTimeMs<=sample.availableAtMs && sample.availableAtMs<=inputCutoffMs,
      'FUTURE_OR_UNAVAILABLE_BUCKET');
    requireInput(kstDay(sample.marketTimeMs)===day && kstDay(sample.availableAtMs)===day,
      'CROSS_TRADING_DAY_BUCKET');
    requireInput(sample.timeBasis==='SOURCE_SCHEDULED_BUCKET', 'UNSUPPORTED_BUCKET_TIME_BASIS');
  }
  requireInput(samples[0].marketTimeMs<samples[1].marketTimeMs &&
    samples[1].marketTimeMs<samples[2].marketTimeMs, 'UNORDERED_OR_DUPLICATE_BUCKET');
  const qualityInputs=samples.map(sample=>sample.quality??'UNKNOWN');
  if(qualityInputs.some(quality=>!['VERIFIED','RECENT_FETCH','UNVERIFIED_TIME'].includes(quality)))
    return {...empty,status:'UNUSABLE_INPUT_QUALITY',qualityInputs};
  if(samples.some(sample=>sample.value==null))
    return {...empty,status:'MISSING_INPUT',qualityInputs};
  requireInput(samples.every(sample=>Number.isSafeInteger(sample.value)), 'INVALID_FLOW_QUANTITY');
  const deltaShares=[samples[1].value-samples[0].value,samples[2].value-samples[1].value];
  const deltaDifferenceShares=deltaShares[1]-deltaShares[0];
  requireInput([...deltaShares,deltaDifferenceShares].every(Number.isSafeInteger), 'FLOW_ARITHMETIC_OVERFLOW');
  const intervalMinutes=[(samples[1].marketTimeMs-samples[0].marketTimeMs)/60000,
    (samples[2].marketTimeMs-samples[1].marketTimeMs)/60000];
  const averageFlowSharesPerMinute=deltaShares.map((delta,i)=>delta/intervalMinutes[i]);
  const midpointDistanceMinutes=(intervalMinutes[0]+intervalMinutes[1])/2;
  const rateChangeSharesPerMinute=averageFlowSharesPerMinute[1]-averageFlowSharesPerMinute[0];
  const accelerationSharesPerMinuteSquared=rateChangeSharesPerMinute/midpointDistanceMinutes;
  requireInput([...averageFlowSharesPerMinute,rateChangeSharesPerMinute,
    accelerationSharesPerMinuteSquared].every(Number.isFinite), 'FLOW_ARITHMETIC_OVERFLOW');
  return {version:BUCKET_KINEMATICS_VERSION,status:'VALID',inputCutoffMs,
    sourceBucketTimesMs:samples.map(sample=>sample.marketTimeMs),qualityInputs,
    deltaShares,deltaDifferenceShares,intervalMinutes,averageFlowSharesPerMinute,
    midpointDistanceMinutes,rateChangeSharesPerMinute,accelerationSharesPerMinuteSquared,
    timeBasis:'INTERVAL_AVERAGE_RATE_CHANGE_OVER_MIDPOINT_DISTANCE',
    limitation:'ESTIMATED_BUCKET_AVERAGES_NOT_OBSERVED_CONTINUOUS_FLOW'};
}
