// Minimal private as-of aggregate contract. No raw ledger/account identifiers, event state or sender payload.
import {fail,timestamp} from './storage-contract.mjs';
import {privateProvenanceView} from './analysis-provenance.mjs';
const capKeys=['valuation','investableCash','priceStress','cashDeadlines','concentration','collateral','tax','tradeDecision','notifications','localRiskEventState','notificationDelivery'];
const unsupported=['collateral','tax','tradeDecision','notifications','notificationDelivery'];
const metricKeys={valuation:['securitiesValueKrw','grossAssetsKrw','debtPrincipalKrw','netAssetsKrw','withdrawableCashKrw','additionalOutflowsKrw','cashHeadroomAfterReserveKrw','investableCashKrw','cashShortfallKrw'],
 priceStress:['baseNetAssetsKrw','stressedSecuritiesValueKrw','stressedGrossAssetsKrw','stressedNetAssetsKrw','netAssetChangeKrw','scenarioLossKrw'],
 cashDeadlines:['dueThroughHorizonKrw','accountShortfallSumKrw','earliestShortfallDueAtMs']};
const signed=new Set(['netAssetsKrw','cashHeadroomAfterReserveKrw','baseNetAssetsKrw','stressedNetAssetsKrw','netAssetChangeKrw']);
const reject=()=>fail('PRIVATE_READ_UNAVAILABLE');
const age=n=>Number.isSafeInteger(n)&&n>=0;
export function privateSavedAnalysisView(value,nowMs){
 const {revision,generatedAtMs,inputCutoffMs,ageLimits,capabilitiesAsOf,metricsAsOf}=value??{};
 if(!Number.isSafeInteger(revision)||revision<1||!timestamp(nowMs)||!timestamp(generatedAtMs)||!timestamp(inputCutoffMs)||
  inputCutoffMs>generatedAtMs||generatedAtMs>nowMs||!age(ageLimits?.maxAnalysisAgeMs)||!age(ageLimits?.maxInputAgeMs)||
  !capabilitiesAsOf||!metricsAsOf)reject();
 const provenance=privateProvenanceView(value.provenance,{revision});
 const caps={};for(const k of capKeys){if(!['AVAILABLE','UNAVAILABLE'].includes(capabilitiesAsOf[k]))reject();caps[k]=capabilitiesAsOf[k];}
 if(unsupported.some(k=>caps[k]!=='UNAVAILABLE')||caps.investableCash==='AVAILABLE'&&caps.valuation!=='AVAILABLE')reject();
 const metrics={};
 for(const[group,keys]of Object.entries(metricKeys)){
  if(caps[group]!=='AVAILABLE'){metrics[group]=null;continue;}
  const source=metricsAsOf[group];if(!source||typeof source!=='object'||Array.isArray(source))reject();const target={};
  for(const key of keys){const n=source[key];
   if(n===null){if(!(group==='valuation'&&['cashHeadroomAfterReserveKrw','investableCashKrw','cashShortfallKrw'].includes(key))&&key!=='earliestShortfallDueAtMs')reject();target[key]=null;continue;}
   if(!Number.isSafeInteger(n)||!signed.has(key)&&n<0||key==='earliestShortfallDueAtMs'&&!timestamp(n))reject();target[key]=n;
  }
  if(group==='priceStress'){
   if(typeof source.scenarioId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(source.scenarioId))reject();target.scenarioId=source.scenarioId;
  }
  if(group==='cashDeadlines'){
   if(!timestamp(source.horizonAtMs)||source.horizonAtMs<generatedAtMs||
    (target.accountShortfallSumKrw>0)!==(target.earliestShortfallDueAtMs!==null)||target.accountShortfallSumKrw>target.dueThroughHorizonKrw)reject();target.horizonAtMs=source.horizonAtMs;
  }
  metrics[group]=target;
 }
 if(caps.investableCash==='AVAILABLE'&&metrics.valuation?.investableCashKrw===null)reject();
 if(Object.hasOwn(capabilitiesAsOf,'goalFunding')){
  const capability=capabilitiesAsOf.goalFunding;if(!['AVAILABLE','UNAVAILABLE'].includes(capability))reject();caps.goalFunding=capability;
  if(caps.investableCash!=='UNAVAILABLE'||metrics.valuation&&metrics.valuation.investableCashKrw!==null)reject();
  if(capability==='AVAILABLE'){
   const g=metricsAsOf.goalFunding,keys=['planRevision','goalCount','requiredKrw','allocatedKrw','shortfallKrw','unallocatedCashKrw','earliestUnfundedDueAtMs'];
   if(!g||keys.some(k=>k==='earliestUnfundedDueAtMs'?g[k]!==null&&!timestamp(g[k]):!Number.isSafeInteger(g[k])||g[k]<0)||
    g.planRevision<1||g.goalCount>64||g.allocatedKrw>g.requiredKrw||g.shortfallKrw!==g.requiredKrw-g.allocatedKrw||
    (g.shortfallKrw>0)!==(g.earliestUnfundedDueAtMs!==null))reject();
   metrics.goalFunding=Object.fromEntries(keys.map(k=>[k,g[k]]));
  }else metrics.goalFunding=null;
 }
 if(caps.concentration==='AVAILABLE'){
  const c=metricsAsOf.concentration;
  if(!['DECLARED_SECURITIES_VALUE','DECLARED_GROSS_ASSETS'].includes(c?.denominator)||!Number.isSafeInteger(c.denominatorKrw)||c.denominatorKrw<=0||
   !Number.isSafeInteger(c.samsungHynixValueKrw)||c.samsungHynixValueKrw<0||c.samsungHynixValueKrw>c.denominatorKrw||
   !Number.isSafeInteger(c.samsungHynixWeightBps)||c.samsungHynixWeightBps<0||c.samsungHynixWeightBps>10000||
   Number(BigInt(c.samsungHynixValueKrw)*10000n/BigInt(c.denominatorKrw))!==c.samsungHynixWeightBps)reject();
  metrics.concentration={denominator:c.denominator,denominatorKrw:c.denominatorKrw,samsungHynixValueKrw:c.samsungHynixValueKrw,
   samsungHynixWeightBps:c.samsungHynixWeightBps,precision:'FLOOR_BASIS_POINTS_NOT_NORMALIZED'};
 }else metrics.concentration=null;
 const analysisAgeMs=nowMs-generatedAtMs,inputAgeMs=nowMs-inputCutoffMs;
 const stale=value?.freshness?.status==='STALE_INPUT'||analysisAgeMs>ageLimits.maxAnalysisAgeMs||inputAgeMs>ageLimits.maxInputAgeMs;
 if(stale){for(const k of Object.keys(caps))caps[k]='UNAVAILABLE';for(const k of Object.keys(metrics))metrics[k]=null;}
 return {contractVersion:1,scope:'PRIVATE_SAVED_RISK_AGGREGATES_ONLY',status:stale?'UNAVAILABLE':'PARTIAL',revision,generatedAtMs,inputCutoffMs,
  temporalScope:'STORED_AS_OF_NOT_REEVALUATED',provenance,freshness:{analysisAgeMs,inputAgeMs,status:stale?'STALE_INPUT':'WITHIN_CONFIGURED_AGE_LIMITS'},
  ageLimits:{maxAnalysisAgeMs:ageLimits.maxAnalysisAgeMs,maxInputAgeMs:ageLimits.maxInputAgeMs},capabilitiesAsOf:caps,metricsAsOf:metrics,
  sourceVerification:'DECLARED_INPUTS_NOT_EXTERNAL_ACCOUNT_VERIFICATION',riskEventState:'RETAINED_NOT_REEVALUATED_OR_RESOLVED',
  featureVersion:null,signalVersion:null,limitations:['NO_CURRENT_CASH_OR_PRICE_RECALCULATION','EXPLICIT_STRESS_IS_NOT_PROBABILITY',
   'NO_RAW_LEDGER_OR_EVENT_STATE_EXPORT','NO_COLLATERAL_TAX_TRADE_OR_DELIVERY_VALIDATION']};
}
export function savedWorkflowView(workflow,head,ageLimits,nowMs,provenance){
 if(workflow?.contractVersion!==1||workflow.status!=='PARTIAL'||workflow.scope!=='PRIVATE_LOCAL_WORKFLOW_ONLY'||
  workflow.generatedAtMs!==head.generatedAtMs||workflow.inputCutoffMs!==head.inputCutoffMs||
  workflow.summary?.contractVersion!==1||workflow.summary.status!=='PARTIAL'||workflow.summary.scope!=='PRIVATE_LOCAL_RISK_SUMMARY_ONLY'||workflow.summary.generatedAtMs!==head.generatedAtMs||workflow.summary.inputCutoffMs!==head.inputCutoffMs)reject();
 const c=workflow.summary.components,metrics={};if(!c)reject();
 for(const name of ['valuation','priceStress','cashDeadlines','concentration']){
  if(workflow.capabilities?.[name]==='AVAILABLE'&&!(name==='valuation'?['CALCULATED','PARTIAL']:['CALCULATED']).includes(c[name]?.status))reject();
 }
 metrics.valuation=c.valuation?.totals;
 metrics.priceStress=c.priceStress?.totals?{...c.priceStress.totals,scenarioId:c.priceStress.scenarioId}:null;
 metrics.cashDeadlines=c.cashDeadlines?.totals?{...c.cashDeadlines.totals,horizonAtMs:c.cashDeadlines.horizonAtMs}:null;
 metrics.concentration=c.concentration?{denominator:c.concentration.denominator,denominatorKrw:c.concentration.denominatorKrw,
  samsungHynixValueKrw:c.concentration.samsungHynixCombined?.valueKrw,samsungHynixWeightBps:c.concentration.samsungHynixCombined?.weightBps}:null;
 if(Object.hasOwn(workflow.capabilities??{},'goalFunding')){
  if(workflow.capabilities.goalFunding==='AVAILABLE'&&(c.goalFunding?.contractVersion!==1||c.goalFunding.scope!=='PRIVATE_LOCAL_GOAL_FUNDING_ONLY'||
   c.goalFunding.currency!=='KRW'||c.goalFunding.status!=='CALCULATED'||c.goalFunding.generatedAtMs!==head.generatedAtMs||
   c.goalFunding.inputCutoffMs!==head.inputCutoffMs))reject();
  metrics.goalFunding=c.goalFunding?.totals??null;
 }
 return privateSavedAnalysisView({revision:head.revision,generatedAtMs:head.generatedAtMs,inputCutoffMs:head.inputCutoffMs,
  ageLimits,provenance,capabilitiesAsOf:workflow.capabilities,metricsAsOf:metrics},nowMs);
}
