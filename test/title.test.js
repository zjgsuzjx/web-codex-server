import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodexManager } from '../server/codex.js';

test('title generation uses the selected model and a temporary conversation, then unsubscribes',async()=>{
  const manager=new CodexManager({},()=>{}),inst={titles:new Map(),hidden:new Set()},calls=[];
  manager.ensure=async()=>inst;
  manager.raw=async(i,method,params)=>{
    calls.push({method,params});
    if(method==='thread/start')return {thread:{id:'temporary'}};
    if(method==='turn/start'){queueMicrotask(()=>inst.titles.get('temporary').resolve('{"title":"修复聊天附件"}'));return {turn:{id:'title-turn'}};}
    return {};
  };
  const title=await manager.generateTitle({id:'u',settings:'{"model":"selected-model"}'},'User: fix chat\nAssistant: fixed');
  assert.equal(title,'修复聊天附件');assert.equal(calls[0].params.model,'selected-model');assert.equal(calls[0].params.ephemeral,true);assert.equal(calls[0].params.sandbox,'read-only');assert.ok(inst.hidden.has('temporary'));assert.equal(inst.titles.size,0);assert.equal(calls.at(-1).method,'thread/unsubscribe');assert.ok(calls[1].params.outputSchema);
});
test('failed or malformed title generation releases listeners and leaves no background timeout',async()=>{
  const manager=new CodexManager({},()=>{}),inst={titles:new Map(),hidden:new Set()},calls=[];manager.ensure=async()=>inst;
  manager.raw=async(i,method)=>{calls.push(method);if(method==='thread/start')return {thread:{id:'temporary'}};if(method==='turn/start'){queueMicrotask(()=>inst.titles.get('temporary').resolve('not json'));}return {};};
  await assert.rejects(manager.generateTitle({id:'u',settings:'{}'},'conversation'));assert.equal(inst.titles.size,0);assert.equal(calls.at(-1),'thread/unsubscribe');
});
