import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLifecycle, applyDeltas, mergeTurns } from '../src/deltas.js';
import { contextUsage } from '../shared/context.js';

test('partial completion and empty item snapshots keep user messages and streamed reasoning',()=>{
  let turns=[{id:'turn',status:'inProgress',items:[{id:'user',type:'userMessage',content:[{type:'text',text:'hello'}]}]}];
  turns=applyDeltas(turns,[{method:'item/reasoning/summaryTextDelta',params:{turnId:'turn',itemId:'reason',delta:'Analyzing the bug'}}]);
  turns=applyLifecycle(turns,{method:'item/completed',params:{turnId:'turn',item:{id:'reason',type:'reasoning',summary:[],content:[]}}});
  turns=applyLifecycle(turns,{method:'turn/completed',params:{turn:{id:'turn',status:'completed',items:[{id:'answer',type:'agentMessage',text:'Fixed'}]}}});
  assert.equal(turns[0].items.length,3);assert.equal(turns[0].items[0].content[0].text,'hello');assert.equal(turns[0].items[1].streamedReasoning,'Analyzing the bug');
  turns=mergeTurns(turns,[{id:'turn',status:'inProgress',items:[]}]);assert.equal(turns[0].status,'completed');assert.equal(turns[0].items.length,3);
});
test('late history merges with live events and never duplicates items or turns',()=>{
  const live=[{id:'t',status:'completed',items:[{id:'u',type:'userMessage',attachments:[{id:'a'}]},{id:'a',type:'agentMessage',text:'Done'}]}];
  const result=mergeTurns(live,[{id:'t',status:'inProgress',items:[{id:'u',type:'userMessage',content:[]},{id:'a',type:'agentMessage',text:''}]}]);
  assert.equal(result.length,1);assert.equal(result[0].items.length,2);assert.equal(result[0].items[1].text,'Done');assert.equal(result[0].items[0].attachments[0].id,'a');
});
test('context shows latest request instead of cumulative history and keeps unknown values unknown',()=>{
  assert.deepEqual(contextUsage({last:{totalTokens:1000},total:{totalTokens:90000},modelContextWindow:20000}),{used:1000,limit:20000,percent:5});
  assert.deepEqual(contextUsage({total:{totalTokens:90000}}),{used:null,limit:null,percent:null});
  assert.equal(contextUsage({last:{totalTokens:0},modelContextWindow:20000}).percent,0);
});
