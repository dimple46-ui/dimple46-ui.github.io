// Invented report data only; no company research, credentials or external requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReportJudgment,appendReportJudgment} from '../domain/report-judgment.mjs';
const at=Date.parse('2026-10-19T00:00:00Z');
function fixture(id='fictional-judgment',generatedAtMs=at){
 const source={issuerId:'fictional-issuer',ticker:'999999',originalRead:true,location:'Fictional section',author:'Fictional author',
  url:'https://example.invalid/fictional-report',fiscalPeriod:'2026Q2',scope:'CONSOLIDATED',currency:'KRW',unit:'KRW_BILLION'};
 return {judgmentId:id,generatedAtMs,inputCutoffMs:at,baseline:{...source,documentId:'fictional-estimate',publishedDate:'2026-10-16',firstSeenAtMs:at-86400000,
  figureStatus:'PRELIMINARY_ESTIMATE',metrics:{revenue:100,operatingProfit:10}},
 current:{...source,documentId:'fictional-reported',publishedDate:'2026-10-17',firstSeenAtMs:at-86400000,
  figureStatus:'COMPANY_REPORTED',metrics:{revenue:101,operatingProfit:11}},
 thesis:{interpretation:'Fictional comparison',contraryEvidence:'Fictional contrary evidence',invalidation:'Fictional invalidation'}};
}
function rehash(record){const {contentSha256,...body}=record;record.contentSha256=createHash('sha256').update(JSON.stringify(body)).digest('hex');return record;}
test('normal JSON round-tripped report records preserve their values, field order and hashes',()=>{
 const first=JSON.parse(JSON.stringify(createReportJudgment(fixture()))),second=createReportJudgment(fixture('fictional-second',at+1));
 const log=appendReportJudgment([first],second);assert.deepEqual(log,[first,second]);assert.equal(JSON.stringify(log[0]),JSON.stringify(first));
 assert.ok(Object.isFrozen(log[0].changes));
});
test('append rejects a tampered existing report record instead of preserving it in a new log',()=>{
 const first=structuredClone(createReportJudgment(fixture()));first.changes[0].delta=999;
 const next=createReportJudgment(fixture('fictional-second',at+1));
 assert.throws(()=>appendReportJudgment([first],next),/JUDGMENT_HASH_MISMATCH/);
});
test('append rejects a hash-only object without identity, source facts or calculations',()=>{
 const empty={contentSha256:createHash('sha256').update('{}').digest('hex')};
 assert.throws(()=>appendReportJudgment([],empty));
});
test('rehashed calculated-field tampering fails for both new and existing report records',()=>{
 const wrong=structuredClone(createReportJudgment(fixture()));wrong.changes[0].delta=999;rehash(wrong);
 assert.throws(()=>appendReportJudgment([],wrong),/JUDGMENT_HASH_MISMATCH/);
 const next=createReportJudgment(fixture('fictional-second',at+1));
 assert.throws(()=>appendReportJudgment([wrong],next),/JUDGMENT_HASH_MISMATCH/);
});
