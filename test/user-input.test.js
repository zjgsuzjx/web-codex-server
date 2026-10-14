import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PendingRequests } from '../server/pending-requests.js';
import { answerResult, hasAnswer } from '../shared/user-input.js';
import { CodexManager } from '../server/codex.js';
import { Duplex } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const request = (id = 42, ms = null, threadId = 'thread') => ({ id, method: 'item/tool/requestUserInput', params: { threadId, turnId: 'turn', autoResolutionMs: ms, questions: [{ id: 'choice', options: [{ label: 'A' }, { label: 'B' }], isOther: true }, { id: 'text', options: null, isSecret: true }] } });

test('questions require explicit answers and retain custom/secret responses without default assent', () => {
  const questions=request().params.questions;
  assert.equal(hasAnswer(questions[0],{}),false);
  assert.equal(hasAnswer(questions[0],{option:'unlisted'}),false);
  const drafts={choice:{option:'A',custom:true,text:' custom answer '},text:{custom:true,text:' secret value '}};
  assert.deepEqual(answerResult(questions,drafts),{answers:{choice:{answers:['custom answer']},text:{answers:[' secret value ']}}});
  assert.equal(hasAnswer(questions[0],drafts.choice),true);
  assert.deepEqual(answerResult(questions,{}),{answers:{choice:{answers:[]},text:{answers:[]}}});
});

test('server deadline survives reconnect snapshots; timeout replies once with no assumed choice', t => {
  t.mock.timers.enable({ apis: ['Date','setTimeout'] });
  const sent=[],resolved=[],queue=new PendingRequests(m=>sent.push(m),p=>resolved.push(p));
  const original=queue.add(request(42,60000));
  t.mock.timers.tick(20000);
  assert.equal(queue.add(request(42,60000)).expiresAt,original.expiresAt);
  assert.equal([...queue.requests.values()][0].expiresAt,original.expiresAt);
  t.mock.timers.tick(40000);
  assert.deepEqual(sent,[{id:42,result:{answers:{}}}]);
  assert.equal(resolved[0].reason,'timeout');assert.equal(queue.requests.size,0);
  assert.throws(()=>queue.reply(42,{answers:{}}),/失效/);
  t.mock.timers.tick(60000);assert.equal(sent.length,1);queue.dispose();
});

test('one tab answering resolves all tabs; completed turns and process loss clear pending timers', t => {
  t.mock.timers.enable({ apis: ['Date','setTimeout'] });
  const sent=[],resolved=[],queue=new PendingRequests(m=>sent.push(m),p=>resolved.push(p));
  queue.add(request(42,10000));queue.reply('42',{answers:{choice:{answers:['B']},text:{answers:['details']}}});
  assert.equal(resolved[0].requestId,42);assert.equal(resolved[0].reason,'answered');
  assert.throws(()=>queue.reply(42,{answers:{}}),/失效/);
  queue.add(request(43,10000));queue.add(request(44,null,'other'));queue.clearThread('thread','turn');
  t.mock.timers.tick(10000);assert.equal(sent.length,1);assert.equal(queue.requests.size,1);
  t.mock.timers.tick(500000);assert.equal(queue.requests.size,1);
  queue.add(request(45,10000));queue.dispose();t.mock.timers.tick(10000);assert.equal(sent.length,1);
});

test('malformed and unlisted answers cannot resolve a prompt; a past deadline rejects late replies', t => {
  t.mock.timers.enable({ apis: ['Date','setTimeout'] });
  const sent=[],queue=new PendingRequests(m=>sent.push(m),()=>{}),message=request(42,10000);message.params.questions[0].isOther=false;
  queue.add(message);
  for (const result of [{},{answers:[]},{answers:{unknown:{answers:['A']}}},{answers:{choice:{answers:['unlisted']}}},{answers:{choice:{answers:['A','B']}}}]) assert.throws(()=>queue.reply(42,result),/格式|提供/);
  assert.equal(queue.requests.size,1);
  t.mock.timers.setTime(10001);
  assert.throws(()=>queue.reply(42,{answers:{choice:{answers:['A']}}}),/时间/);
  assert.deepEqual(sent,[{id:42,result:{answers:{}}}]);queue.dispose();
});

test('manager starts both execution targets with native questions enabled and routes real JSON-RPC request lifecycles', async t => {
  for (const target of ['workspace','server']) await t.test(target, async () => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sv-questions-manager-')),sent=[],events=[];
    const user={id:'u',username:'testuser',role:'superadmin',settings:JSON.stringify({executionTarget:target})};
    let command,notifyResolved;
    const stream=new Duplex({read(){},write(data,encoding,done){const message=JSON.parse(data);sent.push(message);if(message.method==='initialize')queueMicrotask(()=>this.push(JSON.stringify({id:message.id,result:{}})+'\n'));done();}});
    const incoming=message=>stream.push(JSON.stringify(message)+'\n');
    const manager=new CodexManager({dataDir:dir,hostDataDir:'/srv/app/data',templateDir:path.join(dir,'template'),enableHostExecution:true,hostCodexScript:'/opt/codex.js',workerImage:'worker',workerMemory:384,maxWorkers:2},(uid,message)=>{assert.equal(uid,'u');events.push(message);if(message.params?.reason==='timeout')notifyResolved?.();});
    manager.prepareHome=async()=>{};
    manager.docker={getContainer(){return {modem:{demuxStream(source,stdout){source.on('data',chunk=>stdout.write(chunk));}},async inspect(){return {HostConfig:{NetworkMode:target==='server'?'host':'bridge',Privileged:target==='server'},Config:{Labels:{'starvalley.execution':target}},State:{Running:true}};},async exec(options){command=options.Cmd;return {async start(){return stream;}};}};},modem:{demuxStream(source,stdout){source.on('data',chunk=>stdout.write(chunk));}}};
    try {
      const inst=await manager.ensure(user);
      assert.ok(command.includes('features.default_mode_request_user_input=true'));
      assert.equal(command.includes('nsenter'),target==='server');
      incoming(request(200,null));assert.equal(inst.requests.size,1);
      await manager.reply(user,'200',{answers:{choice:{answers:['A']},text:{answers:['provided']}}});
      assert.equal(sent.at(-1).id,200);assert.equal(events.at(-1).method,'serverRequest/resolved');
      const timeout=new Promise(resolve=>{notifyResolved=resolve;});incoming(request(201,10));await timeout;
      assert.deepEqual(sent.at(-1),{id:201,result:{answers:{}}});assert.equal(inst.requests.size,0);
      incoming(request(202,null));incoming({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'interrupted'}}});assert.equal(inst.requests.size,0);
      incoming(request(203,10000));manager.drop(user.id);assert.equal(inst.requests.size,0);assert.equal(events.at(-1).method,'connection/lost');
    } finally {manager.drop(user.id);stream.destroy();await fs.rm(dir,{recursive:true,force:true});}
  });
});
