// Fictional integration only: memory SQLite and injected auth/crypto doubles, NOT Cloudflare/JWT/AEAD proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {createPrivateInputAdapter} from '../private/input-adapter.mjs';
import {PRIVATE_STORAGE_SCHEMA_V1,createPrivateTransactionStore} from '../private/transaction-store.mjs';
import {createCashRiskEventState} from '../domain/cash-risk-events.mjs';
import {canonicalJson,context} from '../private/storage-contract.mjs';
const now=1792132200000,day=86400000,horizon=now+2*day;
const scope={schemaVersion:1,ownerRef:'fictional-owner',authorizationEpoch:'auth-a',policyEpoch:'policy-a',restoreEpoch:'restore-a'};
function inputs(at=now,withdrawable=1000){return {ledger:{schemaVersion:1,currency:'KRW',asOfMs:at,accounts:[{
 accountRef:'fictional-A',sourceRef:'synthetic',verifiedAtMs:at,coverage:{holdings:true,cash:true,debts:true,obligations:true},
 holdings:[{ticker:'005930',quantity:10},{ticker:'000660',quantity:2}],cash:{balanceKrw:5000,withdrawableKrw:withdrawable},
 debts:[{principalKrw:4000}],additionalOutflowsKrw:1500}]},
 prices:Object.fromEntries([['005930',100],['000660',500]].map(([t,priceKrw])=>[t,
 {priceKrw,currency:'KRW',quality:'VERIFIED',sourceRef:'synthetic',observedAtMs:at}])),
 scenario:{schemaVersion:1,id:'fictional-downside',shocksBps:{'005930':-1000,'000660':-1500}},
 schedule:{schemaVersion:1,ledgerAsOfMs:at,accounts:[{accountRef:'fictional-A',coverageComplete:true,obligations:[{
 obligationRef:'fictional-payment',amountKrw:1500,dueAtMs:now+day,status:'OPEN',cashTreatment:'NOT_DEDUCTED_FROM_WITHDRAWABLE',
 sourceRef:'synthetic',verifiedAtMs:at}]}]}};}
const request=(patch={})=>({schemaVersion:1,requestId:'fictional-request',expectedRevision:0,inputs:inputs(),...patch});
function fixture(overrides={}){
 const db=new DatabaseSync(':memory:');db.exec(PRIVATE_STORAGE_SCHEMA_V1);
 const initial=createCashRiskEventState({horizonAtMs:horizon,bindings:[{accountRef:'fictional-A',
 shortfall:{eventId:'fictional-A.shortfall',severity:'CRITICAL'},overdue:{eventId:'fictional-A.overdue',severity:'WARNING'}}]});
 const sealed=new Map([['fictional-initial',JSON.stringify(initial)]]);let serial=0,storeCalls=0,at=now,fault=null;
 const crypto={async tag(text,ctx){return createHmac('sha256','FICTIONAL_TEST_DOUBLE_NOT_A_RUNTIME_KEY').update(JSON.stringify(ctx)+text).digest('hex');},
 async seal(text,ctx){const marker=`fictional-sealed-${++serial}`;sealed.set(marker,JSON.stringify({text,ctx}));return marker;},
 async open(marker,ctx){if(marker==='fictional-initial')return JSON.parse(sealed.get(marker));
 const item=JSON.parse(sealed.get(marker));assert.deepEqual(item.ctx,ctx);return JSON.parse(item.text);}};
 db.prepare('INSERT INTO private_head VALUES(1,1,?,?,?,?,?,0,0,0,?)').run(scope.ownerRef,scope.authorizationEpoch,scope.policyEpoch,scope.restoreEpoch,'ACTIVE','fictional-initial');
 const sql={exec(query,...args){const stmt=db.prepare(query);let result;
  if(/^SELECT/.test(query))result=stmt.all(...args);else {stmt.run(...args);result=[];}
  if(fault&&query.startsWith(fault)){fault=null;throw new Error('PRIVATE_SENTINEL_SQL_CRASH');}return result;}};
 const store=createPrivateTransactionStore({sql,transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}});
 const deps={authorize:async token=>token==='fictional-valid'?{...scope,roles:['OWNER_WRITE'],verified:true}:null,
 getStore:async owner=>{storeCalls++;assert.equal(owner,scope.ownerRef);return store;},
 getPolicy:async(s,t)=>({analysisPolicy:{nowMs:t,maxLedgerAgeMs:1000,maxPriceAgeMs:1000,horizonAtMs:horizon},eventPolicy:{nowMs:t,maxCaptureAgeMs:1000,maxInputAgeMs:1000}}),
 clock:()=>at,crypto,releaseIdentity:{engineGitSha:'1'.repeat(40),workflowVersion:1},...overrides};
 const adapter=createPrivateInputAdapter(deps);
 return {db,store,crypto,deps,adapter,sealed,close:()=>db.close(),storeCalls:()=>storeCalls,setTime:t=>at=t,setFault:p=>fault=p,
 snapshot:()=>Object.fromEntries(['private_head','private_versions','private_requests','private_outbox'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]))};
}
async function withFixture(fn,overrides){const f=fixture(overrides);try{await fn(f);}finally{f.close();}}
const submit=(f,r=request())=>f.adapter.submit({credential:'fictional-valid',request:r});
function goalInputs(){const i=inputs(now,3000);i.goalPlan={schemaVersion:1,revision:1,currency:'KRW',ledgerAsOfMs:now,sourceRef:'synthetic',verifiedAtMs:now,coverageComplete:true,
 accounts:[{accountRef:'fictional-A',protectedCashKrw:100}],goals:[{goalRef:'fictional-goal',revision:1,purpose:'EDUCATION',amountKrw:1000,
 amountAsOfMs:now,dueAtMs:horizon,essential:true,priority:1,deferrable:false}],
 allocations:[{allocationRef:'fictional-allocation',goalRef:'fictional-goal',accountRef:'fictional-A',amountKrw:700,obligationRef:null}]};return i;}
const latestWorkflow=f=>JSON.parse(JSON.parse(f.sealed.get(f.snapshot().private_versions.at(-1).sealed_analysis)).text).workflow;
const submitNext=(f,i,id)=>submit(f,request({requestId:id,expectedRevision:f.store.readHead().revision,inputs:i}));
test('goal history: same goal revision with changed definition is blocked without poisoning the next valid revision',async()=>withFixture(async f=>{
 const first=goalInputs();assert.equal((await submitNext(f,first,'goal-first')).status,'COMMITTED');const original=f.snapshot().private_versions[0];
 const changed=structuredClone(first);changed.goalPlan.revision=2;changed.goalPlan.goals[0].amountKrw=1100;
 assert.equal((await submitNext(f,changed,'goal-conflict')).status,'COMMITTED');let w=latestWorkflow(f);
 assert.equal(w.summary.components.goalFunding.status,'BLOCKED');assert.equal(w.goalVersionHistory.status,'CONFLICT');
 assert.equal(w.summary.components.cashDeadlines.status,'CALCULATED');assert.equal(w.capabilities.investableCash,'UNAVAILABLE');
 changed.goalPlan.goals[0].revision=2;assert.equal((await submitNext(f,changed,'goal-corrected')).status,'COMMITTED');w=latestWorkflow(f);
 assert.equal(w.goalVersionHistory.planDecision,'ACCEPTED');assert.equal(w.summary.components.goalFunding.status,'CALCULATED');
 assert.equal(w.summary.components.goalFunding.goalRevisionEvidence,'CONTENT_CHECKED_IN_COMPLETE_STORED_LINEAGE');
 assert.deepEqual(f.snapshot().private_versions[0],original);
}));
test('goal history: same plan revision cannot change allocations and old revisions cannot be restored',async()=>withFixture(async f=>{
 const i=goalInputs();await submitNext(f,i,'plan-first');i.goalPlan.allocations[0].amountKrw=600;
 await submitNext(f,i,'plan-conflict');assert.equal(latestWorkflow(f).goalVersionHistory.code,'GOAL_PLAN_REVISION_CONTENT_CONFLICT');
 i.goalPlan.revision=2;await submitNext(f,i,'plan-second');assert.equal(latestWorkflow(f).goalVersionHistory.planDecision,'ACCEPTED');
 await submitNext(f,goalInputs(),'plan-old');assert.equal(latestWorkflow(f).goalVersionHistory.code,'GOAL_PLAN_REVISION_REGRESSION');
}));
test('goal history: explicit deletion retains identity and reappearance requires a newer goal revision',async()=>withFixture(async f=>{
 const i=goalInputs();await submitNext(f,i,'appears');const deleted=structuredClone(i);deleted.goalPlan.revision=2;deleted.goalPlan.goals=[];deleted.goalPlan.allocations=[];
 await submitNext(f,deleted,'deleted');assert.equal(latestWorkflow(f).goalVersionHistory.planDecision,'ACCEPTED');
 i.goalPlan.revision=3;await submitNext(f,i,'old-reappears');assert.equal(latestWorkflow(f).goalVersionHistory.code,'GOAL_REAPPEARANCE_REQUIRES_NEW_REVISION');
 i.goalPlan.goals[0].revision=2;await submitNext(f,i,'new-reappears');assert.equal(latestWorkflow(f).goalVersionHistory.planDecision,'ACCEPTED');
}));
test('goal history: omitted plans do not silently release existing earmarks or clear independent cash risks',async()=>withFixture(async f=>{
 await submitNext(f,goalInputs(),'goal-before-omission');await submitNext(f,inputs(),'omitted');const w=latestWorkflow(f);
 assert.equal(w.goalVersionHistory.code,'EXPLICIT_GOAL_PLAN_REQUIRED');assert.equal(w.capabilities.investableCash,'UNAVAILABLE');
 assert.equal(w.summary.components.valuation.totals.investableCashKrw,null);assert.equal(w.summary.components.cashDeadlines.totals.accountShortfallSumKrw,500);
 assert.equal(w.events.intents[0].transition,'OPENED');
 await submitNext(f,goalInputs(),'goal-after-omission');assert.equal(latestWorkflow(f).goalVersionHistory.planDecision,'ACCEPTED');
}));
test('goal history: array ordering and observation refresh preserve the same material goal version',async()=>withFixture(async f=>{
 const i=goalInputs();i.goalPlan.goals.push({...i.goalPlan.goals[0],goalRef:'fictional-second-goal',amountKrw:0});
 i.goalPlan.allocations[0].amountKrw=600;i.goalPlan.allocations.push({...i.goalPlan.allocations[0],allocationRef:'fictional-second-allocation',amountKrw:100});
 await submitNext(f,i,'ordered');i.goalPlan.goals.reverse();i.goalPlan.allocations.reverse();f.setTime(now+100);
 const fresh=inputs(now+100,3000);Object.assign(i,{ledger:fresh.ledger,prices:fresh.prices,schedule:fresh.schedule});
 i.goalPlan.ledgerAsOfMs=now+100;i.goalPlan.verifiedAtMs=now+100;await submitNext(f,i,'reordered-fresh');
 assert.equal(latestWorkflow(f).goalVersionHistory.planDecision,'ACCEPTED');
}));
test('goal history: missing, mixed-epoch or corrupted input history blocks goals while preserving valid cash',async()=>{
 for(const corrupt of [f=>f.db.exec('DELETE FROM private_versions WHERE revision=1'),f=>f.db.exec("UPDATE private_versions SET policy_epoch='other' WHERE revision=1"),
  f=>f.db.exec("UPDATE private_versions SET sealed_input='PRIVATE_CORRUPT_INPUT' WHERE revision=1")])await withFixture(async f=>{
  await submitNext(f,goalInputs(),'history-first');corrupt(f);await submitNext(f,goalInputs(),'history-after-failure');const w=latestWorkflow(f);
  assert.equal(w.goalVersionHistory.status,'UNAVAILABLE');assert.equal(w.summary.components.goalFunding.status,'BLOCKED');
  assert.equal(w.summary.components.cashDeadlines.status,'CALCULATED');assert.equal(w.capabilities.investableCash,'UNAVAILABLE');
 });
});
test('goal history: missing material input linkage or mismatched saved cutoff cannot produce checked content',async()=>{
 for(const mutate of [e=>e.workflow.generatedAtMs++,e=>e.workflow.summary.inputCutoffMs++,
  e=>e.workflow.summary.components.goalFunding.inputCutoffMs++,e=>e.workflow.goalVersionHistory.historyThroughRevision++,
  e=>e.workflow.goalVersionHistory.planDecision='NOT_REQUESTED'])await withFixture(async f=>{
  await submitNext(f,goalInputs(),'temporal-first');const marker=f.snapshot().private_versions[0].sealed_analysis;
  const sealed=JSON.parse(f.sealed.get(marker)),envelope=JSON.parse(sealed.text);mutate(envelope);sealed.text=JSON.stringify(envelope);f.sealed.set(marker,JSON.stringify(sealed));
  await submitNext(f,goalInputs(),'temporal-second');assert.equal(latestWorkflow(f).goalVersionHistory.status,'UNAVAILABLE');
 });
 await withFixture(async f=>{
  await submitNext(f,goalInputs(),'linked-first');const marker=f.snapshot().private_versions[0].sealed_input;
  const sealed=JSON.parse(f.sealed.get(marker)),input=JSON.parse(sealed.text);input.goalPlan.goals[0].amountKrw++;sealed.text=JSON.stringify(input);f.sealed.set(marker,JSON.stringify(sealed));
  await submitNext(f,goalInputs(),'linked-second');assert.equal(latestWorkflow(f).goalVersionHistory.status,'UNAVAILABLE');
 });
});
test('goal history: legacy declarations are checked without rewriting old rows and ambiguous old collisions remain unavailable',async()=>{
 for(const legacyConflict of [false,true])await withFixture(async f=>{
  await submitNext(f,goalInputs(),'legacy-first');const markers=[f.snapshot().private_versions[0].sealed_analysis];
  if(legacyConflict){const changed=goalInputs();changed.goalPlan.revision=2;changed.goalPlan.goals[0].revision=2;changed.goalPlan.goals[0].amountKrw++;
   await submitNext(f,changed,'legacy-second');markers.push(f.snapshot().private_versions[1].sealed_analysis);
   const inputMarker=f.snapshot().private_versions[1].sealed_input,stored=JSON.parse(f.sealed.get(inputMarker)),input=JSON.parse(stored.text);
   input.goalPlan.goals[0].revision=1;stored.text=JSON.stringify(input);f.sealed.set(inputMarker,JSON.stringify(stored));
   const saved=JSON.parse(f.sealed.get(markers[1])),envelope=JSON.parse(saved.text);envelope.workflow.summary.components.goalFunding.goals[0].revision=1;
   envelope.provenance.inputTag=await f.crypto.tag(canonicalJson({schemaVersion:1,requestId:'legacy-second',expectedRevision:1,inputs:input}),context(scope,'REQUEST_TAG','legacy-second'));
   saved.text=JSON.stringify(envelope);f.sealed.set(markers[1],JSON.stringify(saved));
  }
  for(const marker of markers){const stored=JSON.parse(f.sealed.get(marker)),envelope=JSON.parse(stored.text);delete envelope.workflow.goalVersionHistory;
   envelope.workflow.summary.components.goalFunding.goalRevisionEvidence='CALLER_DECLARED_NOT_CONTENT_BOUND_OR_MONOTONICALLY_VERIFIED';stored.text=JSON.stringify(envelope);f.sealed.set(marker,JSON.stringify(stored));}
  const before=f.snapshot().private_versions;const current=goalInputs();current.goalPlan.revision=3;current.goalPlan.goals[0].revision=3;
  await submitNext(f,current,'legacy-review');assert.equal(latestWorkflow(f).goalVersionHistory.status,legacyConflict?'UNAVAILABLE':'CHECKED');
  assert.deepEqual(f.snapshot().private_versions.slice(0,before.length),before);
 });
});
test('goal history: rejected markers cannot invent a reason or hide a previously accepted plan',async()=>{
 for(const change of [m=>{m.status='CHECKED';m.code='ANYTHING';},m=>{m.status='CHECKED';m.code='GOAL_INPUT_BLOCKED';},
  m=>{m.status='CONFLICT';m.code='GOAL_PLAN_REVISION_REGRESSION';}])await withFixture(async f=>{
  await submitNext(f,goalInputs(),'reject-first');await submitNext(f,inputs(now,3000),'reject-omission');
  const marker=f.snapshot().private_versions[1].sealed_analysis,stored=JSON.parse(f.sealed.get(marker)),envelope=JSON.parse(stored.text);
  change(envelope.workflow.goalVersionHistory);stored.text=JSON.stringify(envelope);f.sealed.set(marker,JSON.stringify(stored));
  await submitNext(f,goalInputs(),'reject-review');assert.equal(latestWorkflow(f).goalVersionHistory.status,'UNAVAILABLE');
 });
});
test('goal history: resource limits are unavailable, never an empty or latest-only history',async()=>withFixture(async f=>{
 const {checkPrivateGoalVersionHistory}=await import('../private/goal-version-history.mjs');
 await submitNext(f,goalInputs(),'bounded-first');const head=f.store.readHead(),args={store:f.store,scope,head,crypto:f.crypto,inputs:goalInputs(),workflow:latestWorkflow(f)};
 assert.equal((await checkPrivateGoalVersionHistory({...args,head:{...head,revision:129}})).code,'GOAL_HISTORY_VERSION_LIMIT');
 const real=f.store.readInputHistoryPage;
 const huge={...f.store,readInputHistoryPage(...a){return {...real(...a),bytes:8388609};}};
 assert.equal((await checkPrivateGoalVersionHistory({...args,store:huge})).code,'GOAL_HISTORY_BYTE_LIMIT');
 await submitNext(f,goalInputs(),'bounded-second');f.db.prepare('UPDATE private_versions SET sealed_input=?,sealed_analysis=?').run('x'.repeat(786000),'y'.repeat(786000));
 const changes=f.db.prepare('SELECT total_changes() AS n').get().n;
 assert.throws(()=>f.store.readInputHistoryPage(scope,f.store.readHead(),0),e=>e.code==='PRIVATE_INPUT_HISTORY_UNAVAILABLE');
 assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,changes);
}));
test('goal history: changed head between pages cannot commit an old preparation or bypass the final revision fence',async()=>withFixture(async f=>{
 for(let i=0;i<5;i++)await submitNext(f,goalInputs(),'page-'+i);
 const before=f.snapshot(),real=f.store.readInputHistoryPage;let pages=0;
 f.store.readInputHistoryPage=(...args)=>{const p=real(...args);pages++;if(pages===1)f.db.exec('UPDATE private_head SET revision=revision+1');return p;};
 const r=await submitNext(f,goalInputs(),'page-race');assert.equal(r.code,'REVISION_CONFLICT');
 assert.deepEqual(f.snapshot().private_versions,before.private_versions);assert.deepEqual(f.snapshot().private_outbox,before.private_outbox);
}));
test('goal history: old authorization context is not guessed, and a reset head cannot hide retained version rows',async()=>withFixture(async f=>{
 await submitNext(f,goalInputs(),'epoch-first');
 for(const kind of ['sealed_input','sealed_analysis']){const marker=f.snapshot().private_versions[0][kind],stored=JSON.parse(f.sealed.get(marker));stored.ctx.authorizationEpoch='old-auth';f.sealed.set(marker,JSON.stringify(stored));}
 await submitNext(f,goalInputs(),'epoch-second');assert.equal(latestWorkflow(f).goalVersionHistory.status,'UNAVAILABLE');
 const head=f.store.readHead();assert.throws(()=>f.store.readInputHistoryPage({...scope,ownerRef:'other-owner'},head,0));
 f.db.exec('UPDATE private_head SET revision=0,generated_at_ms=0,input_cutoff_ms=0');
 assert.throws(()=>f.store.readInputHistoryPage(scope,f.store.readHead(),0),e=>e.code==='PRIVATE_INPUT_HISTORY_UNAVAILABLE');
}));
test('goal history: input cannot supply the trusted history decision',async()=>withFixture(async f=>{
 const i=goalInputs();i.goalVersionHistory={contractVersion:1,status:'CHECKED',planDecision:'ACCEPTED',historyThroughRevision:0,code:null};
 assert.equal((await submitNext(f,i,'forged-history')).status,'REJECTED');assert.equal(f.storeCalls(),0);
}));
test('goal history: authorization expiring during historical decrypt cannot commit prepared cash or goal state',async()=>withFixture(async f=>{
 await submitNext(f,goalInputs(),'expiry-first');const before=f.snapshot(),open=f.crypto.open;
 f.adapter=createPrivateInputAdapter({...f.deps,authorize:async()=>({...scope,verified:true,roles:['OWNER_WRITE'],expiresAtMs:now+100})});
 f.crypto.open=async(...args)=>{const value=await open(...args);if(args[1].kind==='INPUT')f.setTime(now+101);return value;};
 assert.equal((await submitNext(f,goalInputs(),'expiry-next')).code,'UNAUTHORIZED');assert.deepEqual(f.snapshot(),before);
}));
test('goal history: checked saved records cannot drop goal capability and restore legacy investment clearance',async()=>withFixture(async f=>{
 const {savedWorkflowView}=await import('../private/saved-analysis-view.mjs');await submitNext(f,goalInputs(),'checked-view');
 const stored=JSON.parse(f.sealed.get(f.snapshot().private_versions[0].sealed_analysis)),envelope=JSON.parse(stored.text),head=f.store.readHead();
 for(const change of [w=>{delete w.capabilities.goalFunding;w.capabilities.investableCash='AVAILABLE';w.summary.components.valuation.totals.investableCashKrw=1000;},
  w=>w.capabilities.goalFunding='UNAVAILABLE',w=>delete w.summary.capabilities.goalFunding]){
  const w=structuredClone(envelope.workflow);change(w);
  assert.throws(()=>savedWorkflowView(w,head,{maxAnalysisAgeMs:1000,maxInputAgeMs:1000},now,envelope.provenance),e=>e.code==='PRIVATE_READ_UNAVAILABLE');
 }
}));
test('offline adapter: missing/unverified/read-only identities rejected before store resolution',async()=>{
 for(const proof of [null,{...scope,verified:false,roles:['OWNER_WRITE']},{...scope,verified:true,roles:['MACHINE_READ']},{...scope,verified:true,ownerRef:'',roles:['OWNER_WRITE']}])
  await withFixture(async f=>{assert.equal((await submit(f)).code,'UNAUTHORIZED');assert.equal(f.storeCalls(),0);},{authorize:async()=>proof});
});
test('offline adapter: auth exception has no credential/body/exception echo and touches no store',async()=>withFixture(async f=>{
 const r=await submit(f);assert.equal(r.code,'PRIVATE_DEPENDENCY_FAILURE');assert.equal(f.storeCalls(),0);assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));
},{authorize:async()=>{throw new Error('PRIVATE_SENTINEL');}}));
test('offline adapter: body-selected owner/policy, unknown input, nonfinite, cyclic and oversized JSON reject before store',async()=>{
 const cycle={};cycle.self=cycle;
 for(const r of [request({ownerRef:'other'}),request({inputs:{ownerRef:'other'}}),request({inputs:{ledger:{amount:NaN}}}),request({inputs:cycle}),request({inputs:{ledger:{text:'x'.repeat(16385)}}}),request({expectedRevision:-1})])
  await withFixture(async f=>{assert.equal((await submit(f,r)).status,'REJECTED');assert.equal(f.storeCalls(),0);});
});
test('offline adapter: accepted workflow is sealed and input/analysis/state/receipt/outbox commit atomically',async()=>withFixture(async f=>{
 const r=await submit(f);assert.equal(r.status,'COMMITTED');assert.equal(r.revision,1);assert.equal(r.notificationStatus,'PENDING_REVIEW_NOT_SENT');
 const snap=f.snapshot();assert.equal(snap.private_versions.length,1);assert.equal(snap.private_requests.length,1);assert.equal(snap.private_outbox.length,1);
 assert.equal(snap.private_outbox[0].status,'PENDING_REVIEW');assert.ok(!JSON.stringify(snap).includes('fictional-payment'));
 const stored=f.sealed.get(snap.private_versions[0].sealed_analysis);const envelope=JSON.parse(JSON.parse(stored).text),result=envelope.workflow;
 assert.equal(envelope.analysisEnvelopeVersion,2);assert.equal(envelope.provenance.engineGitSha,'1'.repeat(40));
 assert.equal(result.summary.components.cashDeadlines.totals.accountShortfallSumKrw,500);assert.equal(result.capabilities.tax,'UNAVAILABLE');
}));
test('offline adapter: lost response replays original receipt; canonical key order does not duplicate writes',async()=>withFixture(async f=>{
 const a=await submit(f),before=f.snapshot(),original=request();
 const reversed={inputs:original.inputs,expectedRevision:0,requestId:original.requestId,schemaVersion:1};f.setTime(now+100);
 const b=await submit(f,reversed);assert.equal(b.status,'REPLAYED');assert.equal(b.generatedAtMs,a.generatedAtMs);assert.deepEqual(f.snapshot(),before);
}));
test('offline provenance: explicit supported release identity required, never inferred or mutated after construction',async()=>withFixture(async f=>{
 for(const releaseIdentity of [undefined,{engineGitSha:'',workflowVersion:1},{engineGitSha:'0'.repeat(40),workflowVersion:1},
  {engineGitSha:'1'.repeat(40),workflowVersion:2},{engineGitSha:'1'.repeat(40),workflowVersion:1,token:'fictional'}])
  assert.throws(()=>createPrivateInputAdapter({...f.deps,releaseIdentity}),/PRIVATE_RELEASE_IDENTITY_REQUIRED/);
 const releaseIdentity={engineGitSha:'3'.repeat(40),workflowVersion:1};f.adapter=createPrivateInputAdapter({...f.deps,releaseIdentity});
 releaseIdentity.engineGitSha='4'.repeat(40);assert.equal((await submit(f)).status,'COMMITTED');
 const p=JSON.parse(JSON.parse(f.sealed.get(f.snapshot().private_versions[0].sealed_analysis)).text).provenance;
 assert.equal(p.engineGitSha,'3'.repeat(40));assert.equal(p.inputSchemaVersion,1);assert.equal(p.analysisRevision,1);assert.equal(p.previousRevision,0);
 assert.equal(p.policyVersion,scope.policyEpoch);assert.equal(p.restoreEpoch,scope.restoreEpoch);assert.equal(p.generatedAtMs,now);assert.equal(p.inputCutoffMs,now);
 assert.equal(p.inputTag,f.snapshot().private_requests[0].payload_tag);assert.match(p.policyTag,/^[0-9a-f]{64}$/);
}));
test('offline provenance: recorded policy is detached/frozen before asynchronous tagging and is the policy actually applied',async()=>withFixture(async f=>{
 const policy=await f.deps.getPolicy(scope,now),tag=f.crypto.tag;policy.analysisPolicy.reserveKrw=300;
 f.crypto.tag=async(text,ctx)=>{if(ctx.recordId.startsWith('policy:')){policy.analysisPolicy.reserveKrw=999999;policy.eventPolicy.maxInputAgeMs=0;}return tag(text,ctx);};
 f.adapter=createPrivateInputAdapter({...f.deps,getPolicy:async()=>policy});assert.equal((await submit(f)).status,'COMMITTED');
 const saved=JSON.parse(JSON.parse(f.sealed.get(f.snapshot().private_versions[0].sealed_analysis)).text);
 assert.equal(saved.policySnapshot.analysisPolicy.reserveKrw,300);assert.equal(saved.policySnapshot.eventPolicy.maxInputAgeMs,1000);
 assert.equal(saved.workflow.summary.components.valuation.totals.cashHeadroomAfterReserveKrw,-800);
}));
test('offline provenance: replay under a later configured release preserves original policy/version and performs no reseal',async()=>withFixture(async f=>{
 const first=await submit(f),before=f.snapshot(),sealCount=f.sealed.size;
 f.adapter=createPrivateInputAdapter({...f.deps,releaseIdentity:{engineGitSha:'5'.repeat(40),workflowVersion:1},getPolicy:async()=>{throw Error('must not run for replay');}});
 f.setTime(now+100);const replay=await submit(f);assert.equal(replay.status,'REPLAYED');assert.equal(replay.generatedAtMs,first.generatedAtMs);
 assert.deepEqual(f.snapshot(),before);assert.equal(f.sealed.size,sealCount);
}));
test('offline provenance: invalid/unknown server policy fails before sealing or accepted-state mutation',async()=>withFixture(async f=>{
 for(const change of [p=>p.analysisPolicy.nowMs++,p=>p.eventPolicy.maxInputAgeMs=-1,p=>p.analysisPolicy.reserveKrw=null,
  p=>p.analysisPolicy.unknown=true,p=>p.eventPolicy.unknown=true,p=>p.analysisPolicy.concentrationDenominator='UNKNOWN']){
  const p=await f.deps.getPolicy(scope,now);change(p);const before=f.snapshot(),sealed=f.sealed.size;
  const adapter=createPrivateInputAdapter({...f.deps,getPolicy:async()=>p});
  assert.equal((await adapter.submit({credential:'fictional-valid',request:request()})).code,'INVALID_SERVER_POLICY');
  assert.deepEqual(f.snapshot(),before);assert.equal(f.sealed.size,sealed);
 }
}));
test('offline adapter: changed payload for same request conflicts without overwrite',async()=>withFixture(async f=>{
 await submit(f);const before=f.snapshot();const r=await submit(f,request({inputs:inputs(now,2000)}));
 assert.equal(r.code,'IDEMPOTENCY_CONFLICT');assert.deepEqual(f.snapshot(),before);
}));
test('offline adapter: stale expected revision is not retried',async()=>withFixture(async f=>{
 await submit(f);const before=f.snapshot();const r=await submit(f,request({requestId:'fictional-other'}));
 assert.equal(r.code,'REVISION_CONFLICT');assert.deepEqual(f.snapshot(),before);
}));
test('offline adapter: stale cash, future cutoff and expired horizon preserve accepted active risk',async()=>withFixture(async f=>{
 await submit(f);const before=f.snapshot();
 for(const [at,input] of [[now+2000,inputs()],[now+100,inputs(now+1000)],[horizon+1,inputs(horizon+1)]]){
  f.setTime(at);assert.equal((await submit(f,request({requestId:'fictional-invalid',expectedRevision:1,inputs:input}))).code,'WORKFLOW_NOT_COMMITTABLE');assert.deepEqual(f.snapshot(),before);
 }
}));
test('offline adapter: stale market quote keeps independent cash risk and is not promoted to verified',async()=>withFixture(async f=>{
 const i=inputs();i.prices['005930'].quality='STALE_INPUT';const r=await submit(f,request({inputs:i}));assert.equal(r.status,'COMMITTED');
 const record=f.snapshot().private_versions[0],analysis=JSON.parse(JSON.parse(f.sealed.get(record.sealed_analysis)).text).workflow;
 assert.equal(analysis.capabilities.valuation,'UNAVAILABLE');assert.equal(analysis.capabilities.cashDeadlines,'AVAILABLE');assert.equal(analysis.events.intents[0].transition,'OPENED');
}));
test('offline adapter: explicit maintenance freeze/missing head/schema mismatch prevent implicit initialization',async()=>{
 for(const sql of ["UPDATE private_head SET mode='MAINTENANCE_FROZEN'",'DELETE FROM private_head','UPDATE private_head SET schema_version=2'])await withFixture(async f=>{
  f.db.exec(sql);const before=f.snapshot();assert.equal((await submit(f)).code,'STORE_FROZEN_OR_SCOPE_MISMATCH');assert.deepEqual(f.snapshot(),before);
 });
});
test('offline adapter: crypto/open/seal errors never commit or expose exception details',async()=>{
 for(const name of ['tag','open','seal'])await withFixture(async f=>{
  f.deps.crypto[name]=async()=>{throw new Error('PRIVATE_SENTINEL');};const before=f.snapshot(),r=await submit(f);
  assert.equal(r.code,'PRIVATE_DEPENDENCY_FAILURE');assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));assert.deepEqual(f.snapshot(),before);
 });
});
test('offline adapter: oversized sealed payload is rejected before transaction',async()=>withFixture(async f=>{
 f.deps.crypto.seal=async()=> 'x'.repeat(786433);const before=f.snapshot();assert.equal((await submit(f)).code,'INVALID_CRYPTO_RESULT');assert.deepEqual(f.snapshot(),before);
}));
test('offline adapter: write failures after each table mutation roll back all accepted records',async()=>{
 for(const query of ['INSERT INTO private_versions','UPDATE private_head','INSERT INTO private_outbox','INSERT INTO private_requests'])await withFixture(async f=>{
  f.setFault(query);const before=f.snapshot(),r=await submit(f);assert.equal(r.code,'PRIVATE_DEPENDENCY_FAILURE');assert.deepEqual(f.snapshot(),before);
 });
});
test('offline adapter: async competing preparations commit one revision with no lost update',async()=>withFixture(async f=>{
 const pending=[];const tag=f.crypto.tag;f.crypto.tag=async(...args)=>{const value=await tag(...args);
  if(!args[1].recordId.startsWith('policy:'))await new Promise(resolve=>{pending.push(resolve);if(pending.length===2)pending.forEach(x=>x());});return value;};
 const results=await Promise.all([submit(f),submit(f,request({requestId:'fictional-concurrent'}))]);
 assert.deepEqual(results.map(x=>x.status).sort(),['COMMITTED','REJECTED']);assert.ok(results.some(x=>x.code==='REVISION_CONFLICT'));
 assert.equal(f.snapshot().private_versions.length,1);assert.equal(f.snapshot().private_outbox.length,1);
}));
test('offline adapter: auth/policy/restore epoch changes during encryption fence the old preparation',async()=>{
 for(const column of ['authorization_epoch','policy_epoch','restore_epoch'])await withFixture(async f=>{
  const seal=f.crypto.seal;let once=false;f.crypto.seal=async(...args)=>{if(!once){once=true;f.db.exec(`UPDATE private_head SET ${column}='new-epoch'`);}return seal(...args);};
  const r=await submit(f);assert.equal(r.code,'STORE_FROZEN_OR_SCOPE_MISMATCH');const snap=f.snapshot();
  assert.equal(snap.private_head[0].revision,0);assert.equal(snap.private_versions.length,0);assert.equal(snap.private_outbox.length,0);
 });
});
test('offline adapter: mismapped actor is rejected rather than accepting body or auth owner as a DB authority',async()=>withFixture(async f=>{
 f.db.exec("UPDATE private_head SET owner_ref='fictional-other-owner'");assert.equal((await submit(f)).code,'STORE_FROZEN_OR_SCOPE_MISMATCH');assert.equal(f.snapshot().private_versions.length,0);
}));
test('offline adapter: next unchanged capture advances revision without duplicating an intent; recovery remains explicit',async()=>withFixture(async f=>{
 await submit(f);f.setTime(now+100);
 const b=await submit(f,request({requestId:'fictional-second',expectedRevision:1,inputs:inputs(now+100)}));
 assert.equal(b.status,'COMMITTED');assert.equal(b.revision,2);assert.equal(f.snapshot().private_outbox.length,1);
 f.setTime(now+200);const c=await submit(f,request({requestId:'fictional-recovery',expectedRevision:2,inputs:inputs(now+200,2000)}));
 assert.equal(c.status,'COMMITTED');assert.equal(c.revision,3);assert.equal(f.snapshot().private_outbox.length,2);
 const saved=f.sealed.get(f.snapshot().private_versions[2].sealed_analysis),analysis=JSON.parse(JSON.parse(saved).text).workflow;
 assert.equal(analysis.events.intents[0].transition,'RESOLVED');assert.equal(analysis.events.notificationConnection,'NOT_CONNECTED');
}));
test('offline adapter: authorization expiring during async sealing cannot commit',async()=>withFixture(async f=>{
 f.deps.authorize=async()=>({...scope,roles:['OWNER_WRITE'],verified:true,expiresAtMs:now+100});
 // Factory captures functions, so construct a fresh adapter with the deliberately expiring verifier.
 f.adapter=createPrivateInputAdapter(f.deps);const seal=f.crypto.seal;
 f.crypto.seal=async(...args)=>{f.setTime(now+101);return seal(...args);};
 const before=f.snapshot();assert.equal((await submit(f)).code,'UNAUTHORIZED');assert.deepEqual(f.snapshot(),before);
}));
test('offline end-to-end: real signature, AEAD and memory SQLite preserve sealed state/replay and reject tampering',async()=>withFixture(async f=>{
 const {createPrivateEnvelopeCrypto}=await import('../private/envelope-crypto.mjs');
 const {createPinnedAccessAuthorizer}=await import('../private/access-identity.mjs');
 const {canonicalJson,context}=await import('../private/storage-contract.mjs');
 const wc=globalThis.crypto;
 const key=await wc.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const tagKey=await wc.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const pair=await wc.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
 const {PRIVATE_NONCE_SCHEMA_V1,createPrivateNonceAllocator}=await import('../private/nonce-ledger.mjs');
 f.db.exec(PRIVATE_NONCE_SCHEMA_V1);
 f.db.prepare('INSERT INTO private_nonce_keys VALUES(?,?,?,?,?,?,?,?)').run('fictional-v1',1,'fictional-authority-a','01020304',scope.restoreEpoch,0,100,'ACTIVE');
 const allocateNonce=createPrivateNonceAllocator({sql:{exec(query,...args){const s=f.db.prepare(query);if(/^SELECT/.test(query))return s.all(...args);s.run(...args);return [];}},
 transactionSync(fn){f.db.exec('BEGIN IMMEDIATE');try{const r=fn();f.db.exec('COMMIT');return r;}catch(e){f.db.exec('ROLLBACK');throw e;}},
 readHead:f.store.readHead,scope,keyBindings:[{version:'fictional-v1',keyAuthorityRef:'fictional-authority-a',noncePrefixHex:'01020304'}]});
 const nonceCounter=()=>f.db.prepare('SELECT last_counter FROM private_nonce_keys').get().last_counter;
 const crypto=createPrivateEnvelopeCrypto({encryptionKeys:[{version:'fictional-v1',key}],activeVersion:'fictional-v1',tagKey,allocateNonce});
 const initial=JSON.parse(f.sealed.get('fictional-initial'));
 f.db.prepare('UPDATE private_head SET sealed_state=?').run(await crypto.seal(canonicalJson(initial),context(scope,'EVENT_STATE','0')));
 const issuer='https://fictional-team.cloudflareaccess.com',audience='fictional-aud';
 const authorize=createPinnedAccessAuthorizer({issuer,audience,publicKeys:[{kid:'fictional-kid',key:pair.publicKey}],
 identities:[{...scope,kind:'USER',subject:'fictional-user',roles:['OWNER_WRITE']}],clock:()=>now,maxTokenAgeSeconds:300,maxLifetimeSeconds:3600});
 const b64=x=>Buffer.from(x).toString('base64url'),sec=now/1000;
 const signing=b64(JSON.stringify({alg:'RS256',kid:'fictional-kid'}))+'.'+b64(JSON.stringify({iss:issuer,aud:[audience],type:'app',sub:'fictional-user',iat:sec-1,exp:sec+100}));
 const token='Bearer '+signing+'.'+b64(await wc.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(signing)));
 const adapter=createPrivateInputAdapter({...f.deps,authorize,crypto});
 const r=await adapter.submit({credential:token,request:request()});assert.equal(r.status,'COMMITTED');
 const saved=f.snapshot();assert.ok(!JSON.stringify(saved).includes('fictional-payment'));
 assert.equal((await adapter.submit({credential:token,request:request()})).status,'REPLAYED');assert.deepEqual(f.snapshot(),saved);
 const analysis=(await crypto.open(saved.private_versions[0].sealed_analysis,context(scope,'ANALYSIS','1'))).workflow;
 assert.equal(analysis.summary.components.cashDeadlines.totals.accountShortfallSumKrw,500);assert.equal(analysis.events.intents.length,1);
 assert.equal(nonceCounter(),5);const committed=f.snapshot(),beforeNonce=nonceCounter();
 f.setFault('INSERT INTO private_requests');const second=request({requestId:'fictional-next',expectedRevision:1});
 assert.equal((await adapter.submit({credential:token,request:second})).status,'REJECTED');assert.deepEqual(f.snapshot(),committed);
 assert.ok(nonceCounter()>beforeNonce);const failedCounter=nonceCounter();
 assert.equal((await adapter.submit({credential:token,request:second})).status,'COMMITTED');assert.ok(nonceCounter()>failedCounter);
 const goalRequest=request({requestId:'fictional-real-crypto-goal',expectedRevision:2,inputs:goalInputs()});
 assert.equal((await adapter.submit({credential:token,request:goalRequest})).status,'COMMITTED');
 const goalEnvelope=await crypto.open(f.snapshot().private_versions[2].sealed_analysis,context(scope,'ANALYSIS','3'));
 assert.equal(goalEnvelope.workflow.goalVersionHistory.planDecision,'ACCEPTED');
 assert.equal(goalEnvelope.workflow.summary.components.goalFunding.goalRevisionEvidence,'CONTENT_CHECKED_IN_COMPLETE_STORED_LINEAGE');
 const conflict=structuredClone(goalRequest);conflict.requestId='fictional-real-crypto-conflict';conflict.expectedRevision=3;
 conflict.inputs.goalPlan.revision=2;conflict.inputs.goalPlan.goals[0].amountKrw++;
 assert.equal((await adapter.submit({credential:token,request:conflict})).status,'COMMITTED');
 const conflictEnvelope=await crypto.open(f.snapshot().private_versions[3].sealed_analysis,context(scope,'ANALYSIS','4'));
 assert.equal(conflictEnvelope.workflow.goalVersionHistory.status,'CONFLICT');assert.equal(conflictEnvelope.workflow.capabilities.cashDeadlines,'AVAILABLE');
 f.db.exec("UPDATE private_head SET sealed_state='tampered'");const corrupted=f.snapshot();
 assert.equal((await adapter.submit({credential:token,request:request({requestId:'fictional-new',expectedRevision:4})})).status,'REJECTED');assert.deepEqual(f.snapshot(),corrupted);
}));
test('offline adapter: corrupted receipt cannot become a replay success or clear accepted state',async()=>withFixture(async f=>{
 await submit(f);f.db.exec('UPDATE private_requests SET revision=100');const before=f.snapshot();
 assert.equal((await submit(f)).code,'STORE_FROZEN_OR_SCOPE_MISMATCH');assert.deepEqual(f.snapshot(),before);
}));
test('offline adapter: older input cutoff is rejected by the existing workflow before replacing accepted state',async()=>withFixture(async f=>{
 await submit(f);f.setTime(now+100);const before=f.snapshot();
 const r=await submit(f,request({requestId:'fictional-older-input',expectedRevision:1,inputs:inputs(now-100)}));
 assert.equal(r.code,'WORKFLOW_NOT_COMMITTABLE');assert.deepEqual(f.snapshot(),before);
}));
test('offline HTTP to SQLite: duplicate accepted JSON is one durable input/outbox; unauthorized/owner override cannot dispatch',async()=>withFixture(async f=>{
 const {createPrivateHttpBoundary}=await import('../private/http-boundary.mjs');
 const proof={...scope,roles:['OWNER_READ','OWNER_WRITE'],verified:true,expiresAtMs:now+1000};
 const authorize=async token=>token==='Bearer fictional-http'?proof:null;
 const inputAdapter=createPrivateInputAdapter({...f.deps,authorize});
 const handle=createPrivateHttpBoundary({origin:'https://fictional-private.invalid',authorize,inputAdapter,clock:()=>now,
 checkRateLimit:async()=>({allowed:true}),statusReader:async()=>{const h=f.store.readHead();return {schemaVersion:1,mode:h.mode,
 revision:h.revision,generatedAtMs:h.revision===0?null:h.generatedAtMs,inputCutoffMs:h.revision===0?null:h.inputCutoffMs};}});
 const post=(value,token='Bearer fictional-http')=>new Request('https://fictional-private.invalid/private/inputs',{
 method:'POST',headers:{authorization:token,'content-type':'application/json'},body:JSON.stringify(value)});
 assert.equal((await handle(post(request(),'wrong'))).status,401);assert.equal(f.storeCalls(),0);
 assert.equal((await handle(post({...request(),ownerRef:'other'}))).status,400);assert.equal(f.storeCalls(),0);
 const first=await handle(post(request()));assert.equal((await first.json()).status,'COMMITTED');
 const again=await handle(post(request()));assert.equal((await again.json()).status,'REPLAYED');
 assert.equal(f.snapshot().private_versions.length,1);assert.equal(f.snapshot().private_outbox.length,1);
 const status=await handle(new Request('https://fictional-private.invalid/private/status',{headers:{authorization:'Bearer fictional-http'}}));
 assert.equal(status.status,200);assert.equal((await status.json()).status.revision,1);
}));
test('offline saved analysis HTTP to SQLite: fixed snapshot reads preserve rows, ages, unavailable features and private aggregate scope',async()=>withFixture(async f=>{
 const {createPrivateReadAdapter}=await import('../private/read-adapter.mjs');
 const {createPrivateHttpBoundary}=await import('../private/http-boundary.mjs');
 const proof={...scope,verified:true,roles:['OWNER_READ','OWNER_WRITE'],expiresAtMs:now+60000};
 const authorize=async token=>token==='Bearer fictional-read'?proof:null;
 const reader=createPrivateReadAdapter({authorize,getStore:f.deps.getStore,crypto:f.crypto,clock:f.deps.clock,maxAnalysisAgeMs:1000,maxInputAgeMs:1000});
 const handle=createPrivateHttpBoundary({origin:'https://fictional-private.invalid',authorize,inputAdapter:f.adapter,clock:f.deps.clock,
 checkRateLimit:async()=>({allowed:true}),statusReader:reader.readStatus,analysisReader:reader.readAnalysis});
 const req=()=>new Request('https://fictional-private.invalid/private/analysis/latest',{headers:{authorization:'Bearer fictional-read'}});
 const absent=await handle(req());assert.equal(absent.status,404);assert.equal((await absent.json()).error,'ANALYSIS_NOT_AVAILABLE');
 await submit(f);const saved=f.snapshot(),changes=f.db.prepare('SELECT total_changes() AS n').get().n;
 const response=await handle(req()),data=await response.json();assert.equal(response.status,200);
 assert.equal(data.metricsAsOf.cashDeadlines.accountShortfallSumKrw,500);assert.equal(data.metricsAsOf.valuation.netAssetsKrw,3000);
 assert.equal(data.metricsAsOf.valuation.investableCashKrw,null);assert.equal(data.featureVersion,null);assert.equal(data.signalVersion,null);
 assert.ok(!JSON.stringify(data).includes('fictional-A'));assert.ok(!('events'in data));assert.ok(!('accounts'in data));
 assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,changes);assert.deepEqual(f.snapshot(),saved);
 f.setTime(now+2000);const stale=await handle(req()),view=await stale.json();assert.equal(stale.status,200);assert.equal(view.status,'UNAVAILABLE');
 assert.equal(view.freshness.status,'STALE_INPUT');assert.equal(view.metricsAsOf.cashDeadlines,null);assert.equal(view.riskEventState,'RETAINED_NOT_REEVALUATED_OR_RESOLVED');
 assert.deepEqual(f.snapshot(),saved);assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,changes);
 const row=f.db.prepare('SELECT sealed_analysis FROM private_versions WHERE revision=1').get();
 f.db.prepare('UPDATE private_versions SET generated_at_ms=generated_at_ms+1 WHERE revision=1').run();
 assert.throws(()=>f.store.readAnalysisSnapshot(scope),/PRIVATE_READ_UNAVAILABLE/);assert.ok(row.sealed_analysis);
}));
test('offline goal input to saved HTTP: exact replay, reconstructed reader and stale suppression preserve the sealed revision',async()=>withFixture(async f=>{
 const {createPrivateReadAdapter}=await import('../private/read-adapter.mjs');
 const {createPrivateHttpBoundary}=await import('../private/http-boundary.mjs');
 const i=inputs(now,3000);i.goalPlan={schemaVersion:1,revision:1,currency:'KRW',ledgerAsOfMs:now,sourceRef:'synthetic',verifiedAtMs:now,coverageComplete:true,
  accounts:[{accountRef:'fictional-A',protectedCashKrw:100}],goals:[{goalRef:'fictional-private-goal',revision:1,purpose:'EDUCATION',amountKrw:1000,
   amountAsOfMs:now,dueAtMs:horizon,essential:true,priority:1,deferrable:false}],
  allocations:[{allocationRef:'fictional-private-allocation',goalRef:'fictional-private-goal',accountRef:'fictional-A',amountKrw:700,obligationRef:null}]};
 const r=request({inputs:i});assert.equal((await submit(f,r)).status,'COMMITTED');const saved=f.snapshot();
 assert.equal((await submit(f,r)).status,'REPLAYED');assert.deepEqual(f.snapshot(),saved);
 const changed=structuredClone(r);changed.inputs.goalPlan.allocations[0].amountKrw++;
 assert.equal((await submit(f,changed)).code,'IDEMPOTENCY_CONFLICT');assert.deepEqual(f.snapshot(),saved);
 const authorize=async token=>token==='Bearer fictional-read'?{...scope,verified:true,roles:['OWNER_READ'],expiresAtMs:now+60000}:null;
 const read=()=>{
  const reader=createPrivateReadAdapter({authorize,getStore:f.deps.getStore,crypto:f.crypto,clock:f.deps.clock,maxAnalysisAgeMs:1000,maxInputAgeMs:1000});
  const handle=createPrivateHttpBoundary({origin:'https://fictional-private.invalid',authorize,inputAdapter:f.adapter,clock:f.deps.clock,
   checkRateLimit:async()=>({allowed:true}),statusReader:reader.readStatus,analysisReader:reader.readAnalysis});
  return handle(new Request('https://fictional-private.invalid/private/analysis/latest',{headers:{authorization:'Bearer fictional-read'}}));
 };
 const changes=f.db.prepare('SELECT total_changes() AS n').get().n,response=await read(),view=await response.json();
 assert.equal(response.status,200);assert.equal(view.capabilitiesAsOf.goalFunding,'AVAILABLE');
 assert.equal(view.goalRevisionEvidence,'CONTENT_CHECKED_IN_COMPLETE_STORED_LINEAGE');assert.equal(view.goalHistoryThroughRevision,0);
 assert.deepEqual(view.metricsAsOf.goalFunding,{planRevision:1,goalCount:1,requiredKrw:1000,allocatedKrw:700,shortfallKrw:300,
  unallocatedCashKrw:700,earliestUnfundedDueAtMs:horizon});
 assert.equal(view.metricsAsOf.valuation.investableCashKrw,null);
 assert.ok(!['fictional-A','fictional-private-goal','fictional-private-allocation'].some(x=>JSON.stringify(view).includes(x)));
 assert.deepEqual(await (await read()).json(),view);
 f.setTime(now+1001);const stale=await (await read()).json();assert.equal(stale.capabilitiesAsOf.goalFunding,'UNAVAILABLE');assert.equal(stale.metricsAsOf.goalFunding,null);
 assert.deepEqual(f.snapshot(),saved);assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,changes);
}));
