import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPrivateRiskSummary} from '../domain/private-risk-summary.mjs';
import {runPrivateRiskWorkflow} from '../domain/private-risk-workflow.mjs';
import {savedWorkflowView,privateSavedAnalysisView} from '../private/saved-analysis-view.mjs';
import {createCashRiskEventState} from '../domain/cash-risk-events.mjs';

// Fictional current-cash goals only; no actual account or investment policy.
const now=1792458000000,day=86400000;
const policy={nowMs:now,maxLedgerAgeMs:1000,maxPriceAgeMs:1000,horizonAtMs:now+2*day,reserveKrw:100};
function fixture(){return {ledger:{schemaVersion:1,currency:'KRW',asOfMs:now,accounts:[{
 accountRef:'PRIVATE_ACCOUNT_SENTINEL',sourceRef:'fictional',verifiedAtMs:now,
 coverage:{cash:true,obligations:true,holdings:true,debts:true},holdings:[],debts:[],
 cash:{balanceKrw:5000,withdrawableKrw:1000},additionalOutflowsKrw:200}]},prices:{},
 schedule:{schemaVersion:1,ledgerAsOfMs:now,accounts:[{accountRef:'PRIVATE_ACCOUNT_SENTINEL',coverageComplete:true,
 obligations:[{obligationRef:'PRIVATE_OBLIGATION',amountKrw:200,dueAtMs:now+day,status:'OPEN',
 cashTreatment:'NOT_DEDUCTED_FROM_WITHDRAWABLE',sourceRef:'fictional',verifiedAtMs:now}]}]},
 goalPlan:{schemaVersion:1,revision:1,currency:'KRW',ledgerAsOfMs:now,sourceRef:'fictional',verifiedAtMs:now,coverageComplete:true,
 accounts:[{accountRef:'PRIVATE_ACCOUNT_SENTINEL',protectedCashKrw:100}],
 goals:[{goalRef:'PRIVATE_GOAL_A',revision:1,purpose:'EDUCATION',amountKrw:400,amountAsOfMs:now,dueAtMs:now+2*day,essential:true,priority:1,deferrable:false},
 {goalRef:'PRIVATE_GOAL_B',revision:1,purpose:'FAMILY',amountKrw:200,amountAsOfMs:now,dueAtMs:now+day,essential:true,priority:2,deferrable:false}],
 allocations:[{allocationRef:'fictional-a',goalRef:'PRIVATE_GOAL_A',accountRef:'PRIVATE_ACCOUNT_SENTINEL',amountKrw:300,obligationRef:null},
 {allocationRef:'fictional-b',goalRef:'PRIVATE_GOAL_B',accountRef:'PRIVATE_ACCOUNT_SENTINEL',amountKrw:200,obligationRef:'PRIVATE_OBLIGATION'}]}};}
const evaluate=(f=fixture(),p=policy)=>buildPrivateRiskSummary(f,p);
const provenance={engineGitSha:'1'.repeat(40),workflowVersion:1,inputSchemaVersion:1,analysisEnvelopeVersion:2,
 analysisRevision:1,previousRevision:0,policyVersion:'fictional-policy',policyTag:'2'.repeat(64)};
test('explicit current cash earmarks protect obligations/reserve and link an existing payment once',()=>{
 const f=fixture(),before=structuredClone(f),r=evaluate(f),g=r.components.goalFunding;
 assert.equal(g.status,'CALCULATED');assert.equal(r.capabilities.goalFunding,'AVAILABLE');
 assert.equal(g.goalRevisionEvidence,'CALLER_DECLARED_NOT_CONTENT_BOUND_OR_MONOTONICALLY_VERIFIED');
 assert.deepEqual(g.totals,{planRevision:1,goalCount:2,requiredKrw:600,allocatedKrw:500,shortfallKrw:100,unallocatedCashKrw:400,earliestUnfundedDueAtMs:now+2*day});
 assert.equal(g.goals[0].availableAtMs,now);assert.equal(g.goals[0].shortfallKrw,100);
 assert.equal(g.goals[1].shortfallKrw,0);assert.equal(g.accounts[0].newEarmarkKrw,300);
 assert.equal(r.components.cashDeadlines.totals.dueThroughHorizonKrw,200);
 assert.equal(r.capabilities.investableCash,'UNAVAILABLE');assert.equal(r.components.valuation.totals.investableCashKrw,null);
 assert.deepEqual(f,before);assert.deepEqual(r,evaluate(f));
});
test('same cash cannot be allocated twice even with different allocation IDs',()=>{
 const f=fixture();f.goalPlan.goals[0].amountKrw=900;f.goalPlan.allocations[0].amountKrw=700;
 f.goalPlan.allocations.push({...f.goalPlan.allocations[0],allocationRef:'different-id',amountKrw:1});
 assert.equal(evaluate(f).components.goalFunding.status,'BLOCKED');
});
test('balance and another account surplus cannot fund a constrained account',()=>{
 const f=fixture();f.goalPlan.allocations[0].amountKrw=701;f.goalPlan.goals[0].amountKrw=900;
 assert.equal(evaluate(f).components.goalFunding.status,'BLOCKED');
 const b=structuredClone(f.ledger.accounts[0]);b.accountRef='fictional-B';b.cash.withdrawableKrw=5000;b.additionalOutflowsKrw=0;
 f.ledger.accounts.push(b);f.schedule.accounts.push({accountRef:b.accountRef,coverageComplete:true,obligations:[]});
 f.goalPlan.accounts.push({accountRef:b.accountRef,protectedCashKrw:0});
 assert.equal(evaluate(f).components.goalFunding.status,'BLOCKED');
});
test('existing obligation link must match account amount and deadline and is globally unique',()=>{
 for(const mutate of [f=>f.goalPlan.goals[1].amountKrw++,f=>f.goalPlan.goals[1].dueAtMs++,
 f=>f.goalPlan.allocations[1].amountKrw--,f=>f.goalPlan.allocations[1].obligationRef='unknown',
 f=>f.goalPlan.allocations.push({...f.goalPlan.allocations[1],allocationRef:'different'})]){
  const f=fixture();mutate(f);assert.equal(evaluate(f).components.goalFunding.status,'BLOCKED');
 }
});
test('unknown goal amount or date stays null and cannot become complete funding',()=>{
 for(const field of ['amountKrw','dueAtMs']){
  const f=fixture();f.goalPlan.goals[0][field]=null;
  const r=evaluate(f);assert.equal(r.components.goalFunding.status,'PARTIAL');
  assert.equal(r.components.goalFunding.goals[0].shortfallKrw,null);
  assert.equal(r.components.goalFunding.totals.shortfallKrw,null);assert.equal(r.capabilities.goalFunding,'UNAVAILABLE');
  assert.equal(r.capabilities.cashDeadlines,'AVAILABLE');
 }
});
test('stale/mismatched plan metadata and ambiguous reserve or scope reject goals only',()=>{
 for(const mutate of [f=>f.goalPlan.ledgerAsOfMs++,f=>f.goalPlan.verifiedAtMs-=1001,f=>f.goalPlan.verifiedAtMs++,
 f=>f.goalPlan.accounts[0].protectedCashKrw++,f=>f.goalPlan.goals[0].revision=0,
 f=>f.goalPlan.accounts=[],f=>f.goalPlan.coverageComplete=false,f=>f.goalPlan.currency='USD']){
  const f=fixture();mutate(f);const r=evaluate(f);assert.equal(r.components.goalFunding.status,'BLOCKED');
  assert.equal(r.capabilities.cashDeadlines,'AVAILABLE');assert.equal(r.components.cashDeadlines.totals.dueThroughHorizonKrw,200);
 }
});
test('goal failure preserves an independently active cash shortage and unsent event',()=>{
 const f=fixture();f.ledger.accounts[0].cash.withdrawableKrw=100;f.goalPlan.goals[0].amountKrw=-1;
 const state=createCashRiskEventState({horizonAtMs:policy.horizonAtMs,bindings:[{accountRef:'PRIVATE_ACCOUNT_SENTINEL',
 shortfall:{eventId:'fictional.shortfall',severity:'CRITICAL'},overdue:{eventId:'fictional.overdue',severity:'WARNING'}}]});
 const r=runPrivateRiskWorkflow(f,{analysisPolicy:policy,previousEventState:state,eventPolicy:{nowMs:now,maxCaptureAgeMs:1000,maxInputAgeMs:1000}});
 assert.equal(r.summary.components.goalFunding.status,'BLOCKED');assert.equal(r.summary.components.cashDeadlines.totals.accountShortfallSumKrw,100);
 assert.equal(r.events.intents[0].transition,'OPENED');assert.equal(r.capabilities.notificationDelivery,'UNAVAILABLE');
});
test('linked payment cannot consume protected cash even when the payment alone is covered',()=>{
 const f=fixture();f.ledger.accounts[0].additionalOutflowsKrw=950;f.schedule.accounts[0].obligations[0].amountKrw=950;
 f.goalPlan.goals[1].amountKrw=950;f.goalPlan.allocations=[{...f.goalPlan.allocations[1],amountKrw:950}];
 const r=evaluate(f);assert.equal(r.components.goalFunding.status,'BLOCKED');
 assert.equal(r.components.cashDeadlines.totals.accountShortfallSumKrw,0);
});
test('unsafe aggregate goal amounts reject without changing the independent cash calculation',()=>{
 const f=fixture();f.goalPlan.allocations=[];for(const g of f.goalPlan.goals)g.amountKrw=Number.MAX_SAFE_INTEGER;
 const r=evaluate(f);assert.equal(r.components.goalFunding.status,'BLOCKED');
 assert.equal(r.components.goalFunding.totals.requiredKrw,null);assert.equal(r.capabilities.cashDeadlines,'AVAILABLE');
});
test('saved workflow exposes goal aggregates and suppresses stale values without account/goal IDs',()=>{
 const w=runPrivateRiskWorkflow(fixture(),{analysisPolicy:policy}),head={revision:1,generatedAtMs:now,inputCutoffMs:now};
 const r=savedWorkflowView(w,head,{maxAnalysisAgeMs:1000,maxInputAgeMs:1000},now,provenance);
 assert.equal(r.metricsAsOf.goalFunding.shortfallKrw,100);assert.equal(r.capabilitiesAsOf.goalFunding,'AVAILABLE');
 assert.equal(r.goalRevisionEvidence,'CALLER_DECLARED_NOT_CONTENT_BOUND_OR_MONOTONICALLY_VERIFIED');
 assert.ok(!['PRIVATE_ACCOUNT_SENTINEL','PRIVATE_GOAL','PRIVATE_OBLIGATION'].some(x=>JSON.stringify(r).includes(x)));assert.equal(r.metricsAsOf.valuation.investableCashKrw,null);
 const restored=JSON.parse(JSON.stringify(w));
 assert.deepEqual(savedWorkflowView(restored,head,r.ageLimits,now,provenance),r);
 const old=savedWorkflowView(restored,head,r.ageLimits,now+1001,provenance);
 assert.equal(old.metricsAsOf.goalFunding,null);assert.equal(old.capabilitiesAsOf.goalFunding,'UNAVAILABLE');
});
test('saved goal aggregates reject inconsistent investment clearance, unsupported versions and malformed totals',()=>{
 const head={revision:1,generatedAtMs:now,inputCutoffMs:now},limits={maxAnalysisAgeMs:1000,maxInputAgeMs:1000};
 const read=w=>savedWorkflowView(w,head,limits,now,provenance);
 for(const change of [w=>w.summary.components.goalFunding.contractVersion=2,w=>w.summary.components.goalFunding.currency='USD',
  w=>w.summary.components.goalFunding.scope='PUBLIC',w=>w.summary.components.goalFunding.totals.shortfallKrw++,
  w=>w.summary.components.goalFunding.totals.earliestUnfundedDueAtMs=null,
  w=>{w.capabilities.goalFunding='UNAVAILABLE';w.capabilities.investableCash='AVAILABLE';w.summary.components.valuation.totals.investableCashKrw=700;},
  w=>{w.capabilities.goalFunding='UNAVAILABLE';w.summary.components.valuation.totals.investableCashKrw=700;}]){
  const w=runPrivateRiskWorkflow(fixture(),{analysisPolicy:policy});change(w);
  assert.throws(()=>read(w),e=>e.code==='PRIVATE_READ_UNAVAILABLE');
 }
 const r=read(runPrivateRiskWorkflow(fixture(),{analysisPolicy:policy}));
 r.capabilitiesAsOf.goalFunding='UNAVAILABLE';r.capabilitiesAsOf.investableCash='AVAILABLE';r.metricsAsOf.valuation.investableCashKrw=700;
 assert.throws(()=>privateSavedAnalysisView(r,now),e=>e.code==='PRIVATE_READ_UNAVAILABLE');
});
