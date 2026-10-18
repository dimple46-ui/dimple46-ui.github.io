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
