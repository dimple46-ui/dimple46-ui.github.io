import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createReportJudgment,appendReportJudgment} from '../domain/report-judgment.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('../examples/samsung-q2-report-change.input.json',import.meta.url)));
test('verified same-period source facts create a deterministic, bounded historical judgment',()=>{
 const f=fixture(),before=structuredClone(f),r=createReportJudgment(f);
 assert.deepEqual(f,before);assert.deepEqual(r,createReportJudgment(f));
 assert.equal(r.changes.find(c=>c.metric==='revenue').delta,500);
 assert.equal(r.changes.find(c=>c.metric==='operatingProfit').delta,100);
 assert.equal(r.independentIssuerCount,1);assert.equal(r.judgment.probability,null);
 assert.equal(r.judgment.outcome,'NOT_APPLICABLE_NOT_A_FORECAST');
 assert.throws(()=>r.thesis.interpretation='changed',TypeError);
});
test('mismatched period, currency, scope, unit, estimate state and unread originals fail',()=>{
 for(const [field,value]of [['fiscalPeriod','2026Q3'],['currency','USD'],['scope','SEPARATE'],['unit','KRW_TRILLION'],
 ['figureStatus','PRELIMINARY_ESTIMATE'],['originalRead',false],['url','javascript:alert(1)']]){
  const f=fixture();f.current[field]=value;assert.throws(()=>createReportJudgment(f));
 }
});
test('matching numeric document tickers cannot become a report identity through coercion',()=>{
 const f=fixture();f.baseline.ticker=123456;f.current.ticker=123456;
 assert.throws(()=>createReportJudgment(f),/INVALID_REPORT_IDENTITY/);
});
test('first-seen/cutoff prevents backdating; null, nonfinite and mismatched metric sets fail',()=>{
 for(const mutate of [f=>f.current.firstSeenAtMs=f.inputCutoffMs+1,f=>f.generatedAtMs=f.inputCutoffMs-1,
 f=>f.current.metrics.revenue=null,f=>f.current.metrics.revenue=Infinity,f=>delete f.current.metrics.revenue,
 f=>f.current.documentId=f.baseline.documentId]){const f=fixture();mutate(f);assert.throws(()=>createReportJudgment(f));}
 const f=fixture();f.baseline.metrics.operatingProfit=0;
 assert.equal(createReportJudgment(f).changes.find(c=>c.metric==='operatingProfit').percentageChange,null);
});
test('judgment and source timestamps must be representable dates without shrinking the valid range',()=>{
 for(const value of [8640000000000001,Number.MAX_SAFE_INTEGER]){
  for(const mutate of [f=>f.generatedAtMs=value,f=>{f.generatedAtMs=value;f.inputCutoffMs=value;},
   f=>{f.generatedAtMs=value;f.inputCutoffMs=value;f.current.firstSeenAtMs=value;}]){
   const f=fixture();mutate(f);assert.throws(()=>createReportJudgment(f));
  }
 }
 const f=fixture();f.generatedAtMs=8640000000000000;
 assert.equal(createReportJudgment(f).generatedAtMs,f.generatedAtMs);
});
test('append keeps original records immutable and rejects duplicate IDs, tampering and backdating',()=>{
 const f=fixture(),r=createReportJudgment(f),log=appendReportJudgment([],r);
 assert.equal(log.length,1);assert.throws(()=>appendReportJudgment(log,r),/JUDGMENT_ALREADY_EXISTS/);
 const bad=structuredClone(r);bad.thesis.interpretation='tampered';assert.throws(()=>appendReportJudgment([],bad),/HASH_MISMATCH/);
 f.judgmentId+='-v2';f.generatedAtMs+=1;const second=createReportJudgment(f);
 const log2=appendReportJudgment(log,second);assert.equal(log.length,1);assert.equal(log2.length,2);
 assert.deepEqual(log2[0],r);assert.throws(()=>appendReportJudgment([second],r),/BACKDATED/);
});
test('even an empty judgment log rejects rehashed invalid incoming times and chronology',()=>{
 const original=createReportJudgment(fixture());
 for(const mutate of [r=>delete r.generatedAtMs,r=>r.generatedAtMs=null,r=>r.generatedAtMs=0,
  r=>r.generatedAtMs=NaN,r=>r.generatedAtMs=8640000000000001,
  r=>r.inputCutoffMs=8640000000000001,r=>r.inputCutoffMs=r.generatedAtMs+1,
  r=>r.baseline.firstSeenAtMs=null,r=>r.current.firstSeenAtMs=8640000000000001,
  r=>r.baseline.firstSeenAtMs=r.inputCutoffMs+1,r=>r.current.firstSeenAtMs=r.inputCutoffMs+1,
  r=>r.baseline.firstSeenAtMs=Date.parse(r.baseline.publishedDate+'T00:00:00Z')-1,
  r=>r.current.firstSeenAtMs=Date.parse(r.current.publishedDate+'T00:00:00Z')-1,
  r=>r.current.publishedDate='2026-02-30']){
  const record=structuredClone(original);mutate(record);
  const {contentSha256,...body}=record;
  record.contentSha256=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  assert.throws(()=>appendReportJudgment([],record),/INVALID_JUDGMENT_APPEND_TIME/);
 }
 assert.deepEqual(appendReportJudgment([],original),[original]);
});
