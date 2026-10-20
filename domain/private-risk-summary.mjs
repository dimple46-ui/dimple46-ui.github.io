// PRIVATE local-only integration. Never connect to the public market response graph.
import {evaluateAssetLedger} from './asset-ledger-contract.mjs';
import {evaluateAssetStress} from './asset-stress-contract.mjs';
import {evaluateCashDeadlines} from './cash-deadline-contract.mjs';
import {evaluateConcentration} from './concentration-contract.mjs';
import {reconcileCollateralToLedger} from './collateral-reconciliation.mjs';
import {evaluateLifeGoalFunding} from './life-goal-funding.mjs';
const time=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());
const blocked=()=>({status:'BLOCKED',issues:[{code:'COMPONENT_INPUT_OR_POLICY_REJECTED'}]});
function safely(evaluate){try{return evaluate();}catch{return blocked();}}
export function buildPrivateRiskSummary({ledger,prices,scenario,schedule,collateralInput,goalPlan}={},
 {nowMs,maxLedgerAgeMs,maxPriceAgeMs,reserveKrw,horizonAtMs,concentrationDenominator,
  maxCollateralInputAgeMs,maxCollateralQuoteAgeMs}={}){
 if(!time(nowMs))throw new Error('INVALID_RISK_SUMMARY_REFERENCE_TIME');
 const ledgerPolicy={nowMs,maxLedgerAgeMs,maxPriceAgeMs,reserveKrw};
 let valuation=safely(()=>evaluateAssetLedger(ledger,prices,ledgerPolicy));
 const goalFunding=goalPlan===undefined?null:safely(()=>evaluateLifeGoalFunding(ledger,schedule,goalPlan,{nowMs,maxLedgerAgeMs,reserveKrw}));
 // The legacy investable-cash formula has no goal earmarks. Never expose it as cleared after opt-in.
 if(goalFunding!==null&&valuation.totals)valuation={...valuation,totals:{...valuation.totals,investableCashKrw:null},
  limitations:[...(valuation.limitations??[]),'GOAL_EARMARKS_NOT_APPLIED_TO_LEGACY_INVESTABLE_CASH']};
 const priceStress=safely(()=>evaluateAssetStress(ledger,prices,scenario,ledgerPolicy));
 const cashDeadlines=safely(()=>evaluateCashDeadlines(ledger,schedule,{nowMs,maxLedgerAgeMs,horizonAtMs}));
 const concentration=concentrationDenominator===undefined?{status:'NOT_REQUESTED',issues:[]}:
  safely(()=>evaluateConcentration(ledger,prices,{...ledgerPolicy,denominator:concentrationDenominator}));
 const collateral=collateralInput===undefined?{status:'NOT_REQUESTED',inputValidationStatus:'NOT_REQUESTED',issues:[]}:
  safely(()=>reconcileCollateralToLedger(ledger,collateralInput,{nowMs,maxLedgerAgeMs,
   maxInputAgeMs:maxCollateralInputAgeMs,maxQuoteAgeMs:maxCollateralQuoteAgeMs}));
 const valued=['CALCULATED','PARTIAL'].includes(valuation.status);
 return {contractVersion:1,status:'PARTIAL',scope:'PRIVATE_LOCAL_RISK_SUMMARY_ONLY',generatedAtMs:nowMs,
  inputCutoffMs:time(ledger?.asOfMs)&&ledger.asOfMs<=nowMs?ledger.asOfMs:null,
  capabilities:{valuation:valued?'AVAILABLE':'UNAVAILABLE',
   investableCash:goalFunding===null&&valuation.status==='CALCULATED'?'AVAILABLE':'UNAVAILABLE',
   priceStress:priceStress.status==='CALCULATED'?'AVAILABLE':'UNAVAILABLE',
   cashDeadlines:cashDeadlines.status==='CALCULATED'?'AVAILABLE':'UNAVAILABLE',
   concentration:concentration.status==='CALCULATED'?'AVAILABLE':'UNAVAILABLE',
   collateral:'UNAVAILABLE',tax:'UNAVAILABLE',tradeDecision:'UNAVAILABLE',notifications:'UNAVAILABLE',
   ...(goalFunding===null?{}:{goalFunding:goalFunding.status==='CALCULATED'?'AVAILABLE':'UNAVAILABLE'})},
  components:{valuation,priceStress,cashDeadlines,concentration,collateral,...(goalFunding===null?{}:{goalFunding})},
  limitations:['DECLARED_INPUTS_NOT_EXTERNAL_ACCOUNT_VERIFICATION','PARTIAL_NEVER_OVERALL_SAFE',
   'PRICE_STRESS_AND_CASH_TIMING_ARE_SEPARATE_MODELS','NO_MARKET_SIGNAL_REQUIRED_FOR_DIRECT_CASH_RISK',
   'NO_PRIVATE_STORAGE_PUBLIC_API_SCHEDULER_OR_NOTIFICATION_CONNECTION']};
}
