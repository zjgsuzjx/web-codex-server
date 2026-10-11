import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remainingPercent, quotaBuckets, mergeQuota, windowLabel } from '../shared/usage.js';
import { createDeltaBuffer, applyDeltas } from '../src/deltas.js';

test('remaining quota preserves unknown values and clamps returned percentages', () => {
  assert.equal(remainingPercent({ usedPercent: 25 }), 75);
  assert.equal(remainingPercent({ usedPercent: 0 }), 100);
  assert.equal(remainingPercent({ usedPercent: 100 }), 0);
  assert.equal(remainingPercent({ usedPercent: 130 }), 0);
  for(const value of [undefined,null,{}, {usedPercent:null}, {usedPercent:NaN}])assert.equal(remainingPercent(value),null);
  const snapshots={rateLimits:{limitId:'legacy'},rateLimitsByLimitId:{codex:{primary:{usedPercent:25}},other:{limitId:'other'}}};
  assert.deepEqual(quotaBuckets(snapshots).map(x=>x.limitId),['codex','other']);
  assert.equal(windowLabel(300),'5 小时窗口');assert.equal(windowLabel(10080),'1 周窗口');assert.equal(windowLabel(null),'额度窗口');
});
test('sparse quota updates preserve known reset times, metadata, and other buckets',()=>{
  const snapshot={rateLimits:{limitId:'codex',limitName:'Codex',primary:{usedPercent:25,resetsAt:10},secondary:{usedPercent:5},credits:{balance:'20'}},rateLimitsByLimitId:{other:{limitId:'other',primary:{usedPercent:2}}}};
  const updated=mergeQuota(snapshot,{rateLimits:{limitId:'codex',limitName:null,primary:{usedPercent:31,resetsAt:20},secondary:null,credits:null}});
  assert.equal(updated.rateLimits.limitName,'Codex');assert.equal(updated.rateLimits.primary.usedPercent,31);assert.equal(updated.rateLimits.primary.resetsAt,20);assert.equal(updated.rateLimits.secondary.usedPercent,5);assert.equal(updated.rateLimits.credits.balance,'20');assert.equal(updated.rateLimitsByLimitId.other.primary.usedPercent,2);
  assert.equal(snapshot.rateLimits.primary.usedPercent,25);
});
test('stream batching reduces 100 events to one render without losing output or changing history',()=>{
  let callback, next=0; const deliveries=[];
  const timers={setTimeout(fn){callback=fn;return ++next;},clearTimeout(){}};
  const buffer=createDeltaBuffer((batch,urgent)=>deliveries.push({batch,urgent}),50,timers);
  for(let n=0;n<100;n++)buffer.push({method:'item/agentMessage/delta',params:{turnId:'current',itemId:'agent',delta:String(n)+','}});
  assert.equal(next,1);callback();assert.equal(deliveries.length,1);assert.equal(deliveries[0].batch.length,1);
  const old={id:'old',items:[{id:'unchanged',text:'history'}]}, agent={id:'agent',text:''}, turns=[old,{id:'current',items:[agent,{id:'other',text:'keep'}]}];
  const result=applyDeltas(turns,deliveries[0].batch);
  assert.equal(result[0],old);assert.equal(result[1].items[1],turns[1].items[1]);assert.equal(result[1].items[0].text,Array.from({length:100},(_,n)=>n+',').join(''));assert.equal(agent.text,'');
  buffer.push({method:'item/commandExecution/outputDelta',params:{turnId:'current',itemId:'agent',delta:'tool'}});buffer.flush(true);assert.equal(deliveries[1].urgent,true);
  buffer.push({method:'item/agentMessage/delta',params:{turnId:'current',itemId:'agent',delta:'discard'}});buffer.clear();buffer.flush();assert.equal(deliveries.length,2);
});
