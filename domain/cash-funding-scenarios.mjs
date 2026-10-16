// PRIVATE pure scenario comparison. Supplied quantities/costs/timing only; no sizing, optimization or orders.
import {evaluateAssetLedger} from './asset-ledger-contract.mjs';
import {evaluateConcentration} from './concentration-contract.mjs';
import {evaluateAssetStress} from './asset-stress-contract.mjs';
const time=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());
const money=n=>Number.isSafeInteger(n)&&n>=0;
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(s);
const text=s=>typeof s==='string'&&s.trim().length>0&&s.length<=256;
const safe=n=>n<=BigInt(Number.MAX_SAFE_INTEGER)&&n>=BigInt(Number.MIN_SAFE_INTEGER);
const version=1,scope='PRIVATE_DECLARED_CASH_FUNDING_SCENARIOS_ONLY';
const limitations=['EXPLICIT_SCENARIOS_NOT_TRADE_RECOMMENDATIONS','REFERENCE_QUOTES_NOT_EXECUTION_GUARANTEES',
 'DECLARED_SETTLEMENT_TIME_NOT_EXCHANGE_CALENDAR_VERIFICATION','SAME_ACCOUNT_ONLY_NO_CROSS_ACCOUNT_NETTING',
 'TARGET_PAYMENT_NOT_YET_DEDUCTED_FROM_PROJECTED_ASSETS','NO_BORROWING_REPAYMENT_COLLATERAL_TAX_LAW_OR_INTEREST_MODEL',
 'NOT_CONNECTED_TO_PRIVATE_STORAGE_PUBLIC_ENDPOINT_SCHEDULER_OR_ORDERS'];
function assetView(ledger,prices,policy,stressScenario){
 const valuation=evaluateAssetLedger(ledger,prices,policy);
 if(valuation.status==='BLOCKED')return null;
 const concentration=evaluateConcentration(ledger,prices,{...policy,denominator:'DECLARED_GROSS_ASSETS'});
 const gross=valuation.totals.grossAssetsKrw,net=valuation.totals.netAssetsKrw,debt=valuation.totals.debtPrincipalKrw;
 const ratio=d=>d>0?(()=>{const n=BigInt(debt)*10000n/BigInt(d);return safe(n)?Number(n):null;})():null;
 const grossRatio=ratio(gross),netRatio=ratio(net);
 let stress={status:'NOT_REQUESTED',totals:null};
 if(stressScenario!==undefined){const r=evaluateAssetStress(ledger,prices,stressScenario,policy);
  stress={status:r.status,scenarioId:r.scenarioId??null,totals:r.totals};}
 return {valuation:valuation.totals,concentration:{denominator:concentration.denominator,denominatorKrw:concentration.denominatorKrw,
  status:concentration.status,perTicker:concentration.perTicker,samsungHynixCombined:concentration.samsungHynixCombined},
  leverage:{debtToGrossAssetsBps:grossRatio,debtToNetAssetsBps:netRatio,precision:'FLOOR_BASIS_POINTS',
   debtToGrossAssetsStatus:gross<=0?'NON_POSITIVE_DENOMINATOR':grossRatio===null?'ARITHMETIC_RANGE_EXCEEDED':'CALCULATED',
   debtToNetAssetsStatus:net<=0?'NON_POSITIVE_DENOMINATOR':netRatio===null?'ARITHMETIC_RANGE_EXCEEDED':'CALCULATED',
   nonPositiveNetAssets:net<=0,nonPositiveGrossAssets:gross<=0},stress};
}
export function compareCashFundingScenarios(input,policy={}){
 const {nowMs,maxLedgerAgeMs,maxPriceAgeMs,accountReserveKrw}=policy??{};
 const metadata={contractVersion:version,scope,generatedAtMs:time(nowMs)?nowMs:null,
  inputCutoffMs:time(input?.ledger?.asOfMs)&&input.ledger.asOfMs<=nowMs?input.ledger.asOfMs:null,
  currency:'KRW',recommendation:null,ranking:null,automaticOrder:false,limitations:[...limitations]};
 const blocked=code=>({...metadata,status:'BLOCKED',baseline:null,rows:[],issues:[{code}]});
 if(!time(nowMs)||![maxLedgerAgeMs,maxPriceAgeMs,accountReserveKrw].every(money))return blocked('EXPLICIT_VALID_POLICY_REQUIRED');
 if(input?.schemaVersion!==1)return blocked('UNSUPPORTED_SCHEMA');
 const ledgerPolicy={nowMs,maxLedgerAgeMs,maxPriceAgeMs};
 let baseline;
 try{baseline=assetView(input.ledger,input.prices,ledgerPolicy,input.stressScenario);}catch{return blocked('BASE_LEDGER_OR_STRESS_INVALID');}
 if(!baseline)return blocked('BASE_LEDGER_BLOCKED');
 const n=input.need;
 // This need is additional to existing declared outflows, not a duplicated scheduled obligation or internal transfer.
 if(!id(n?.accountRef)||!money(n?.amountKrw)||n.amountKrw===0||!time(n?.dueAtMs)||n.dueAtMs<nowMs||
  n.cashTreatment!=='ADDITIONAL_TO_DECLARED_OUTFLOWS'||n.cashUse!=='OUTFLOW_OUTSIDE_DECLARED_FINANCIAL_SCOPE'||
  !text(n.sourceRef)||!time(n.verifiedAtMs)||n.verifiedAtMs>input.ledger.asOfMs||nowMs-n.verifiedAtMs>maxLedgerAgeMs)
  return blocked('DECLARED_ADDITIONAL_NEED_AND_DEADLINE_REQUIRED');
 const account=input.ledger.accounts.find(a=>a.accountRef===n.accountRef);
 if(!account)return blocked('TARGET_ACCOUNT_NOT_IN_LEDGER');
 if(!Array.isArray(input.plans)||input.plans.length===0||input.plans.length>8)return blocked('BOUNDED_EXPLICIT_PLANS_REQUIRED');
 const ids=new Set();
 for(const plan of input.plans){if(!id(plan?.id)||ids.has(plan.id))return blocked('UNIQUE_PLAN_IDS_REQUIRED');ids.add(plan.id);}
 const required=BigInt(n.amountKrw),reserve=BigInt(accountReserveKrw),outflows=BigInt(account.additionalOutflowsKrw);
 const usable=cash=>{const v=cash-outflows-reserve;return v>0n?v:0n;};
 const gap=cash=>{const v=required-usable(cash);return Number(v>0n?v:0n);};
 const initialCash=BigInt(account.cash.withdrawableKrw);
 const baseLiquidity={requiredCashKrw:n.amountKrw,dueAtMs:n.dueAtMs,accountReserveKrw,
  existingOutflowsReservedKrw:account.additionalOutflowsKrw,usableWithdrawableCashKrw:Number(usable(initialCash)),
  cashShortfallKrw:gap(initialCash)};
 const rows=input.plans.map(plan=>{
  const reject=code=>({id:plan.id,status:'BLOCKED',issues:[{code}],funding:null,projected:null,conditions:null});
  if(!['CASH_ONLY','SECURITY_SALE'].includes(plan.kind))return reject('UNSUPPORTED_FUNDING_METHOD');
  if(!time(plan.expiresAtMs)||plan.expiresAtMs<=nowMs||!text(plan.invalidation)||!text(plan.sourceRef)||
   !time(plan.verifiedAtMs)||plan.verifiedAtMs>input.ledger.asOfMs||nowMs-plan.verifiedAtMs>maxLedgerAgeMs)
   return reject('CURRENT_PLAN_EVIDENCE_EXPIRY_INVALIDATION_REQUIRED');
  if(!money(plan.costs?.feesKrw)||!money(plan.costs?.taxesKrw))return reject('EXPLICIT_FEES_AND_TAXES_REQUIRED');
  if(!Array.isArray(plan.sales)||plan.sales.length>2||
   (plan.kind==='CASH_ONLY'?(plan.sales.length!==0||plan.proceedsAvailableAtMs!==null):
    (plan.sales.length===0||!time(plan.proceedsAvailableAtMs)||plan.proceedsAvailableAtMs<nowMs)))return reject('INVALID_EXPLICIT_SALES_OR_AVAILABILITY');
  const costs=BigInt(plan.costs.feesKrw)+BigInt(plan.costs.taxesKrw),seen=new Set();let gross=0n;
  let projectedLedger;try{projectedLedger=structuredClone(input.ledger);}catch{return reject('UNCLONABLE_LEDGER');}
  const target=projectedLedger.accounts.find(a=>a.accountRef===n.accountRef);
  for(const leg of plan.sales){
   if(!['005930','000660'].includes(leg?.ticker)||seen.has(leg.ticker)||!money(leg.quantity)||leg.quantity===0)
    return reject('INVALID_OR_DUPLICATE_SALE_LEG');
   seen.add(leg.ticker);const held=target.holdings.find(h=>h.ticker===leg.ticker);
   if(!held||leg.quantity>held.quantity)return reject('SALE_EXCEEDS_DECLARED_ACCOUNT_HOLDING');
   gross+=BigInt(leg.quantity)*BigInt(input.prices[leg.ticker].priceKrw);held.quantity-=leg.quantity;
  }
  if(costs>gross||!safe(costs)||!safe(gross))return reject('COSTS_EXCEED_PROCEEDS_OR_OVERFLOW');
  const net=gross-costs,balance=BigInt(target.cash.balanceKrw)+net,withdrawable=initialCash+net;
  if(!safe(balance)||!safe(withdrawable))return reject('ARITHMETIC_OVERFLOW');
  target.cash={balanceKrw:Number(balance),withdrawableKrw:Number(withdrawable)};
  let projected;try{projected=assetView(projectedLedger,input.prices,ledgerPolicy,input.stressScenario);}catch{return reject('PROJECTED_LEDGER_INVALID');}
  if(!projected)return reject('PROJECTED_LEDGER_BLOCKED');
  const timely=plan.kind==='CASH_ONLY'||plan.proceedsAvailableAtMs<=n.dueAtMs;
  const cashAtDeadline=timely?withdrawable:initialCash,shortfall=gap(cashAtDeadline);
  return {id:plan.id,kind:plan.kind,status:shortfall===0?'MODEL_COVERS_DECLARED_NEED':!timely?'MISSES_DEADLINE':'KNOWN_CASH_SHORTFALL',issues:[],
   funding:{grossSaleKrw:Number(gross),feesKrw:plan.costs.feesKrw,taxesKrw:plan.costs.taxesKrw,netSaleKrw:Number(net),
    proceedsAvailableByDeadline:timely,cashAtDeadlineKrw:Number(cashAtDeadline),usableCashAtDeadlineKrw:Number(usable(cashAtDeadline)),
    cashShortfallAtDeadlineKrw:shortfall,cashShortfallAfterAllProceedsKrw:gap(withdrawable)},
   projected:{temporalScope:'AFTER_ALL_DECLARED_PROCEEDS_BEFORE_TARGET_PAYMENT',...projected},
   conditions:{expiresAtMs:plan.expiresAtMs,invalidation:plan.invalidation,holdingsVerification:'DECLARED_INPUTS_NOT_BROKER_VERIFIED',
    execution:'SUPPLIED_QUANTITIES_AND_REFERENCE_QUOTES_ONLY',costTiming:'ALL_DECLARED_COSTS_DEDUCTED_FROM_SALE_PROCEEDS_AT_AVAILABILITY',
    settlement:'EXPLICIT_ASSUMPTION_NOT_VERIFIED_CALENDAR_OR_GUARANTEED_FILL',requiredAction:'REVERIFY_HOLDINGS_QUOTES_COSTS_AND_AVAILABLE_FUNDS_BEFORE_ANY_ACTION'}};
 });
 return {...metadata,status:rows.some(r=>r.status==='BLOCKED')?'PARTIAL':'SCENARIO_COMPARISON_ONLY',
  baseline:{...baseline,liquidity:baseLiquidity},rows,issues:[],capabilities:{sameAccountCashAndSales:'MODELLED',
   newBorrowing:'UNAVAILABLE',debtRepayment:'UNAVAILABLE',paymentDeferral:'UNAVAILABLE',collateralClearance:'UNAVAILABLE',legalMajorShareholderAssessment:'UNAVAILABLE'}};
}
