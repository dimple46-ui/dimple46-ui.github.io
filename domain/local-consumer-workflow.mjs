import {buildPublicConsumerSummary} from '../cloudflare/public-consumer-summary.mjs';
import {compareAlternatives} from './alternative-comparison.mjs';
import {compareCashFundingScenarios} from './cash-funding-scenarios.mjs';
// Compatibility export: private workflow callers keep the existing public function.
export {buildPublicConsumerSummary} from '../cloudflare/public-consumer-summary.mjs';

// This combined return is PRIVATE. Only publicResult may be considered for a future public consumer.
// Private prices are explicitly supplied; market fallback is never promoted into VERIFIED ledger quotes.
export function runLocalConsumerWorkflow(input={},
 {marketPolicy,privatePolicy,enablePrivateEvaluation=false,cashFundingPolicy,enableCashFundingEvaluation=false}={}){
 if(typeof enablePrivateEvaluation!=='boolean'||typeof enableCashFundingEvaluation!=='boolean')throw new Error('INVALID_PRIVATE_OPT_IN');
 const publicResult=buildPublicConsumerSummary(input.marketInputs,marketPolicy);
 let privateResult={status:'DISABLED',data:null};
 if(enablePrivateEvaluation){
  try {privateResult={status:'LOCAL_FICTIONAL_EVALUATION',data:compareAlternatives(input.privateComparison,privatePolicy)};}
  catch {privateResult={status:'BLOCKED',code:'PRIVATE_INPUT_OR_POLICY_INVALID',data:null};}
 }
 let privateCashFundingResult={status:'DISABLED',data:null};
 if(enableCashFundingEvaluation){
  if(cashFundingPolicy?.nowMs!==marketPolicy?.nowMs)privateCashFundingResult={status:'BLOCKED',code:'REFERENCE_TIME_MISMATCH',data:null};
  else try{const data=compareCashFundingScenarios(input.privateCashFunding,cashFundingPolicy);
   privateCashFundingResult={status:data.status==='BLOCKED'?'BLOCKED':'LOCAL_FICTIONAL_EVALUATION',data};
  }catch{privateCashFundingResult={status:'BLOCKED',code:'PRIVATE_INPUT_OR_POLICY_INVALID',data:null};}
 }
 return {classification:'PRIVATE_COMBINED_RESULT_DO_NOT_PUBLISH',publicResult,privateResult,privateCashFundingResult};
}
