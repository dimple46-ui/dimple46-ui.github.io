// PRIVATE pure composition only. Never publish results, log real inputs, or attach a sender/store implicitly.
import {buildPrivateRiskSummary} from './private-risk-summary.mjs';
import {advanceCashRiskEvents} from './cash-risk-events.mjs';
const disconnected=()=>({status:'NOT_REQUESTED',state:null,intents:[],notificationConnection:'NOT_CONNECTED',issues:[]});
const rejected=code=>({status:'BLOCKED',state:null,intents:[],notificationConnection:'NOT_CONNECTED',
 stateHandling:'RETAIN_CALLER_STATE_UNCHANGED',issues:[{code}]});
export function runPrivateRiskWorkflow(inputs,{analysisPolicy,eventPolicy,previousEventState}={}){
 const summary=buildPrivateRiskSummary(inputs,analysisPolicy);
 let events=disconnected();
 if(previousEventState!==undefined){
  if(eventPolicy?.nowMs!==summary.generatedAtMs)events=rejected('MISSING_OR_INCONSISTENT_EVENT_REFERENCE');
  else {
   try{events=advanceCashRiskEvents(previousEventState,summary.components.cashDeadlines,eventPolicy);}
   catch{events=rejected('EVENT_POLICY_OR_PREVIOUS_STATE_REJECTED');}
  }
 }
 return {contractVersion:1,status:'PARTIAL',scope:'PRIVATE_LOCAL_WORKFLOW_ONLY',generatedAtMs:summary.generatedAtMs,
  inputCutoffMs:summary.inputCutoffMs,summary,events,
  capabilities:{...summary.capabilities,localRiskEventState:events.status==='REDUCED'?'AVAILABLE':'UNAVAILABLE',
   notificationDelivery:'UNAVAILABLE'},
  limitations:['FICTIONAL_LOCAL_REPLAY_NOT_ACTUAL_ACCOUNT_VERIFICATION','PARTIAL_NEVER_OVERALL_SAFE_OR_TRADE_DECISION',
   'NO_AUTOMATIC_STATE_RESET_OR_HORIZON_ROLLOVER','NO_PRIVATE_STORAGE_PUBLIC_API_SCHEDULER_SENDER_OR_DELIVERY']};
}
