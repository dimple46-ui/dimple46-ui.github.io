import test from 'node:test';
import assert from 'node:assert/strict';
import {runPrivateRiskWorkflow} from '../domain/private-risk-workflow.mjs';
import {createCashRiskEventState} from '../domain/cash-risk-events.mjs';
const now=1792132200000,day=86400000,horizon=now+2*day;
function fixture(at=now,withdrawable=1000){return {ledger:{schemaVersion:1,currency:'KRW',asOfMs:at,accounts:[{
 accountRef:'fictional-A',sourceRef:'synthetic',verifiedAtMs:at,coverage:{holdings:true,cash:true,debts:true,obligations:true},
 holdings:[{ticker:'005930',quantity:10},{ticker:'000660',quantity:2}],cash:{balanceKrw:5000,withdrawableKrw:withdrawable},
 debts:[{principalKrw:4000}],additionalOutflowsKrw:1500}]},
 prices:Object.fromEntries([['005930',100],['000660',500]].map(([t,priceKrw])=>[t,
 {priceKrw,currency:'KRW',quality:'VERIFIED',sourceRef:'synthetic',observedAtMs:at}])),
 scenario:{schemaVersion:1,id:'fictional-downside',shocksBps:{'005930':-1000,'000660':-1500}},
 schedule:{schemaVersion:1,ledgerAsOfMs:at,accounts:[{accountRef:'fictional-A',coverageComplete:true,obligations:[{
 obligationRef:'fictional-payment',amountKrw:1500,dueAtMs:now+day,status:'OPEN',cashTreatment:'NOT_DEDUCTED_FROM_WITHDRAWABLE',
 sourceRef:'synthetic',verifiedAtMs:at}]}]}};}
const initial=()=>createCashRiskEventState({horizonAtMs:horizon,bindings:[{accountRef:'fictional-A',
 shortfall:{eventId:'fictional-A.shortfall',severity:'CRITICAL'},overdue:{eventId:'fictional-A.overdue',severity:'WARNING'}}]});
const policies=(at=now)=>({analysisPolicy:{nowMs:at,maxLedgerAgeMs:1000,maxPriceAgeMs:1000,horizonAtMs:horizon,
 concentrationDenominator:'DECLARED_GROSS_ASSETS'},eventPolicy:{nowMs:at,maxCaptureAgeMs:1000,maxInputAgeMs:1000}});
test('fictional end-to-end analysis produces separate risk capabilities and one unsent local intent',()=>{
 const f=fixture(),s=initial(),before=structuredClone({f,s});const r=runPrivateRiskWorkflow(f,{...policies(),previousEventState:s});
 assert.deepEqual({f,s},before);assert.deepEqual(r,runPrivateRiskWorkflow(f,{...policies(),previousEventState:s}));
 assert.equal(r.status,'PARTIAL');assert.equal(r.summary.components.valuation.totals.netAssetsKrw,3000);
 assert.equal(r.summary.components.priceStress.totals.scenarioLossKrw,250);
 assert.equal(r.summary.components.concentration.samsungHynixCombined.weightBps,2857);
 assert.equal(r.summary.components.cashDeadlines.totals.accountShortfallSumKrw,500);
 assert.equal(r.events.intents.length,1);assert.equal(r.events.intents[0].transition,'OPENED');
 assert.equal(r.capabilities.localRiskEventState,'AVAILABLE');
 for(const k of ['collateral','tax','tradeDecision','notifications','notificationDelivery'])assert.equal(r.capabilities[k],'UNAVAILABLE');
 assert.ok(!('safe' in r));assert.equal(r.events.notificationConnection,'NOT_CONNECTED');
});
test('stale market quote cannot suppress independently complete cash-risk calculation',()=>{
 const f=fixture();f.prices['005930'].quality='STALE_INPUT';
 const r=runPrivateRiskWorkflow(f,{...policies(),previousEventState:initial()});
 for(const k of ['valuation','priceStress','concentration'])assert.equal(r.capabilities[k],'UNAVAILABLE');
 assert.equal(r.capabilities.cashDeadlines,'AVAILABLE');assert.equal(r.events.intents[0].transition,'OPENED');
});
test('later unchanged fictional snapshot reuses evidence version and emits no duplicate intent',()=>{
 const a=runPrivateRiskWorkflow(fixture(),{...policies(),previousEventState:initial()});
 const restored=JSON.parse(JSON.stringify(a.events.state));
 const b=runPrivateRiskWorkflow(fixture(now+100),{...policies(now+100),previousEventState:restored});
 assert.deepEqual(b.events.intents,[]);assert.equal(b.events.state.evidence[0].evidenceVersion,1);
});
test('missing cash timing preserves known active risk; complete later cash recovery resolves it explicitly',()=>{
 const a=runPrivateRiskWorkflow(fixture(),{...policies(),previousEventState:initial()});
 const f=fixture(now+100);f.schedule.accounts[0].obligations[0].dueAtMs=null;
 const b=runPrivateRiskWorkflow(f,{...policies(now+100),previousEventState:a.events.state});
 assert.equal(b.events.status,'DEGRADED');assert.deepEqual(b.events.state,a.events.state);assert.deepEqual(b.events.intents,[]);
 assert.equal(b.events.state.lifecycle.events[0].status,'ACTIVE');
 const c=runPrivateRiskWorkflow(fixture(now+200,2000),{...policies(now+200),previousEventState:b.events.state});
 assert.equal(c.events.intents[0].transition,'RESOLVED');assert.equal(c.events.state.lifecycle.events[0].resolvedAtMs,now+200);
});
test('event-policy/previous-state errors do not discard valid analysis or fabricate empty risk state',()=>{
 const p=policies(),s=initial(),before=structuredClone(s);p.eventPolicy.nowMs++;
 let r=runPrivateRiskWorkflow(fixture(),{...p,previousEventState:s});
 assert.equal(r.events.status,'BLOCKED');assert.equal(r.events.state,null);assert.equal(r.events.stateHandling,'RETAIN_CALLER_STATE_UNCHANGED');
 assert.deepEqual(s,before);assert.equal(r.capabilities.cashDeadlines,'AVAILABLE');
 r=runPrivateRiskWorkflow(fixture(),{...policies(),previousEventState:{privateError:'PRIVATE_SENTINEL'}});
 assert.equal(r.events.status,'BLOCKED');assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));
 assert.equal(r.summary.components.cashDeadlines.totals.accountShortfallSumKrw,500);
});
test('no supplied event state means not requested, no implicit creation, send or persistence',()=>{
 const r=runPrivateRiskWorkflow(fixture(),policies());assert.equal(r.events.status,'NOT_REQUESTED');
 assert.equal(r.events.state,null);assert.deepEqual(r.events.intents,[]);assert.equal(r.capabilities.localRiskEventState,'UNAVAILABLE');
});
