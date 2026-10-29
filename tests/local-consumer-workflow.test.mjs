import test from 'node:test';
import assert from 'node:assert/strict';
import {runLocalConsumerWorkflow,buildPublicConsumerSummary} from '../domain/local-consumer-workflow.mjs';
const now=Date.parse('2026-10-16T04:30:00Z');
const marketPolicy={nowMs:now,maxObservationAgeMs:120000,maxFeatureAgeMs:300000};
const privatePolicy={nowMs:now,maxLedgerAgeMs:10000,maxPriceAgeMs:10000,maxEvidenceAgeMs:10000,reserveKrw:100};
function fixture(){
 const ref=['fake-evidence'];
 return {marketInputs:{candidateState:{error:'UNAUTHORIZED'},githubSnapshot:{schemaVersion:3,koreaDate:'20261016',
  relayUpdatedAt:new Date(now-1000).toISOString(),pipelineStatus:'DEGRADED',stocks:{samsung:{price:100,volume:500}}}},
 privateComparison:{schemaVersion:1,capitalKrw:500,horizonDays:30,evidence:[{id:ref[0],sourceRef:'fictional',verifiedAtMs:now,quality:'VERIFIED'}],
  ledger:{schemaVersion:1,currency:'KRW',asOfMs:now,accounts:[{accountRef:'PRIVATE_SENTINEL_ACCOUNT',sourceRef:'fictional',verifiedAtMs:now,
   coverage:{holdings:true,cash:true,debts:true,obligations:true},holdings:[{ticker:'005930',quantity:1}],
   cash:{balanceKrw:2000,withdrawableKrw:2000},debts:[{principalKrw:1000}],additionalOutflowsKrw:100}]},
  prices:{'005930':{priceKrw:100,currency:'KRW',quality:'VERIFIED',sourceRef:'fictional',observedAtMs:now}},
  alternatives:['ADD_EXISTING','ADD_NEW','KEEP_CASH','REPAY_DEBT'].map(type=>({type,ticker:type==='ADD_EXISTING'?'005930':'000660',
   companyMerit:{state:'MIXED',rationale:'PRIVATE_SENTINEL_MERIT',evidenceRefs:ref},
   portfolioFit:{state:'MIXED',concentrationImpact:'PRIVATE_SENTINEL_FIT',liquidityImpact:'fictional',evidenceRefs:ref},
   risk:{downside:'PRIVATE_SENTINEL_RISK',catalyst:'fictional',invalidation:'fictional',expiresAtMs:now+1000,evidenceRefs:ref},
   fundingEvidenceRefs:ref,costs:{feesKrw:0,taxesKrw:0,interestKrw:0,prepaymentFeesKrw:0,evidenceRefs:ref}}))}};
}
const options={marketPolicy,privatePolicy,enablePrivateEvaluation:true};
test('fallback → ledger → four-alternative local integration never implies public portfolio readiness',()=>{
 const f=fixture(),copy=structuredClone(f),r=runLocalConsumerWorkflow(f,options);
 assert.equal(r.privateResult.data.status,'COMPARISON_ONLY');assert.equal(r.privateResult.data.rows.length,4);
 assert.equal(r.publicResult.observation.source,'GITHUB_FALLBACK');assert.equal(r.publicResult.status,'PARTIAL');
 for(const k of ['features','signals','portfolio','decision'])assert.equal(r.publicResult.capabilities[k],'UNAVAILABLE');
 assert.equal(r.classification,'PRIVATE_COMBINED_RESULT_DO_NOT_PUBLISH');assert.deepEqual(f,copy);
 const wire=JSON.stringify(r.publicResult);assert.ok(!wire.includes('PRIVATE_SENTINEL'));
 for(const key of ['capitalKrw','requiredCashKrw','fundingGapKrw','accountRef','companyMerit','portfolioFit','risk'])assert.ok(!wire.includes(key));
});
test('public projection remains independent of private changes/failures and ignores hostile raw strings',()=>{
 const f=fixture(),publicBefore=buildPublicConsumerSummary(f.marketInputs,marketPolicy);
 f.privateComparison.ledger.accounts[0].cash.withdrawableKrw=null;
 let r=runLocalConsumerWorkflow(f,options);assert.equal(r.privateResult.data.ledgerStatus,'BLOCKED');assert.deepEqual(r.publicResult,publicBefore);
 f.privateComparison=null;r=runLocalConsumerWorkflow(f,options);assert.equal(r.privateResult.status,'BLOCKED');
 assert.deepEqual(r.publicResult,publicBefore);
 f.marketInputs.githubSnapshot.pipelineStatus='PRIVATE_SENTINEL_PIPELINE';
 f.marketInputs.githubSnapshot.dataQuality={secret:'PRIVATE_SENTINEL_QUALITY'};
 f.marketInputs.githubSnapshot.stocks.samsung.price=NaN;
 const wire=JSON.stringify(buildPublicConsumerSummary(f.marketInputs,marketPolicy));assert.ok(!wire.includes('PRIVATE_SENTINEL'));
});
test('old Feature retains its own age/cutoff and cannot inherit a recent observation',()=>{
 const f=fixture();f.marketInputs.candidateState={apiSchemaVersion:1,inputCutoffMs:now,state:{schemaVersion:1,
  observedAtMs:now-1000,availableAtMs:now-500,tradingDay:'20261016',pipelineStatus:'OK',metrics:{'samsung.price':{value:100,status:'LIVE'}}}};
 f.marketInputs.candidateFeatures={apiSchemaVersion:1,inputCutoffMs:now,feature:{featureVersion:2,
  inputCutoffMs:now-600000,compactFeatures:{featureVersion:2}}};
 const r=runLocalConsumerWorkflow(f,options).publicResult;
 assert.equal(r.observation.ageMs,1000);assert.equal(r.features.ageMs,600000);
 assert.equal(r.features.inputCutoffMs,now-600000);assert.equal(r.features.status,'UNAVAILABLE');
});
test('private evaluation requires explicit opt-in; missing private quotes never reuse public fallback prices',()=>{
 const f=fixture();assert.equal(runLocalConsumerWorkflow(f,{marketPolicy}).privateResult.status,'DISABLED');
 f.privateComparison.prices={};const r=runLocalConsumerWorkflow(f,options);
 assert.equal(r.publicResult.observation.status,'AVAILABLE');assert.equal(r.privateResult.data.ledgerStatus,'BLOCKED');
 assert.ok(r.privateResult.data.rows.every(x=>x.status==='BLOCKED'));
 assert.throws(()=>runLocalConsumerWorkflow(f,{marketPolicy,enablePrivateEvaluation:'true'}),/INVALID_PRIVATE_OPT_IN/);
});
