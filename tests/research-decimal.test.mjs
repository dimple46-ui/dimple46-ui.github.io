import test from 'node:test';
import assert from 'node:assert/strict';
import {parseResearchDecimal as parse,compareResearchDecimals as compare} from '../domain/research-decimal.mjs';
test('preserves source decimal precision without rounding',()=>{
 assert.deepEqual(parse('123.450'),{text:'123.450',coefficient:'123450',scale:3});
 assert.ok(Object.isFrozen(parse('123.450')));
});
test('represents values beyond safe numeric integers exactly',()=>{
 assert.deepEqual(parse('999999999999999999.123456789'),{text:'999999999999999999.123456789',coefficient:'999999999999999999123456789',scale:9});
});
test('compares scales and signed values exactly',()=>{
 assert.equal(compare('1.20','1.2'),0);
 assert.equal(compare('-1.21','-1.2'),-1);
 assert.equal(compare('0.000000001','0'),1);
 assert.equal(compare('999999999999999999.123456788','999999999999999999.123456789'),-1);
});
test('accepts real zero without accepting negative zero',()=>{
 assert.equal(parse('0.000').coefficient,'0');
 for(const v of ['-0','-0.000'])assert.throws(()=>parse(v),/INVALID_RESEARCH_DECIMAL/);
});
test('rejects missing, numeric, nonfinite and coercible inputs',()=>{
 for(const v of [null,undefined,0,1.25,NaN,Infinity,true,{},[],{toString:()=> '1'}])assert.throws(()=>parse(v),/INVALID_RESEARCH_DECIMAL/);
});
test('rejects ambiguous or executable-looking notation',()=>{
 for(const v of ['', ' 1','1 ', '+1','01','.1','1.','1e3','1,000','NaN','Infinity','1;throw Error()'])assert.throws(()=>parse(v),/INVALID_RESEARCH_DECIMAL/);
});
test('enforces precision and input size before bigint processing',()=>{
 for(const v of ['1000000000000000000','0.0000000001','9'.repeat(100000)])assert.throws(()=>parse(v),/INVALID_RESEARCH_DECIMAL/);
});
test('compare rejects either invalid operand rather than treating it as zero',()=>{
 assert.throws(()=>compare(null,'0'),/INVALID_RESEARCH_DECIMAL/);
 assert.throws(()=>compare('0','UNKNOWN'),/INVALID_RESEARCH_DECIMAL/);
});
