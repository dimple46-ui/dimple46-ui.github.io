import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGeneralResearchDraft as prepare} from '../domain/research-general-draft.mjs';
import {prepareResearchDraft as v1} from '../domain/research-draft-review.mjs';
const now=Date.parse('2026-10-18T03:00:00Z');
function fixture(){return {
 schema_version:2,package_type:'GENERAL_RESEARCH_DRAFT',package_id:'synthetic.general.001',revision:1,disclosure:'SYNTHETIC_PUBLIC_EXAMPLE',
 target:{ticker:'000660',market:'KRX',currency:'KRW'},horizon:'12M',analysis_cutoff_ms:now-1000,generated_at_ms:now,review_at_ms:now+10000,expires_at_ms:now+20000,
 sources:[{source_id:'fictional.source',issuer_id:'fictional.issuer',author:'Synthetic author',url:'https://example.invalid/report',location:'Fictional table1',published_date:'2026-10-16',acquired:{precision:'INSTANT',at_ms:now-2000,date:null,timezone:null},access:'DECLARED_ORIGINAL_READ',quantities:[{quantity_id:'fictional.q1',metric:'revenue',value:'123.450',unit:'KRW_BILLION',currency:'KRW',fiscal_period:'2026Q2',scope:'CONSOLIDATED',figure_status:'PRELIMINARY_ESTIMATE'}]}],
 claims:[{claim_id:'support',kind:'ESTIMATE',text:'Fictional preliminary revenue',source_refs:['fictional.source'],quantity_ref:'fictional.q1'},{claim_id:'contrary',kind:'HYPOTHESIS',text:'Fictional margin may normalize',source_refs:['fictional.source'],quantity_ref:null}],
 thesis:{state:'MIXED',supporting_claim_refs:['support'],contrary_claim_refs:['contrary'],invalidation:'Fictional assumptions no longer hold'},report_comparison:null
};}
const run=d=>prepare(d,{nowMs:now});
test('one source is reviewable without fabricating a comparison or approval',()=>{
 const p=fixture(),r=run(p);assert.equal(r.status,'REVIEW_REQUIRED');assert.deepEqual(r.report_comparison,{status:'UNAVAILABLE',reason:'NOT_PROVIDED'});
 assert.equal(r.approval,'NOT_RECORDED');assert.equal(r.receipt,'NOT_RECORDED');assert.equal(r.consumer_status,'UNSUPPORTED_BY_LEGACY_CONSUMER');assert.equal(r.historical_replay_allowed,false);
 assert.equal(r.trade_quantities,null);assert.equal(r.private_valuation,null);assert.ok(Object.isFrozen(r.draft.sources[0]));assert.notEqual(r.draft,p);
});
test('date-only acquisition stays imprecise without an invented instant',()=>{
 const p=fixture();p.sources[0].acquired={precision:'DATE_ONLY',at_ms:null,date:'2026-10-16',timezone:'Asia/Seoul'};
 const r=run(p);assert.equal(r.historical_availability,'INSUFFICIENT_ACQUISITION_PRECISION');assert.equal(r.draft.sources[0].acquired.at_ms,null);
});
test('unknown acquisition cannot enable historical replay',()=>{
 const p=fixture();p.sources[0].acquired={precision:'UNKNOWN',at_ms:null,date:null,timezone:null};assert.equal(run(p).historical_replay_allowed,false);
});
test('exact decimal lexical precision and deterministic identity survive review',()=>{
 const p=fixture(),a=run(p),b=run(structuredClone(p));assert.deepEqual(a,b);assert.equal(a.draft.sources[0].quantities[0].value,'123.450');
 const changed=fixture();changed.sources[0].quantities[0].value='123.45';assert.notEqual(run(changed).content_sha256,a.content_sha256);
});
test('root and nested authority/private fields reject; v1 cannot accept general draft',()=>{
 for(const mutate of [p=>p.approved=true,p=>p.holdings=123,p=>p.sources[0].secret='x',p=>p.thesis.trade_quantity=1]){const p=fixture();mutate(p);assert.throws(()=>run(p),/SCHEMA_REJECTED/);}
 assert.throws(()=>v1(fixture(),{nowMs:now}),/SCHEMA_REJECTED/);
});
test('future acquisition, publication and generation reject',()=>{
 for(const mutate of [p=>p.sources[0].acquired.at_ms=now,p=>p.sources[0].published_date='2026-10-19',p=>p.generated_at_ms=now+1,p=>p.analysis_cutoff_ms=now+1,p=>p.sources[0].acquired={precision:'DATE_ONLY',at_ms:null,date:'2026-10-19',timezone:'Asia/Seoul'}]){const p=fixture();mutate(p);assert.throws(()=>run(p),/TIME|FUTURE|ACQUISITION/);}
});
test('impossible calendar dates and inconsistent acquisition precision reject',()=>{
 for(const mutate of [p=>p.sources[0].published_date='2026-02-30',p=>p.sources[0].acquired.date='2026-10-16',p=>p.sources[0].acquired={precision:'DATE_ONLY',at_ms:now-2000,date:'2026-10-16',timezone:'Asia/Seoul'}]){const p=fixture();mutate(p);assert.throws(()=>run(p),/DATE|ACQUISITION/);}
});
test('missing or duplicate source and quantity links reject',()=>{
 for(const mutate of [p=>p.claims[0].source_refs=['missing'],p=>p.claims[0].quantity_ref='missing',p=>p.sources.push({...structuredClone(p.sources[0]),author:'Other'}),p=>p.sources[0].quantities.push({...p.sources[0].quantities[0],value:'1'}),p=>p.thesis.contrary_claim_refs=['missing']]){const p=fixture();mutate(p);assert.throws(()=>run(p));}
});
test('preliminary numbers cannot be promoted to facts or hypothesis quantities',()=>{
 for(const kind of ['FACT','HYPOTHESIS']){const p=fixture();p.claims[0].kind=kind;assert.throws(()=>run(p),/QUANTITY_LINK/);}
});
test('numeric, negative zero and exponent quantities reject without rounding',()=>{
 for(const value of [1.25,'-0.0','1e2','0.0000000001']){const p=fixture();p.sources[0].quantities[0].value=value;assert.throws(()=>run(p));}
});
test('optional report comparison requires comparable source lineage',()=>{
 const p=fixture(),s=structuredClone(p.sources[0]);s.source_id='fictional.current';s.published_date='2026-10-17';s.quantities[0].quantity_id='fictional.q2';s.quantities[0].figure_status='COMPANY_REPORTED';s.quantities[0].value='123.451';p.sources.push(s);
 p.report_comparison={baseline_quantity_id:'fictional.q1',current_quantity_id:'fictional.q2'};
 assert.equal(run(p).report_comparison.ordering,-1);
 for(const field of ['unit','fiscal_period','metric','scope']){const q=structuredClone(p);q.sources[1].quantities[0][field]=field==='unit'?'KRW_TRILLION':field==='fiscal_period'?'2026Q3':field==='metric'?'operatingProfit':'SEPARATE';assert.throws(()=>run(q));}
 const q=structuredClone(p);q.sources[1].issuer_id='unrelated';assert.throws(()=>run(q),/INCOMPARABLE/);
 const unread=structuredClone(p);unread.sources[1].access='NOT_CONFIRMED';assert.throws(()=>run(unread),/INCOMPARABLE/);
});
test('duplicate source is never made into baseline and current',()=>{
 const p=fixture();p.report_comparison={baseline_quantity_id:'fictional.q1',current_quantity_id:'fictional.q1'};assert.throws(()=>run(p),/INCOMPARABLE/);
});
test('unread declaration remains unverified and expiry never renews',()=>{
 const p=fixture();p.sources[0].access='NOT_CONFIRMED';const r=run(p);assert.match(r.source_verification,/NOT_INDEPENDENT/);
 assert.equal(prepare(p,{nowMs:now+10000}).temporal_status,'REVIEW_DUE');assert.equal(prepare(p,{nowMs:now+20000}).temporal_status,'EXPIRED');
});
test('unsafe URLs and oversize/accessor input fail without execution or echo',()=>{
 for(const url of ['javascript:alert(1)','https://user:pass@example.invalid/x','https://example.invalid/x?token=secret']){const p=fixture();p.sources[0].url=url;assert.throws(()=>run(p),/INVALID_GENERAL_SOURCE_URL/);}
 let calls=0;const p=fixture();Object.defineProperty(p,'evil',{enumerable:true,get(){calls++;return 1;}});assert.throws(()=>run(p),/SCHEMA_REJECTED/);assert.equal(calls,0);
 const q=fixture();q.claims[0].text='x'.repeat(70000);assert.throws(()=>run(q),/SCHEMA_REJECTED/);
});
const dateCondition=date=>({kind:'DATE_ONLY',date,timezone:'Asia/Seoul',event_id:null,description:null});
const eventCondition=()=>({kind:'EVENT',date:null,timezone:null,event_id:'fictional.new.results',description:'Review on new official financial results; not an executable rule'});
const unknownCondition=()=>({kind:'UNKNOWN',date:null,timezone:null,event_id:null,description:null});
test('date-only lifecycle comparisons cover extended years and the maximum valid timestamp',()=>{
 const p=fixture();p.review_at_ms=null;p.expires_at_ms=null;
 p.review_condition=dateCondition('2026-10-19');p.expiry_condition=dateCondition('2026-10-20');
 for(const nowMs of [253402300800000,8640000000000000]){
  const r=prepare(p,{nowMs});assert.equal(r.lifecycle.review.status,'DATE_REQUIRES_REVIEW');
  assert.equal(r.lifecycle.expiry.status,'DATE_REQUIRES_REVIEW');assert.equal(r.temporal_status,'DATE_REQUIRES_MANUAL_REVIEW');
 }
 const mixed=fixture();mixed.review_at_ms=253402300800000;mixed.expires_at_ms=null;
 mixed.expiry_condition=dateCondition('2026-10-20');
 assert.throws(()=>prepare(mixed,{nowMs:253402300800000}),/INVALID_GENERAL_LIFECYCLE/);
});
test('schema text length counts Unicode code points at its documented boundary',()=>{
 const p=fixture();p.claims[0].text='🙂'.repeat(1024);
 assert.equal(run(p).draft.claims[0].text,p.claims[0].text);
 p.claims[0].text+='🙂';assert.throws(()=>run(p),/GENERAL_DRAFT_SCHEMA_REJECTED/);
});
test('date-only review preserves day precision across the KST date boundary',()=>{
 const p=fixture();p.review_at_ms=null;p.review_condition=dateCondition('2026-10-19');p.expires_at_ms=null;p.expiry_condition=eventCondition();
 const before=prepare(p,{nowMs:Date.parse('2026-10-18T14:59:59.999Z')}),at=prepare(p,{nowMs:Date.parse('2026-10-18T15:00:00Z')});
 assert.equal(before.lifecycle.review.status,'NOT_DUE');assert.equal(at.lifecycle.review.status,'DATE_REQUIRES_REVIEW');
 assert.equal(at.lifecycle.review.at_ms,null);assert.equal(at.draft.review_at_ms,null);assert.equal(at.temporal_status,'DATE_REQUIRES_MANUAL_REVIEW');
 assert.equal(at.lifecycle.expiry.status,'MANUAL_EVENT_REVIEW_REQUIRED');assert.equal(at.content_sha256,before.content_sha256);
});
test('date-only expiry is not falsely given an exact expired instant',()=>{
 const p=fixture();p.review_at_ms=null;p.review_condition=dateCondition('2026-10-18');p.expires_at_ms=null;p.expiry_condition=dateCondition('2026-10-19');
 const r=prepare(p,{nowMs:Date.parse('2026-10-19T00:00:00Z')});assert.equal(r.lifecycle.expiry.at_ms,null);assert.equal(r.temporal_status,'DATE_REQUIRES_MANUAL_REVIEW');assert.notEqual(r.temporal_status,'EXPIRED');
});
test('event and unknown conditions cannot grant freshness, approval or evaluation',()=>{
 const p=fixture();p.review_at_ms=null;p.expires_at_ms=null;p.review_condition=eventCondition();p.expiry_condition=unknownCondition();
 const r=run(p);assert.equal(r.temporal_status,'MANUAL_EVENT_REVIEW_REQUIRED');assert.equal(r.lifecycle.expiry.status,'UNSPECIFIED');assert.equal(r.approval,'NOT_RECORDED');assert.equal(r.historical_replay_allowed,false);
 p.review_condition=unknownCondition();assert.equal(run(p).temporal_status,'LIFECYCLE_UNSPECIFIED');
});
test('ambiguous lifecycle fields, impossible dates and contradictory ordering reject',()=>{
 for(const mutate of [p=>p.review_condition=dateCondition('2026-10-19'),p=>p.review_at_ms=null,p=>{p.review_at_ms=null;p.review_condition={...eventCondition(),date:'2026-10-19'};},p=>{p.review_at_ms=null;p.review_condition=dateCondition('2026-02-30');},p=>{p.review_at_ms=null;p.expires_at_ms=null;p.review_condition=dateCondition('2026-10-20');p.expiry_condition=dateCondition('2026-10-19');},p=>{p.expires_at_ms=null;p.expiry_condition=dateCondition('2026-10-17');}]){const p=fixture();mutate(p);assert.throws(()=>run(p),/LIFECYCLE|DATE/);}
});
test('original horizon/state may stay explicitly unclassified rather than inventing analyst intent',()=>{
 const p=fixture();p.horizon='UNSPECIFIED';p.thesis.state='UNCLASSIFIED';p.original_research={package_id:'synthetic.original',revision_text:'draft.0.2',original_bytes_sha256:'a'.repeat(64),declared_horizon:'3-12 months and 1-3 years',declared_thesis_state:'maintain with conditions',declared_analysis_date:'2026-10-16',declared_created_date:'2026-10-16'};
 const r=run(p);assert.equal(r.classification_pending,true);assert.equal(r.draft.original_research.declared_thesis_state,'maintain with conditions');assert.equal(r.consumer_status,'UNSUPPORTED_BY_LEGACY_CONSUMER');
 p.original_research.declared_analysis_date='2026-10-20';assert.throws(()=>run(p),/FUTURE_ORIGINAL_RESEARCH/);
});
