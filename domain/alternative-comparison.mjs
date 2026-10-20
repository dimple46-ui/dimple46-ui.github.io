import {evaluateAssetLedger} from './asset-ledger-contract.mjs';
import {evaluateLifeGoalFunding} from './life-goal-funding.mjs';
const TYPES=['ADD_EXISTING','ADD_NEW','KEEP_CASH','REPAY_DEBT'];
const STATES=['SUPPORTIVE','MIXED','ADVERSE','UNASSESSED'];
const money=n=>Number.isSafeInteger(n)&&n>=0;
const text=s=>typeof s==='string'&&s.trim().length>0;
const time=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());

// Input-completeness comparison, not an optimizer. No network, private storage or orders.
export function compareAlternatives(input,{nowMs,maxLedgerAgeMs,maxPriceAgeMs,maxEvidenceAgeMs,reserveKrw}={}) {
 if(input?.schemaVersion!==1||!money(input?.capitalKrw)||input.capitalKrw===0||
   !Number.isSafeInteger(input.horizonDays)||input.horizonDays<=0||!money(maxEvidenceAgeMs))
   throw new Error('INVALID_COMPARISON_CONTEXT');
 const ledger=evaluateAssetLedger(input.ledger,input.prices,{nowMs,maxLedgerAgeMs,maxPriceAgeMs,reserveKrw});
 const goals=input.goalPlan===undefined?null:evaluateLifeGoalFunding(input.ledger,input.schedule,input.goalPlan,{nowMs,maxLedgerAgeMs,reserveKrw});
 const completeGoals=goals?.status==='CALCULATED';
 const protectionShortfall=completeGoals&&goals.accounts.some(a=>a.cashProtectionShortfallKrw>0);
 const comparisonCash=goals===null?ledger.totals.investableCashKrw:completeGoals?goals.totals.unallocatedCashKrw:null;
 const options=Array.isArray(input.alternatives)?input.alternatives:[];
 const issues=[];
 if(options.length!==4||!TYPES.every(type=>options.filter(o=>o?.type===type).length===1))
   issues.push({path:'alternatives',code:'EXACTLY_FOUR_DISTINCT_ALTERNATIVES_REQUIRED'});
 const evidence=new Map();
 for(const e of Array.isArray(input.evidence)?input.evidence:[]){
  if(!text(e?.id)||evidence.has(e.id)||!time(e.verifiedAtMs)||e.verifiedAtMs>nowMs||e.verifiedAtMs>input.ledger?.asOfMs||
    nowMs-e.verifiedAtMs>maxEvidenceAgeMs||e.quality!=='VERIFIED'||!text(e.sourceRef)){
   issues.push({path:'evidence',code:'INVALID_DUPLICATE_STALE_OR_UNVERIFIED_EVIDENCE'});continue;
  }
  evidence.set(e.id,e);
 }
 const linked=refs=>Array.isArray(refs)&&refs.length>0&&refs.every(ref=>typeof ref==='string'&&evidence.has(ref));
 const accounts=Array.isArray(input.ledger?.accounts)?input.ledger.accounts:[];
 const holdings=new Set(accounts.flatMap(a=>(Array.isArray(a?.holdings)?a.holdings:[]).filter(h=>h?.quantity>0).map(h=>h.ticker)));
 const rows=TYPES.map(type=>{
  const o=options.find(x=>x?.type===type),missing=[];
  const requireField=(ok,code)=>{if(!ok)missing.push(code);};
  requireField(!!o,'ALTERNATIVE_REQUIRED');
  const security=type==='ADD_EXISTING'||type==='ADD_NEW';
  if(security){
   requireField(typeof o?.ticker==='string'&&/^\d{6}$/.test(o.ticker),'TICKER_REQUIRED');
   requireField(type==='ADD_EXISTING'?holdings.has(o?.ticker):!holdings.has(o?.ticker),'HOLDING_MEMBERSHIP_MISMATCH');
   requireField(STATES.includes(o?.companyMerit?.state)&&o.companyMerit.state!=='UNASSESSED'&&
     text(o.companyMerit.rationale)&&linked(o.companyMerit.evidenceRefs),'COMPANY_MERIT_EVIDENCE_REQUIRED');
  }
  requireField(STATES.includes(o?.portfolioFit?.state)&&o.portfolioFit.state!=='UNASSESSED'&&
    text(o.portfolioFit.concentrationImpact)&&text(o.portfolioFit.liquidityImpact)&&
    linked(o.portfolioFit.evidenceRefs),'PORTFOLIO_FIT_EVIDENCE_REQUIRED');
  requireField(text(o?.risk?.downside)&&text(o?.risk?.catalyst)&&text(o?.risk?.invalidation)&&
    time(o.risk.expiresAtMs)&&o.risk.expiresAtMs>nowMs&&linked(o.risk.evidenceRefs),'RISK_EXPIRY_EVIDENCE_REQUIRED');
  requireField(linked(o?.fundingEvidenceRefs),'FUNDING_EVIDENCE_REQUIRED');
  const costs=o?.costs;
  requireField(['feesKrw','taxesKrw','interestKrw','prepaymentFeesKrw'].every(k=>money(costs?.[k]))&&
    linked(costs?.evidenceRefs),'EXPLICIT_COSTS_AND_EVIDENCE_REQUIRED');
  const costTotal=missing.includes('EXPLICIT_COSTS_AND_EVIDENCE_REQUIRED')?null:
    costs.feesKrw+costs.taxesKrw+costs.interestKrw+costs.prepaymentFeesKrw;
  requireField(costTotal===null||Number.isSafeInteger(costTotal),'COST_OVERFLOW');
  const required=costTotal===null?null:input.capitalKrw+costTotal;
  requireField(required===null||Number.isSafeInteger(required),'FUNDING_OVERFLOW');
  requireField(ledger.status==='CALCULATED','VERIFIED_LEDGER_AND_EXPLICIT_RESERVE_REQUIRED');
  if(goals!==null){requireField(completeGoals,'COMPLETE_GOAL_FUNDING_CONTEXT_REQUIRED');
   requireField(!protectionShortfall,'EXISTING_PAYMENT_OR_PROTECTED_CASH_SHORTFALL');}
  if(type==='REPAY_DEBT')requireField(ledger.totals.debtPrincipalKrw!==null&&
    input.capitalKrw<=ledger.totals.debtPrincipalKrw,'DEBT_PRINCIPAL_EXCEEDED_OR_UNKNOWN');
  const assessable=missing.length===0&&issues.length===0;
  const gap=assessable?Math.max(0,required-comparisonCash):null;
  // Fixed projection: never echo account IDs, raw balances or arbitrary private fields.
  return {type,ticker:security?o?.ticker??null:null,
    status:!assessable?'BLOCKED':gap>0?'KNOWN_FUNDING_GAP':goals===null?'INPUT_COMPLETE_NOT_RECOMMENDED':'WITHIN_DECLARED_CASH_UPPER_BOUND_NOT_CLEARED',
    capitalKrw:input.capitalKrw,costTotalKrw:assessable?costTotal:null,
    requiredCashKrw:assessable?required:null,fundingGapKrw:gap,
    companyMerit:security&&o?.companyMerit?structuredClone({state:o.companyMerit.state,rationale:o.companyMerit.rationale,
      evidenceRefs:o.companyMerit.evidenceRefs}):{state:'NOT_APPLICABLE'},
    portfolioFit:o?.portfolioFit?structuredClone({state:o.portfolioFit.state,concentrationImpact:o.portfolioFit.concentrationImpact,
      liquidityImpact:o.portfolioFit.liquidityImpact,evidenceRefs:o.portfolioFit.evidenceRefs}):null,
    risk:o?.risk?structuredClone({downside:o.risk.downside,catalyst:o.risk.catalyst,invalidation:o.risk.invalidation,
      expiresAtMs:o.risk.expiresAtMs,evidenceRefs:o.risk.evidenceRefs}):null,
    missing};
 });
 return {contractVersion:1,generatedAtMs:nowMs,inputCutoffMs:input.ledger?.asOfMs??null,
   horizonDays:input.horizonDays,status:issues.length||rows.some(r=>r.status==='BLOCKED')?'PARTIAL':'COMPARISON_ONLY',
   rows,issues,ledgerStatus:ledger.status,recommendation:null,ranking:null,tradeQuantities:null,
   ...(goals===null?{}:{fundingBasis:'GOAL_UNALLOCATED_AGGREGATE_CASH_UPPER_BOUND',fundingGapInterpretation:'MINIMUM_GAP_NOT_ACCOUNT_ROUTED_CLEARANCE',
    goalFunding:{status:goals.status,inputCutoffMs:goals.inputCutoffMs??null,planRevision:completeGoals?goals.totals.planRevision:null,
     requiredKrw:completeGoals?goals.totals.requiredKrw:null,allocatedKrw:completeGoals?goals.totals.allocatedKrw:null,
     shortfallKrw:completeGoals?goals.totals.shortfallKrw:null,unallocatedCashKrw:completeGoals?goals.totals.unallocatedCashKrw:null,
     cashProtectionStatus:!completeGoals?'UNAVAILABLE':protectionShortfall?'SHORTFALL':'DECLARED_PAYMENTS_AND_PROTECTION_COVERED'}}),
   limitations:['FICTIONAL_LOCAL_CONTRACT_NOT_VERIFIED_INVESTMENT_SUITABILITY',
    'COMMON_CAPITAL_AND_HORIZON_WITH_ADDITIONAL_EXPLICIT_COSTS','CASH_FUNDING_ONLY_NO_SALE_OR_NEW_LOAN',
    'DEBT_CHECK_IS_AGGREGATE_NOT_LOAN_ACCOUNT_COLLATERAL_CLEARANCE','NO_RETURN_OR_PROBABILITY_ESTIMATE',
    ...(goals===null?[]:['EXISTING_GOAL_EARMARKS_PRESERVED_NO_FUTURE_GOAL_PROJECTION','GOAL_CASH_UPPER_BOUND_IS_NOT_ACCOUNT_ROUTING_OR_POLICY_APPROVAL'])]};
}
