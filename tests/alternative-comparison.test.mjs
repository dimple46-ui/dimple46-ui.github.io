import test from 'node:test';
import assert from 'node:assert/strict';
import {compareAlternatives} from '../domain/alternative-comparison.mjs';
const now=Date.parse('2026-10-16T04:20:00Z');
const policy={nowMs:now,maxLedgerAgeMs:10000,maxPriceAgeMs:10000,maxEvidenceAgeMs:10000,reserveKrw:100};
function fixture(){
 const evidence=[{id:'fictional-evidence',sourceRef:'synthetic-only',quality:'VERIFIED',verifiedAtMs:now}];
 const ref=['fictional-evidence'];
 return {schemaVersion:1,capitalKrw:500,horizonDays:30,evidence,
 ledger:{schemaVersion:1,currency:'KRW',asOfMs:now,accounts:[{accountRef:'fake-account',sourceRef:'synthetic',verifiedAtMs:now,
 coverage:{holdings:true,cash:true,debts:true,obligations:true},holdings:[{ticker:'005930',quantity:1}],
 cash:{balanceKrw:2000,withdrawableKrw:2000},debts:[{principalKrw:1000}],additionalOutflowsKrw:100}]},
 prices:{'005930':{priceKrw:100,currency:'KRW',quality:'VERIFIED',sourceRef:'synthetic',observedAtMs:now}},
 alternatives:['ADD_EXISTING','ADD_NEW','KEEP_CASH','REPAY_DEBT'].map(type=>({type,
 ticker:type==='ADD_EXISTING'?'005930':type==='ADD_NEW'?'000660':undefined,
 companyMerit:{state:'SUPPORTIVE',rationale:'Fictional corporate case only',evidenceRefs:ref},
 portfolioFit:{state:type==='ADD_NEW'?'ADVERSE':'MIXED',concentrationImpact:'Fictional concentration change needs review',
 liquidityImpact:'Fictional liquidity impact',evidenceRefs:ref},
 fundingEvidenceRefs:ref,costs:{feesKrw:0,taxesKrw:0,interestKrw:0,prepaymentFeesKrw:0,evidenceRefs:ref},
 risk:{downside:'Fictional downside',catalyst:'Fictional review event',invalidation:'Fictional premise fails',
 expiresAtMs:now+1000,evidenceRefs:ref}}))};
}
test('four common-budget alternatives preserve merit/fit disagreement and never rank or size trades',()=>{
 const f=fixture(),before=structuredClone(f),r=compareAlternatives(f,policy);
 assert.deepEqual(f,before);assert.deepEqual(r,compareAlternatives(f,policy));assert.equal(r.rows.length,4);
 assert.equal(r.status,'COMPARISON_ONLY');assert.ok(r.rows.every(x=>x.status==='INPUT_COMPLETE_NOT_RECOMMENDED'));
 const candidate=r.rows[1];assert.equal(candidate.companyMerit.state,'SUPPORTIVE');assert.equal(candidate.portfolioFit.state,'ADVERSE');
 assert.equal(r.recommendation,null);assert.equal(r.ranking,null);assert.equal(r.tradeQuantities,null);
 r.rows[0].risk.downside='changed';assert.deepEqual(f,before);
});
test('missing capital evidence, costs, risk, fit or merit blocks related comparison without inventing zero',()=>{
 for(const mutate of [o=>delete o.costs.taxesKrw,o=>o.fundingEvidenceRefs=[],o=>delete o.risk,
 o=>o.portfolioFit.state='UNASSESSED',o=>o.companyMerit.state='UNASSESSED']){
  const f=fixture();mutate(f.alternatives[0]);const r=compareAlternatives(f,policy);
  assert.equal(r.rows[0].status,'BLOCKED');assert.equal(r.rows[0].requiredCashKrw,null);
  assert.equal(r.rows[2].status,'INPUT_COMPLETE_NOT_RECOMMENDED');
 }
});
test('unknown cash, absent reserve and stale/future evidence never authorize a comparison',()=>{
 for(const mutate of [f=>f.ledger.accounts[0].cash.withdrawableKrw=null,f=>f.evidence[0].verifiedAtMs=now+1,
 f=>f.evidence[0].verifiedAtMs=now-10001,f=>f.evidence[0].quality='UNVERIFIED_TIME']){
  const f=fixture();mutate(f);assert.ok(compareAlternatives(f,policy).rows.every(r=>r.status==='BLOCKED'));
 }
 assert.ok(compareAlternatives(fixture(),{...policy,reserveKrw:undefined}).rows.every(r=>r.status==='BLOCKED'));
});
test('explicit costs reveal funding gap and aggregate repayment principal cannot be exceeded',()=>{
 const f=fixture();f.alternatives[1].costs.feesKrw=1500;
 const r=compareAlternatives(f,policy);assert.equal(r.rows[1].requiredCashKrw,2000);
 assert.equal(r.rows[1].fundingGapKrw,200);assert.equal(r.rows[1].status,'KNOWN_FUNDING_GAP');
 f.capitalKrw=1100;assert.ok(compareAlternatives(f,policy).rows[3].missing.includes('DEBT_PRINCIPAL_EXCEEDED_OR_UNKNOWN'));
});
test('duplicate alternatives, wrong holding membership, expired risk and overflow fail closed',()=>{
 for(const mutate of [f=>f.alternatives[3].type='KEEP_CASH',f=>f.alternatives[0].ticker='000660',
 f=>f.alternatives[0].risk.expiresAtMs=now,f=>f.alternatives[0].costs.feesKrw=Number.MAX_SAFE_INTEGER]){
  const f=fixture();mutate(f);assert.equal(compareAlternatives(f,policy).rows[0].status,'BLOCKED');
 }
 assert.throws(()=>compareAlternatives({...fixture(),capitalKrw:null},policy),/INVALID_COMPARISON_CONTEXT/);
});

test('evidence newer than the declared input cutoff and malformed account scopes are blocked',()=>{
 const f=fixture();f.ledger.asOfMs=now-1;f.ledger.accounts[0].verifiedAtMs=now-1;f.prices['005930'].observedAtMs=now-1;
 assert.ok(compareAlternatives(f,policy).rows.every(r=>r.status==='BLOCKED'));
 const malformed=fixture();malformed.ledger.accounts={};
 assert.ok(compareAlternatives(malformed,policy).rows.every(r=>r.status==='BLOCKED'));
});
