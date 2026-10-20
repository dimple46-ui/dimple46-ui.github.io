// PRIVATE declared current-cash earmarks. No optimizer, future income, security sale or orders.
import {evaluateCashDeadlines} from './cash-deadline-contract.mjs';
import {canonicalJson} from '../private/storage-contract.mjs';
const time=n=>Number.isSafeInteger(n)&&n>0&&Number.isFinite(new Date(n).getTime());
const money=n=>Number.isSafeInteger(n)&&n>=0;
const ref=s=>typeof s==='string'&&s.trim().length>0&&s.length<=128;
const shape=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const blank=()=>({planRevision:null,goalCount:null,requiredKrw:null,allocatedKrw:null,shortfallKrw:null,unallocatedCashKrw:null,earliestUnfundedDueAtMs:null});
export function evaluateLifeGoalFunding(ledger,schedule,goalPlan,{nowMs,maxLedgerAgeMs,reserveKrw}={}){
 const blocked=code=>({contractVersion:1,status:'BLOCKED',scope:'PRIVATE_LOCAL_GOAL_FUNDING_ONLY',totals:blank(),goals:[],accounts:[],issues:[{code}]});
 if(!time(nowMs)||!money(maxLedgerAgeMs)||reserveKrw!==undefined&&!money(reserveKrw))return blocked('INVALID_GOAL_POLICY');
 try{({ledger,schedule,goalPlan}=JSON.parse(canonicalJson({ledger,schedule,goalPlan},262144)));}
 catch{return blocked('INVALID_OR_OVERSIZED_GOAL_INPUT');}
 const p=goalPlan;
 if(!shape(p,['schemaVersion','revision','currency','ledgerAsOfMs','sourceRef','verifiedAtMs','coverageComplete','accounts','goals','allocations'])||
  p.schemaVersion!==1||!money(p.revision)||p.revision<1||p.currency!=='KRW'||p.ledgerAsOfMs!==ledger?.asOfMs||
  !ref(p.sourceRef)||!time(p.verifiedAtMs)||p.verifiedAtMs>p.ledgerAsOfMs||nowMs-p.verifiedAtMs>maxLedgerAgeMs||p.coverageComplete!==true||
  !Array.isArray(p.accounts)||p.accounts.length>32||!Array.isArray(p.goals)||p.goals.length>64||
  !Array.isArray(p.allocations)||p.allocations.length>256)return blocked('INVALID_OR_UNVERIFIED_GOAL_PLAN');
 // Protect ALL declared pending obligations, including those after a goal's date. No future funding assumed.
 const dates=(Array.isArray(schedule?.accounts)?schedule.accounts:[]).flatMap(a=>Array.isArray(a?.obligations)?a.obligations.map(o=>o?.dueAtMs):[]);
 const horizonAtMs=Math.max(nowMs,...dates.filter(time));
 let cash;try{cash=evaluateCashDeadlines(ledger,schedule,{nowMs,maxLedgerAgeMs,horizonAtMs});}
 catch{return blocked('COMPLETE_CASH_SCHEDULE_REQUIRED');}
 if(cash.status!=='CALCULATED')return blocked('COMPLETE_CASH_SCHEDULE_REQUIRED');
 const safe=n=>n>=0n&&n<=BigInt(Number.MAX_SAFE_INTEGER);
 const accounts=new Map(),goals=new Map(),obligations=new Map();
 let protectedTotal=0n;
 for(const a of p.accounts){
  if(!shape(a,['accountRef','protectedCashKrw'])||!ref(a.accountRef)||!money(a.protectedCashKrw)||accounts.has(a.accountRef))return blocked('INVALID_GOAL_ACCOUNT_SCOPE');
  const c=cash.accounts.find(x=>x.accountRef===a.accountRef);
  if(!c||a.protectedCashKrw>c.withdrawableKrw)return blocked('INVALID_GOAL_ACCOUNT_SCOPE');
  const free=BigInt(c.withdrawableKrw)-BigInt(c.dueThroughHorizonKrw)-BigInt(a.protectedCashKrw);
  accounts.set(a.accountRef,{accountRef:a.accountRef,protectedCashKrw:a.protectedCashKrw,budget:free>0n?free:0n,protectionShortfall:free<0n,newEarmark:0n});
  protectedTotal+=BigInt(a.protectedCashKrw);
 }
 if(accounts.size!==cash.accounts.length||!safe(protectedTotal)||reserveKrw!==undefined&&protectedTotal!==BigInt(reserveKrw))return blocked('EXPLICIT_ACCOUNT_RESERVE_RECONCILIATION_REQUIRED');
 for(const a of schedule.accounts)for(const o of a.obligations)obligations.set(o.obligationRef,{...o,accountRef:a.accountRef});
 for(const g of p.goals){
  if(!shape(g,['goalRef','revision','purpose','amountKrw','amountAsOfMs','dueAtMs','essential','priority','deferrable'])||
   !ref(g.goalRef)||goals.has(g.goalRef)||!money(g.revision)||g.revision<1||
   !['HOUSING','EDUCATION','RETIREMENT','FAMILY','OTHER'].includes(g.purpose)||
   g.amountKrw!==null&&!money(g.amountKrw)||!time(g.amountAsOfMs)||g.amountAsOfMs>p.ledgerAsOfMs||
   g.dueAtMs!==null&&!time(g.dueAtMs)||g.essential!==null&&typeof g.essential!=='boolean'||
   g.deferrable!==null&&typeof g.deferrable!=='boolean'||g.priority!==null&&!money(g.priority))return blocked('INVALID_GOAL_DEFINITION');
  goals.set(g.goalRef,{...g,allocated:0n});
 }
 const allocations=new Set(),linked=new Set();
 for(const a of p.allocations){
  if(!shape(a,['allocationRef','goalRef','accountRef','amountKrw','obligationRef'])||!ref(a.allocationRef)||
   allocations.has(a.allocationRef)||!money(a.amountKrw)||!goals.has(a.goalRef)||!accounts.has(a.accountRef)||
   a.obligationRef!==null&&!ref(a.obligationRef))return blocked('INVALID_GOAL_ALLOCATION');
  allocations.add(a.allocationRef);const g=goals.get(a.goalRef),account=accounts.get(a.accountRef);
  if(a.obligationRef!==null){
   const o=obligations.get(a.obligationRef);
   if(!o||linked.has(a.obligationRef)||o.accountRef!==a.accountRef||o.amountKrw!==a.amountKrw||
    g.amountKrw!==o.amountKrw||g.dueAtMs!==o.dueAtMs)return blocked('GOAL_OBLIGATION_LINK_MISMATCH');
   linked.add(a.obligationRef);
   // An underfunded obligation cannot acquire funded status merely by being linked to a goal.
   if(account.protectionShortfall)return blocked('LINKED_OBLIGATION_CASH_SHORTFALL');
  }else{
   account.newEarmark+=BigInt(a.amountKrw);
   if(account.newEarmark>account.budget)return blocked('GOAL_ACCOUNT_CASH_OVERALLOCATED');
  }
  g.allocated+=BigInt(a.amountKrw);
  if(!safe(g.allocated)||g.amountKrw!==null&&g.allocated>BigInt(g.amountKrw))return blocked('GOAL_TARGET_OVERALLOCATED');
 }
 let required=0n,allocated=0n,shortfall=0n,remaining=0n,earliest=null,unknown=false;
 const output=[];
 for(const g of goals.values()){
  const known=g.amountKrw!==null&&g.dueAtMs!==null;
  const gap=known?BigInt(g.amountKrw)-g.allocated:null;unknown||=!known;
  if(known){required+=BigInt(g.amountKrw);shortfall+=gap;if(gap>0n)earliest=earliest===null?g.dueAtMs:Math.min(earliest,g.dueAtMs);}
  allocated+=g.allocated;
  output.push({goalRef:g.goalRef,revision:g.revision,purpose:g.purpose,amountAsOfMs:g.amountAsOfMs,requiredKrw:g.amountKrw,
   allocatedKrw:Number(g.allocated),shortfallKrw:gap===null?null:Number(gap),dueAtMs:g.dueAtMs,
   availableAtMs:g.allocated>0n?ledger.asOfMs:null,status:!known?'UNKNOWN':gap===0n?'CURRENT_CASH_EARMARKED':'FUNDING_GAP',
   deadlineStatus:g.dueAtMs===null?'UNKNOWN':g.dueAtMs<nowMs?'OVERDUE_NOT_PROOF_OF_ON_TIME_FUNDING':'NOT_PAST_DUE',
   essential:g.essential,priority:g.priority,deferrable:g.deferrable});
 }
 const accountRows=[...accounts.values()].map(a=>{const free=a.budget-a.newEarmark;remaining+=free;
  return {accountRef:a.accountRef,protectedCashKrw:a.protectedCashKrw,newEarmarkKrw:Number(a.newEarmark),unallocatedCashKrw:Number(free)};});
 if(![required,allocated,shortfall,remaining].every(safe))return blocked('GOAL_ARITHMETIC_OVERFLOW');
 return {contractVersion:1,status:unknown?'PARTIAL':'CALCULATED',scope:'PRIVATE_LOCAL_GOAL_FUNDING_ONLY',currency:'KRW',
  generatedAtMs:nowMs,inputCutoffMs:ledger.asOfMs,totals:{planRevision:p.revision,goalCount:goals.size,requiredKrw:unknown?null:Number(required),
   allocatedKrw:Number(allocated),shortfallKrw:unknown?null:Number(shortfall),unallocatedCashKrw:Number(remaining),earliestUnfundedDueAtMs:unknown?null:earliest},
  goals:output,accounts:accountRows,issues:unknown?[{code:'UNCONFIRMED_GOAL_AMOUNT_OR_DEADLINE'}]:[],
  limitations:['DECLARED_CURRENT_WITHDRAWABLE_CASH_ONLY','ALL_DECLARED_OBLIGATIONS_PROTECTED','NO_CROSS_ACCOUNT_NETTING',
   'NO_FUTURE_INCOME_SECURITY_SALE_NEW_BORROWING_OR_RETURN_ASSUMPTION','NO_INFLATION_ESCALATION_NOMINAL_KRW_INPUT_ONLY',
   'UNALLOCATED_CASH_IS_NOT_INVESTMENT_OR_BROKER_CLEARANCE','PRIORITY_AND_FLEXIBILITY_ARE_NOT_AUTOMATIC_ALLOCATION_RULES',
   'LOCAL_DECLARED_INPUTS_NOT_ACTUAL_ACCOUNT_OR_POLICY_APPROVAL']};
}
