import {buildPublicConsumerSummary} from '../cloudflare/public-consumer-summary.mjs';
import {compareAlternatives} from './alternative-comparison.mjs';
// Compatibility export: private workflow callers keep the existing public function.
export {buildPublicConsumerSummary} from '../cloudflare/public-consumer-summary.mjs';

// This combined return is PRIVATE. Only publicResult may be considered for a future public consumer.
// Private prices are explicitly supplied; market fallback is never promoted into VERIFIED ledger quotes.
export function runLocalConsumerWorkflow({marketInputs,privateComparison}={},
 {marketPolicy,privatePolicy,enablePrivateEvaluation=false}={}){
 if(typeof enablePrivateEvaluation!=='boolean')throw new Error('INVALID_PRIVATE_OPT_IN');
 const publicResult=buildPublicConsumerSummary(marketInputs,marketPolicy);
 let privateResult={status:'DISABLED',data:null};
 if(enablePrivateEvaluation){
  try {privateResult={status:'LOCAL_FICTIONAL_EVALUATION',data:compareAlternatives(privateComparison,privatePolicy)};}
  catch {privateResult={status:'BLOCKED',code:'PRIVATE_INPUT_OR_POLICY_INVALID',data:null};}
 }
 return {classification:'PRIVATE_COMBINED_RESULT_DO_NOT_PUBLISH',publicResult,privateResult};
}
