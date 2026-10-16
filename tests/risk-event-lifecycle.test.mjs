import test from 'node:test';
import assert from 'node:assert/strict';
import {createRiskEventState,reduceRiskEvents} from '../domain/risk-event-lifecycle.mjs';
const at=1792131600000;
const policy=t=>({nowMs:t+100,maxCaptureAgeMs:1000,maxInputAgeMs:1000});
const event=(patch={})=>({eventId:'fictional-A.cash-shortfall',eventType:'CASH_SHORTFALL_AT_DEADLINE',
 evidenceVersion:1,severity:'CRITICAL',status:'ACTIVE',...patch});
const capture=(t,events=[event()])=>({schemaVersion:1,sourceStatus:'OK',observedAtMs:t,inputCutoffMs:t-1,events});
const run=(state,c,opts=policy(c.observedAtMs??at))=>reduceRiskEvents(state,c,opts);
const opened=()=>run(createRiskEventState(),capture(at));
test('new event creates deterministic local intent, never a sent/delivered/acknowledged alert',()=>{
 const s=createRiskEventState(),c=capture(at),before=structuredClone({s,c}),r=run(s,c);
 assert.deepEqual({s,c},before);assert.deepEqual(r,run(s,c));assert.equal(r.intents.length,1);
 assert.equal(r.intents[0].transition,'OPENED');assert.equal(r.intents[0].requestStatus,'NOT_REQUESTED');
 const n=r.state.events[0].notification;assert.equal(n.connection,'NOT_CONNECTED');
 assert.equal(n.deliveryStatus,'UNCONFIRMED');assert.equal(n.acknowledgementStatus,'UNCONFIRMED');
 assert.equal(n.lastNotifiedAtMs,null);assert.equal(n.lastNotifiedEvidenceVersion,null);
});
test('same evidence replay and later observation emit no duplicate intent or false notification state',()=>{
 const first=opened(),same=run(first.state,capture(at));assert.deepEqual(same.state,first.state);assert.deepEqual(same.intents,[]);
 const later=run(first.state,capture(at+100));assert.deepEqual(later.intents,[]);
 assert.equal(later.state.events[0].lastSeenAtMs,at+100);assert.equal(later.state.events[0].lastChangedAtMs,at);
});
test('changed, resolved and reopened versions preserve first/change/resolve timestamps separately',()=>{
 const first=opened(),changed=run(first.state,capture(at+100,[event({evidenceVersion:2,severity:'WARNING'})]));
 assert.equal(changed.intents[0].transition,'CHANGED');
 const resolved=run(changed.state,capture(at+200,[event({evidenceVersion:3,status:'RESOLVED'})]));
 assert.equal(resolved.intents[0].transition,'RESOLVED');assert.equal(resolved.state.events[0].resolvedAtMs,at+200);
 const archivedUpdate=run(resolved.state,capture(at+250,[event({evidenceVersion:4,status:'RESOLVED'})]));
 assert.equal(archivedUpdate.state.events[0].resolvedAtMs,at+200);
 assert.equal(archivedUpdate.state.events[0].lastChangedAtMs,at+250);
 const reopened=run(resolved.state,capture(at+300,[event({evidenceVersion:4})]));
 assert.equal(reopened.intents[0].transition,'REOPENED');assert.equal(reopened.state.events[0].firstSeenAtMs,at);
 assert.equal(reopened.state.events[0].lastChangedAtMs,at+300);assert.equal(reopened.state.events[0].resolvedAtMs,null);
});
test('failed, omitted, unknown and stale captures never resolve an active risk',()=>{
 const first=opened();
 for(const c of [{schemaVersion:1,sourceStatus:'FAILED'},capture(at+100,[]),
  capture(at+100,[event({status:'UNKNOWN',evidenceVersion:99})])]){
  const r=run(first.state,c);assert.equal(r.status,'DEGRADED');assert.equal(r.state.events[0].status,'ACTIVE');assert.deepEqual(r.intents,[]);
 }
 const stale=run(first.state,capture(at+100),{...policy(at),nowMs:at+2000});
 assert.equal(stale.status,'DEGRADED');assert.deepEqual(stale.state,first.state);
});
test('out-of-order/future cutoffs, duplicate IDs and version conflicts reject atomically',()=>{
 const first=opened();
 for(const c of [capture(at-1),{...capture(at+100),inputCutoffMs:at+101},capture(at+100,[event(),event()]),
 capture(at+100,[event({status:'RESOLVED'})]),capture(at+100,[event({eventType:'OTHER'})]),
 capture(at+100,[event({evidenceVersion:0})]),capture(at+100,[event({eventId:'new-risk',evidenceVersion:1}),event({status:'RESOLVED'})])]){
  const r=run(first.state,c);assert.equal(r.status,'BLOCKED');assert.deepEqual(r.state,first.state);assert.deepEqual(r.intents,[]);
 }
 const future=run(first.state,capture(at+100),{...policy(at),nowMs:at});assert.equal(future.status,'BLOCKED');
});
test('missing fields do not become zero or an explicit resolution',()=>{
 for(const e of [event({severity:null}),event({evidenceVersion:null}),event({status:null}),event({eventId:''})])
  assert.equal(run(createRiskEventState(),capture(at,[e])).status,'BLOCKED');
 assert.equal(run(createRiskEventState(),capture(at,[event({status:'RESOLVED'})])).status,'BLOCKED');
 assert.throws(()=>reduceRiskEvents(createRiskEventState(),capture(at),{nowMs:at,maxCaptureAgeMs:null}),/INVALID_EVENT_POLICY/);
});
test('previous state is validated, transport success cannot be smuggled into disconnected state',()=>{
 const s=opened().state;s.events[0].notification.requestStatus='SUCCEEDED';
 assert.throws(()=>run(s,capture(at+100)),/INVALID_PREVIOUS_EVENT_STATE/);
 assert.throws(()=>run({schemaVersion:1,events:[]},capture(at)),/INVALID_PREVIOUS_EVENT_STATE/);
});
test('bounded capture and state capacity reject without dropping unresolved events',()=>{
 const first=opened();assert.equal(run(first.state,capture(at+100,Array(101).fill(event()))).status,'BLOCKED');
 const s={...first.state,events:Array.from({length:1000},(_,i)=>({...first.state.events[0],eventId:`fictional-${i}`}))};
 const r=run(s,capture(at+100,[event({eventId:'new'})]));assert.equal(r.status,'BLOCKED');assert.equal(r.state.events.length,1000);
 assert.deepEqual(r.intents,[]);
});
test('unknown metadata is never echoed; capture ordering does not affect stored event order',()=>{
 const c=capture(at,[event({eventId:'fictional-B',description:'PRIVATE_SENTINEL'}),event({eventId:'fictional-A'})]);
 const a=run(createRiskEventState(),c);c.events.reverse();const b=run(createRiskEventState(),c);
 assert.deepEqual(a,b);assert.ok(!JSON.stringify(a).includes('PRIVATE_SENTINEL'));
});

test('fresh capture cannot turn stale underlying input into risk resolution',()=>{
 const first=opened(),c={...capture(at+2000,[event({evidenceVersion:2,status:'RESOLVED'})]),inputCutoffMs:at-1};
 const r=run(first.state,c,policy(at+2000));assert.equal(r.status,'DEGRADED');assert.equal(r.issues[0].code,'STALE_INPUT');
 assert.deepEqual(r.state,first.state);assert.deepEqual(r.intents,[]);
});
