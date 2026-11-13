// Fictional saved-result fixtures; no actual credentials/store/user assets/provider read.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {canonicalJson,context} from '../private/storage-contract.mjs';
import {createPrivateReadAdapter} from '../private/read-adapter.mjs';
import {privateSavedAnalysisView} from '../private/saved-analysis-view.mjs';
import {createPrivateHttpBoundary} from '../private/http-boundary.mjs';
const now=1792132200000,scope={schemaVersion:1,ownerRef:'fictional-owner',authorizationEpoch:'auth-a',policyEpoch:'policy-a',restoreEpoch:'restore-a'};
const head=()=>({...scope,mode:'ACTIVE',revision:1,generatedAtMs:now-100,inputCutoffMs:now-800,sealedState:'fictional-sealed'});
function workflow(){return {contractVersion:1,status:'PARTIAL',scope:'PRIVATE_LOCAL_WORKFLOW_ONLY',generatedAtMs:now-100,inputCutoffMs:now-800,
 capabilities:{valuation:'AVAILABLE',investableCash:'UNAVAILABLE',priceStress:'AVAILABLE',cashDeadlines:'AVAILABLE',concentration:'AVAILABLE',
 collateral:'UNAVAILABLE',tax:'UNAVAILABLE',tradeDecision:'UNAVAILABLE',notifications:'UNAVAILABLE',localRiskEventState:'AVAILABLE',notificationDelivery:'UNAVAILABLE'},
 summary:{contractVersion:1,status:'PARTIAL',scope:'PRIVATE_LOCAL_RISK_SUMMARY_ONLY',generatedAtMs:now-100,inputCutoffMs:now-800,components:{
 valuation:{status:'PARTIAL',totals:{securitiesValueKrw:2000,grossAssetsKrw:7000,debtPrincipalKrw:4000,netAssetsKrw:3000,withdrawableCashKrw:1000,
 additionalOutflowsKrw:1500,cashHeadroomAfterReserveKrw:null,investableCashKrw:null,cashShortfallKrw:null}},
 priceStress:{status:'CALCULATED',scenarioId:'fictional-downside',totals:{baseNetAssetsKrw:3000,stressedSecuritiesValueKrw:1750,stressedGrossAssetsKrw:6750,
 stressedNetAssetsKrw:2750,netAssetChangeKrw:-250,scenarioLossKrw:250}},
 cashDeadlines:{status:'CALCULATED',horizonAtMs:now+86400000,accounts:[{accountRef:'PRIVATE_ACCOUNT_SENTINEL'}],totals:{dueThroughHorizonKrw:1500,
 accountShortfallSumKrw:500,earliestShortfallDueAtMs:now+1000}},
 concentration:{status:'CALCULATED',denominator:'DECLARED_GROSS_ASSETS',denominatorKrw:7000,samsungHynixCombined:{valueKrw:2000,weightBps:2857}}
 }},events:{state:{privateSecret:'PRIVATE_SENTINEL'},intents:[{privateSecret:'PRIVATE_SENTINEL'}]},privateSecret:'PRIVATE_SENTINEL'};}
function fixture(extra={}){let h=head(),w=workflow(),proof={...scope,verified:true,roles:['OWNER_READ'],expiresAtMs:now+60000},reads=0,stores=0;
 const policySnapshot={analysisPolicy:{nowMs:h.generatedAtMs,maxLedgerAgeMs:1000,maxPriceAgeMs:1000,horizonAtMs:now+86400000},
 eventPolicy:{nowMs:h.generatedAtMs,maxCaptureAgeMs:1000,maxInputAgeMs:1000}};
 const tag=(text,ctx)=>createHmac('sha256','FICTIONAL_POLICY_TEST_DOUBLE').update(JSON.stringify(ctx)+text).digest('hex');
 const policyTag=tag(canonicalJson({purpose:'PRIVATE_POLICY_SNAPSHOT_V1',policySnapshot}),context(scope,'REQUEST_TAG','policy:'+scope.policyEpoch));
 const envelope={analysisEnvelopeVersion:2,provenance:{analysisEnvelopeVersion:2,engineGitSha:'1'.repeat(40),workflowVersion:1,inputSchemaVersion:1,
 analysisRevision:1,previousRevision:0,generatedAtMs:h.generatedAtMs,inputCutoffMs:h.inputCutoffMs,policyVersion:scope.policyEpoch,restoreEpoch:scope.restoreEpoch,
 requestId:'fictional-request',inputTag:'2'.repeat(64),policyTag},policySnapshot,workflow:w};
 const store={readHead:()=>{reads++;return structuredClone(h);},readAnalysisSnapshot:()=>{reads++;return {head:structuredClone(h),version:{revision:h.revision,sealedAnalysis:'fictional-analysis'}};}};
 const deps={authorize:async token=>token==='Bearer fictional-valid'?proof:null,getStore:async owner=>{stores++;assert.equal(owner,scope.ownerRef);return store;},
 crypto:{open:async()=>structuredClone(envelope),tag:async(...args)=>tag(...args)},clock:()=>now,maxAnalysisAgeMs:1000,maxInputAgeMs:1000,...extra};
 return {reader:createPrivateReadAdapter(deps),deps,store,head:h,workflow:w,envelope,proof,reads:()=>reads,stores:()=>stores};
}
const call=f=>f.reader.readAnalysis({credential:'Bearer fictional-valid'});
const denied=code=>e=>e.code===code;
test('saved reader authorization precedes store; missing/expired/wrong-role/forged credentials deny',async()=>{
 for(const patch of [{verified:false},{roles:['OWNER_WRITE']},{expiresAtMs:now},{ownerRef:''}]){
  const f=fixture();Object.assign(f.proof,patch);await assert.rejects(()=>call(f),denied('UNAUTHORIZED'));assert.equal(f.stores(),0);
 }
 const f=fixture();await assert.rejects(()=>f.reader.readAnalysis({credential:'wrong'}),denied('UNAUTHORIZED'));assert.equal(f.stores(),0);
});
test('saved reader projects only as-of aggregates with separate ages, null reserve and no ledger/events/secrets',async()=>{
 const f=fixture(),r=await call(f);assert.equal(r.status,'PARTIAL');assert.equal(r.temporalScope,'STORED_AS_OF_NOT_REEVALUATED');
 assert.deepEqual(r.freshness,{analysisAgeMs:100,inputAgeMs:800,status:'WITHIN_CONFIGURED_AGE_LIMITS'});
 assert.equal(r.metricsAsOf.valuation.netAssetsKrw,3000);assert.equal(r.metricsAsOf.valuation.investableCashKrw,null);
 assert.equal(r.metricsAsOf.priceStress.netAssetChangeKrw,-250);assert.equal(r.metricsAsOf.cashDeadlines.accountShortfallSumKrw,500);
 assert.equal(r.metricsAsOf.concentration.samsungHynixWeightBps,2857);assert.equal(r.featureVersion,null);assert.equal(r.signalVersion,null);
 assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL')&&!JSON.stringify(r).includes('PRIVATE_ACCOUNT_SENTINEL'));assert.ok(!('events'in r));assert.ok(!('ownerRef'in r));
 assert.equal(r.provenance.engineGitSha,'1'.repeat(40));assert.equal(r.provenance.releaseEvidence,'CONFIGURED_REFERENCE_NOT_ATTESTATION');
 for(const key of ['policySnapshot','requestId','inputTag','restoreEpoch'])assert.ok(!JSON.stringify(r).includes('"'+key+'"'));
});
test('saved reader legacy raw analysis is unavailable, never rewritten or assigned a current SHA; status remains readable',async()=>{
 const f=fixture();f.deps.crypto.open=async()=>f.workflow;
 await assert.rejects(()=>call(f),denied('PRIVATE_READ_UNAVAILABLE'));assert.equal((await f.reader.readStatus({credential:'Bearer fictional-valid'})).revision,1);
 assert.equal(f.head.revision,1);assert.ok(!Object.hasOwn(f.workflow,'provenance'));
});
test('saved reader rejects unsupported/missing release, revision chain, policy epoch and input linkage without echo',async()=>{
 for(const patch of [f=>f.envelope.analysisEnvelopeVersion=1,f=>delete f.envelope.provenance,
  f=>f.envelope.provenance.engineGitSha='',f=>f.envelope.provenance.workflowVersion=2,f=>f.envelope.provenance.inputSchemaVersion=2,
  f=>f.envelope.provenance.previousRevision=1,f=>f.envelope.provenance.analysisRevision=2,
  f=>f.envelope.provenance.generatedAtMs++,f=>f.envelope.provenance.inputCutoffMs++,f=>f.envelope.provenance.policyVersion='other',
  f=>f.envelope.provenance.restoreEpoch='other',f=>f.envelope.provenance.inputTag=null,f=>f.envelope.provenance.requestId='',
  f=>f.envelope.provenance.unknown='PRIVATE_SENTINEL']){
  const f=fixture();patch(f);await assert.rejects(()=>call(f),denied('PRIVATE_READ_UNAVAILABLE'));assert.equal(f.head.revision,1);
 }
});
test('saved reader verifies encrypted policy HMAC and invocation time; neither stale metadata nor dependency errors are promoted',async()=>{
 for(const patch of [f=>f.envelope.policySnapshot.analysisPolicy.maxPriceAgeMs++,f=>f.envelope.policySnapshot.eventPolicy.nowMs++,
  f=>f.envelope.provenance.policyTag='0'.repeat(64),f=>f.deps.crypto.tag=async()=>{throw Error('PRIVATE_SENTINEL');}]){
  const f=fixture();patch(f);await assert.rejects(()=>call(f),e=>e.code==='PRIVATE_READ_UNAVAILABLE'&&!e.message.includes('PRIVATE_SENTINEL'));
 }
});
test('saved response projection retains historical release under staleness and strips policy/identity extras',async()=>{
 const f=fixture({maxInputAgeMs:500});f.envelope.provenance.engineGitSha='6'.repeat(40);const r=await call(f);
 assert.equal(r.status,'UNAVAILABLE');assert.equal(r.provenance.engineGitSha,'6'.repeat(40));
 const p=privateSavedAnalysisView({...r,policySnapshot:{privateSecret:'PRIVATE_SENTINEL'},provenance:{...r.provenance,requestId:'PRIVATE_SENTINEL'}},now);
 assert.equal(p.provenance.engineGitSha,'6'.repeat(40));assert.ok(!JSON.stringify(p).includes('PRIVATE_SENTINEL'));
 assert.throws(()=>privateSavedAnalysisView({...r,provenance:undefined},now),e=>e.code==='INVALID_ANALYSIS_PROVENANCE');
});
test('saved reader input age cannot inherit fresh analysis time; either independent age limit suppresses values',async()=>{
 for(const extra of [{maxInputAgeMs:500},{maxAnalysisAgeMs:50}]){
  const f=fixture(extra),r=await call(f);assert.equal(r.status,'UNAVAILABLE');assert.equal(r.freshness.status,'STALE_INPUT');
  assert.ok(Object.values(r.metricsAsOf).every(x=>x===null));assert.ok(Object.values(r.capabilitiesAsOf).every(x=>x==='UNAVAILABLE'));
  assert.equal(r.riskEventState,'RETAINED_NOT_REEVALUATED_OR_RESOLVED');assert.equal(f.head.revision,1);
 }
});
test('saved reader preserves unavailable market valuation while independent cash risk remains usable as-of',async()=>{
 const f=fixture();for(const key of ['valuation','investableCash','priceStress','concentration'])f.workflow.capabilities[key]='UNAVAILABLE';
 delete f.workflow.summary.components.valuation.totals;const r=await call(f);assert.equal(r.metricsAsOf.valuation,null);
 assert.equal(r.capabilitiesAsOf.cashDeadlines,'AVAILABLE');assert.equal(r.metricsAsOf.cashDeadlines.accountShortfallSumKrw,500);
});
test('saved reader rejects mismatched version/cutoff/future time/nonfinite/missing required total and unsupported capability claims',async()=>{
 const patches=[f=>f.workflow.contractVersion=2,f=>f.workflow.summary.components.valuation.status='BLOCKED',f=>f.workflow.generatedAtMs++,f=>f.workflow.summary.inputCutoffMs++,
 f=>f.head.generatedAtMs=now+1,f=>f.workflow.summary.components.valuation.totals.grossAssetsKrw=NaN,
 f=>f.workflow.summary.components.valuation.totals.grossAssetsKrw=null,f=>f.workflow.capabilities.tax='AVAILABLE',
 f=>f.workflow.summary.components.cashDeadlines.totals.earliestShortfallDueAtMs=null,
 f=>f.workflow.summary.components.concentration.samsungHynixCombined.weightBps=3000];
 for(const patch of patches){const f=fixture();patch(f);await assert.rejects(()=>call(f),denied('PRIVATE_READ_UNAVAILABLE'));}
});
test('saved reader rechecks head revision/epochs/freeze after async decrypt, never silently retries or labels old snapshot latest',async()=>{
 for(const patch of [{revision:2},{authorizationEpoch:'auth-b'},{restoreEpoch:'restore-b'},{mode:'MAINTENANCE_FROZEN'}]){
  const f=fixture();f.deps.crypto.open=async()=>{Object.assign(f.head,patch);return f.envelope;};
  await assert.rejects(()=>call(f),denied(patch.revision?'SNAPSHOT_CHANGED':'PRIVATE_READ_UNAVAILABLE'));assert.equal(f.stores(),1);
 }
});
test('saved reader checks expiry/abort after decrypt and never returns data through stale proof',async()=>{
 const f=fixture();f.deps.crypto.open=async()=>{f.proof.expiresAtMs=now;return f.envelope;};
 // Returned principal is detached; use the clock to expire the already-issued proof instead of mutating its source.
 let t=now;const other=fixture({clock:()=>t});other.deps.crypto.open=async()=>{t=now+60001;return other.envelope;};
 await assert.rejects(()=>call(other),denied('UNAUTHORIZED'));
 const aborted=new AbortController();aborted.abort();await assert.rejects(()=>f.reader.readAnalysis({credential:'Bearer fictional-valid',execution:{signal:aborted.signal}}),denied('PRIVATE_READ_UNAVAILABLE'));assert.equal(f.stores(),0);
});
test('saved reader missing head/analysis/ciphertext error has no auto initialization, zero fabrication or exception echo',async()=>{
 const f=fixture();f.store.readHead=()=>null;await assert.rejects(()=>f.reader.readStatus({credential:'Bearer fictional-valid'}),denied('PRIVATE_READ_UNAVAILABLE'));
 const empty=fixture();empty.store.readAnalysisSnapshot=()=>({head:{...head(),revision:0,generatedAtMs:0,inputCutoffMs:0},version:null});
 await assert.rejects(()=>call(empty),denied('ANALYSIS_NOT_AVAILABLE'));
 const corrupt=fixture();corrupt.deps.crypto.open=async()=>{throw Error('PRIVATE_SENTINEL');};
 await assert.rejects(()=>call(corrupt),e=>e.code==='PRIVATE_READ_UNAVAILABLE'&&!e.message.includes('PRIVATE_SENTINEL'));
});
test('saved reader status uses explicit null initial timestamps and frozen status never exposes analysis',async()=>{
 const f=fixture();Object.assign(f.head,{revision:0,generatedAtMs:0,inputCutoffMs:0});
 assert.deepEqual(await f.reader.readStatus({credential:'Bearer fictional-valid'}),{schemaVersion:1,mode:'ACTIVE',revision:0,generatedAtMs:null,inputCutoffMs:null});
 const frozen=fixture();frozen.head.mode='MAINTENANCE_FROZEN';assert.equal((await frozen.reader.readStatus({credential:'Bearer fictional-valid'})).mode,'MAINTENANCE_FROZEN');
 await assert.rejects(()=>call(frozen),denied('PRIVATE_READ_UNAVAILABLE'));
});
test('saved reader constructor requires explicit finite independent age limits and fixed read role',()=>{
 const f=fixture();for(const patch of [{maxAnalysisAgeMs:undefined},{maxInputAgeMs:-1},{maxAnalysisAgeMs:Infinity},{readRole:'OWNER_WRITE'}])
 assert.throws(()=>createPrivateReadAdapter({...f.deps,...patch}),/INVALID_PRIVATE_READ_CONFIGURATION/);
});
test('HTTP optional analysis route reprojects safe as-of view and returns known absent/changed errors without raw details',async()=>{
 const f=fixture(),options={origin:'https://fictional-private.invalid',authorize:async()=>f.proof,checkRateLimit:async()=>({allowed:true}),
 inputAdapter:{submit:async()=>{}},statusReader:f.reader.readStatus,analysisReader:f.reader.readAnalysis,clock:()=>now};
 const req=()=>new Request(options.origin+'/private/analysis/latest',{headers:{authorization:'Bearer fictional-valid'}});
 const h=createPrivateHttpBoundary(options),response=await h(req()),data=await response.json();assert.equal(response.status,200);
 assert.equal(data.metricsAsOf.valuation.netAssetsKrw,3000);assert.ok(!JSON.stringify(data).includes('PRIVATE_SENTINEL')&&!JSON.stringify(data).includes('PRIVATE_ACCOUNT_SENTINEL'));assert.equal(response.headers.get('cache-control'),'no-store, private');
 const changed=createPrivateHttpBoundary({...options,analysisReader:async()=>{const e=new Error('PRIVATE_SENTINEL');e.code='SNAPSHOT_CHANGED';throw e;}});
 // Only the trusted typed error contract is projected; arbitrary exceptions remain generic.
 const result=await changed(req());assert.equal(result.status,503);assert.ok(!(await result.text()).includes('PRIVATE_SENTINEL'));
});
test('as-of response projection cannot upgrade zero/null, add raw fields or reclassify unsupported capabilities',async()=>{
 const r=await call(fixture());r.metricsAsOf.valuation.extraSecret='PRIVATE_SENTINEL';r.metricsAsOf.cashDeadlines.accountShortfallSumKrw=0;r.metricsAsOf.cashDeadlines.earliestShortfallDueAtMs=null;
 const projected=privateSavedAnalysisView(r,now);assert.equal(projected.metricsAsOf.cashDeadlines.accountShortfallSumKrw,0);
 assert.equal(projected.metricsAsOf.valuation.investableCashKrw,null);assert.ok(!JSON.stringify(projected).includes('PRIVATE_SENTINEL'));
 assert.throws(()=>privateSavedAnalysisView({...r,capabilitiesAsOf:{...r.capabilitiesAsOf,collateral:'AVAILABLE'}},now),denied('PRIVATE_READ_UNAVAILABLE'));
});
test('as-of response projection preserves inherited STALE_INPUT even if a small clock rollback crosses its age threshold',async()=>{
 const r=await call(fixture({maxInputAgeMs:795}));assert.equal(r.freshness.status,'STALE_INPUT');
 const again=privateSavedAnalysisView(r,now-10);assert.equal(again.freshness.status,'STALE_INPUT');assert.equal(again.status,'UNAVAILABLE');
 assert.ok(Object.values(again.metricsAsOf).every(x=>x===null));
});
