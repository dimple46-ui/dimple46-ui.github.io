import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {validateStockFlowSnapshot} from './validate-stock-flow-snapshot.mjs';
import {generateStockFlowSignalsV3} from '../cloudflare/signal-v3-stock-flow.mjs';

const requireValue=(condition,code)=>{if(!condition) throw new Error(code);};
// Saved public-input replay only: no network or database operations.
export function validateStockFlowV3Replay(snapshot,{engineGitSha}={}) {
  const cutoff=Date.parse(snapshot?.relayUpdatedAt);
  const audit=validateStockFlowSnapshot(snapshot,{asOfMs:cutoff});
  requireValue(audit.status==='PASS','INSUFFICIENT_BUCKET_HISTORY');
  const samples={};
  for(const stock of ['samsung','skHynix']) {
    samples[stock]={};
    for(const [flow,field] of [['foreignFlow','foreignNetBuyQty'],['institutionFlow','institutionNetBuyQty']]) {
      samples[stock][flow]=snapshot.stockFlowEstimates[stock].rows.slice(-3).map(row=>({
        value:row[field],
        marketTimeMs:Date.parse(`${snapshot.koreaDate.slice(0,4)}-${snapshot.koreaDate.slice(4,6)}-${snapshot.koreaDate.slice(6,8)}T${row.inputTimeKst}:00+09:00`),
        availableAtMs:cutoff,quality:'UNVERIFIED_TIME',timeBasis:'SOURCE_SCHEDULED_BUCKET'
      }));
    }
  }
  const options={enabled:true,featureVersion:2,inputCutoffMs:cutoff,generatedAtMs:cutoff,engineGitSha};
  const original=JSON.stringify(snapshot);
  const result=generateStockFlowSignalsV3(samples,options);
  requireValue(JSON.stringify(result)===JSON.stringify(generateStockFlowSignalsV3(samples,options)), 'NON_DETERMINISTIC_SIGNAL_OUTPUT');
  requireValue(JSON.stringify(snapshot)===original,'INPUT_MUTATED');
  for(const signal of result.signals) {
    requireValue(signal.signal_version===3 && signal.feature_version===2 && signal.engine_git_sha===engineGitSha,'SIGNAL_IDENTITY_MISMATCH');
    requireValue(signal.input_cutoff===new Date(cutoff).toISOString(),'SIGNAL_CUTOFF_MISMATCH');
    requireValue(signal.confidence.level==='MEDIUM' && signal.confidence.ceiling==='MEDIUM' && signal.data_quality.ceiling==='UNVERIFIED_TIME','QUALITY_CEILING_VIOLATION');
    requireValue(signal.supporting_evidence.every(e=>Number.isFinite(e.value)),'NONFINITE_SIGNAL_EVIDENCE');
    requireValue(signal.source_bucket_times_ms.every(t=>t<=cutoff),'FUTURE_DATA_LEAKAGE');
    requireValue(!('action' in signal) && !('probability' in signal) && signal.state==='ACTIVE','NON_DESCRIPTIVE_SIGNAL');
  }
  return {status:result.diagnostics.length?'PARTIAL':'PASS',validationType:'SAVED_PUBLIC_INPUT_LOCAL_REPLAY',
    engineGitSha,signalVersion:3,featureVersion:2,inputCutoff:snapshot.relayUpdatedAt,
    availabilityBasis:'ALL_ROWS_AVAILABLE_BY_CAPTURE_ONLY_NOT_HISTORICAL_FIRST_ARRIVAL',
    pipelineStatus:audit.pipelineStatus,sourceErrors:audit.sourceErrors,
    checks:{deterministic:true,finiteEvidence:true,qualityCeiling:true,pastOnly:true},
    databaseValidation:'NOT_PERFORMED',deploymentValidation:'NOT_PERFORMED',
    signals:result.signals,diagnostics:result.diagnostics};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const result=validateStockFlowV3Replay(JSON.parse(await readFile(process.argv[2],'utf8')),{engineGitSha:process.argv[3]});
    console.log(JSON.stringify(result,null,2));
    if(result.status!=='PASS') process.exitCode=1;
  } catch(error) {
    console.error(JSON.stringify({status:'FAIL',code:/^[A-Z_]+$/.test(error.message)?error.message:'INVALID_REPLAY_INPUT'}));
    process.exitCode=1;
  }
}
