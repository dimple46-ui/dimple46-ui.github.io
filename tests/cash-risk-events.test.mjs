import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCashDeadlines} from '../domain/cash-deadline-contract.mjs';
import {createCashRiskEventState,advanceCashRiskEvents} from '../domain/cash-risk-events.mjs';
const now=1792132200000,day=86400000,horizon=now+2*day;
const binding={accountRef:'fictional-A',shortfall:{eventId:'fictional-A.shortfall',severity:'CRITICAL'},
 overdue:{eventId:'fictional-A.overdue',severity:'WARNING'}};
const state=()=>createCashRiskEventState({horizonAtMs:horizon,bindings:[binding]});
const policy=t=>({nowMs:t,maxCaptureAgeMs:1000,maxInputAgeMs:1000});
function cash({at=now,withdrawable=1000,deadline=now+day,horizonAtMs=horizon}={}){
 const ledger={schemaVersion:1,currency:'KRW',asOfMs:at,accounts:[{accountRef:'fictional-A',sourceRef:'synthetic',
 verifiedAtMs:at,coverage:{cash:true,obligations:true},cash:{balanceKrw:5000,withdrawableKrw:withdrawable},additionalOutflowsKrw:1500}]};
 const schedule={schemaVersion:1,ledgerAsOfMs:at,accounts:[{accountRef:'fictional-A',coverageComplete:true,obligations:[{
 obligationRef:'fictional-payment',amountKrw:1500,dueAtMs:deadline,status:'OPEN',cashTreatment:'NOT_DEDUCTED_FROM_WITHDRAWABLE',
 sourceRef:'synthetic',verifiedAtMs:at}]}]};
 return evaluateCashDeadlines(ledger,schedule,{nowMs:at,maxLedgerAgeMs:1000,horizonAtMs});
}
test('real pure cash calculator output opens local intent and unchanged later input is deduplicated',()=>{
 const s=state(),c=cash(),before=structuredClone({s,c});const first=advanceCashRiskEvents(s,c,policy(now));
 assert.deepEqual({s,c},before);assert.equal(first.intents.length,1);assert.equal(first.intents[0].transition,'OPENED');
 const later=advanceCashRiskEvents(first.state,cash({at:now+100}),policy(now+100));
 assert.deepEqual(later.intents,[]);assert.equal(later.state.evidence[0].evidenceVersion,1);
 assert.equal(later.notificationConnection,'NOT_CONNECTED');
 assert.equal(later.state.lifecycle.events[0].notification.deliveryStatus,'UNCONFIRMED');
});
test('material gap change, explicit complete resolution and reopening automatically version evidence',()=>{
 const a=advanceCashRiskEvents(state(),cash(),policy(now));
 const b=advanceCashRiskEvents(a.state,cash({at:now+100,withdrawable:500}),policy(now+100));
 assert.equal(b.intents[0].transition,'CHANGED');assert.equal(b.intents[0].evidenceVersion,2);
 const c=advanceCashRiskEvents(b.state,cash({at:now+200,withdrawable:2000}),policy(now+200));
 assert.equal(c.intents[0].transition,'RESOLVED');assert.equal(c.intents[0].evidenceVersion,3);
 const d=advanceCashRiskEvents(c.state,cash({at:now+300}),policy(now+300));
 assert.equal(d.intents[0].transition,'REOPENED');assert.equal(d.intents[0].evidenceVersion,4);
});
test('blocked, incomplete or corrupted cash cannot clear existing risk',()=>{
 const first=advanceCashRiskEvents(state(),cash(),policy(now));
 for(const mutate of [c=>c.status='BLOCKED',c=>c.accounts[0].shortfallKrw=null,c=>c.riskEvents=[],
 c=>c.accounts=[],c=>c.totals.accountShortfallSumKrw=0,c=>c.accounts[0].deadlines[0].cashHeadroomKrw=0]){
  const c=cash({at:now+100});mutate(c);const r=advanceCashRiskEvents(first.state,c,policy(now+100));
  assert.equal(r.status,'DEGRADED');assert.deepEqual(r.state,first.state);assert.deepEqual(r.intents,[]);
 }
});
test('shorter horizon and changed account scope cannot masquerade as resolution',()=>{
 const first=advanceCashRiskEvents(state(),cash(),policy(now));
 const shortened=cash({at:now+100,horizonAtMs:now+1000});
 let r=advanceCashRiskEvents(first.state,shortened,policy(now+100));assert.deepEqual(r.state,first.state);
 const wrong=cash({at:now+100});wrong.accounts[0].accountRef='fictional-other';
 r=advanceCashRiskEvents(first.state,wrong,policy(now+100));assert.deepEqual(r.state,first.state);assert.deepEqual(r.intents,[]);
});
test('fresh wrapper time does not upgrade stale cash cutoff and out-of-order receipt is rejected',()=>{
 const first=advanceCashRiskEvents(state(),cash(),policy(now)),c=cash({at:now+2000,withdrawable:2000});
 c.inputCutoffMs=now;let r=advanceCashRiskEvents(first.state,c,policy(now+2000));
 assert.equal(r.status,'DEGRADED');assert.deepEqual(r.state,first.state);
 r=advanceCashRiskEvents(first.state,cash({at:now-1}),policy(now+100));
 assert.equal(r.status,'BLOCKED');assert.deepEqual(r.state,first.state);
});
test('overdue risk remains independent of cash shortage; empty-risk first snapshot creates no fake resolution',()=>{
 const noGap=cash({withdrawable:2000}),empty=advanceCashRiskEvents(state(),noGap,policy(now));assert.deepEqual(empty.intents,[]);
 const overdue=advanceCashRiskEvents(state(),cash({withdrawable:2000,deadline:now-1}),policy(now));
 assert.equal(overdue.intents.length,1);assert.equal(overdue.intents[0].eventType,'OVERDUE_OPEN_OBLIGATION');
});
test('JSON state reload preserves dedup; missing or mismatched evidence history is not silently reset',()=>{
 const first=advanceCashRiskEvents(state(),cash(),policy(now));const restored=JSON.parse(JSON.stringify(first.state));
 assert.deepEqual(advanceCashRiskEvents(restored,cash(),policy(now)).intents,[]);
 restored.evidence=[];assert.throws(()=>advanceCashRiskEvents(restored,cash(),policy(now)),/INVALID_CASH_EVENT_STATE/);
});
test('duplicate bindings and invalid numerical output are rejected, not converted to zero',()=>{
 assert.throws(()=>createCashRiskEventState({horizonAtMs:horizon,bindings:[binding,binding]}),/INVALID_CASH_EVENT_SCOPE/);
 for(const value of [NaN,Infinity,'500',null]){const c=cash();c.accounts[0].shortfallKrw=value;
  assert.equal(advanceCashRiskEvents(state(),c,policy(now)).status,'DEGRADED');}
});
