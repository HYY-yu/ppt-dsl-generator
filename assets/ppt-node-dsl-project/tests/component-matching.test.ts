import assert from 'node:assert/strict';
import test from 'node:test';
import {bestComponentAssignment,MAX_MATCH_COMPONENTS} from '../src/component-matching.js';
test('shared matcher aligns reordered geometry and bounds without relying on a fixture',()=>{
 const short={sampleContent:'标题',length:{min:1,max:10},locator:{box:{cx:127000,cy:127000}}};
 const long={sampleContent:'这是一个用于合同匹配的长描述字段，保留完整内容。',length:{min:20,max:40},locator:{box:{cx:1270000,cy:127000}}};
 const a={...short,length:undefined},b={...long,length:undefined};const result=bestComponentAssignment([short,long],[b,a]);
 assert.equal(result.assignment[0],a);assert.equal(result.assignment[1],b);assert.equal(result.ambiguous,false);
});
test('same-kind matching is bounded before exponential work and ambiguous matches remain explicit',()=>{
 const one={sampleContent:'x',locator:{}};
 assert.throws(()=>bestComponentAssignment(Array(MAX_MATCH_COMPONENTS+1).fill(one),Array(MAX_MATCH_COMPONENTS+1).fill(one)),/COMPONENT_MATCH_LIMIT/);
 assert.equal(bestComponentAssignment([one,one],[one,one]).ambiguous,true);
});
