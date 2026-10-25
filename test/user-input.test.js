import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PendingRequests } from '../server/pending-requests.js';
import { answerResult, hasAnswer, keepRequestOnTurn } from '../shared/user-input.js';
import { AsyncUserInputs } from '../server/async-user-input.js';
import { CodexManager } from '../server/codex.js';
import { Duplex } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';

const request = (id = 42, ms = null, threadId = 'thread') => ({ id, method: 'item/tool/requestUserInput', params: { threadId, turnId: 'turn', autoResolutionMs: ms, questions: [{ id: 'choice', options: [{ label: 'A' }, { label: 'B' }], isOther: true }, { id: 'text', options: null, isSecret: true }] } });
const asyncQuestion = (threadId = 'thread', turnId = 'turn', id = 'async-call') => ({ method: 'item/completed', params: { threadId, turnId, item: { id, type: 'agentMessage', delivery: 'async', text: 'Rendered question text', questions: [{ title: 'Which environment reproduces this?', options: ['Editor', 'Build'] }, { title: 'Additional details?' }] } } });

test('async questions use structured metadata, require explicit answers, and survive normal turn transitions', async () => {
  const sent=[],resolved=[],queue=new AsyncUserInputs(async(r,text)=>sent.push({r,text}),p=>resolved.push(p));
  const event=asyncQuestion();
  assert.equal(queue.observe({...event,params:{...event.params,item:{...event.params.item,delivery:undefined}}}),undefined);
  assert.equal(queue.observe({...event,params:{...event.params,item:{...event.params.item,questions:undefined}}}),undefined);
  assert.equal(queue.observe({...event,params:{...event.params,item:{...event.params.item,questions:[{title:'Bad',options:[42]}]}}}),undefined);
  const r=queue.observe(event),questions=r.params.questions;
  assert.equal(r.params.isBlocking,false);assert.equal(r.expiresAt,null);
  assert.deepEqual(questions[0].options.map(o=>o.label),['Editor','Build']);assert.equal(questions[0].isOther,true);
  assert.equal(hasAnswer(questions[0],{}),false);
  assert.equal(queue.observe(event),undefined);
  for(const transition of [{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}},{method:'turn/started',params:{threadId:'thread',turn:{id:'next'}}}]) {
    assert.ok(keepRequestOnTurn(r,transition));queue.observe(transition);assert.equal(queue.requests.size,1);
  }
  await assert.rejects(queue.reply(r.id,{answers:{}}),/全部问题/);
  await assert.rejects(queue.reply(r.id,{answers:{unknown:{answers:['invalid']}}}),/格式/);
  const result=answerResult(questions,{question_1:{option:'Build'},question_2:{custom:true,text:'fixture details'}});
  await queue.reply(r.id,result);
  assert.match(sent[0].text,/Which environment reproduces this\?\n回答：Build/);assert.match(sent[0].text,/fixture details/);
  assert.equal(resolved[0].reason,'answered');assert.equal(queue.requests.size,0);
  assert.equal(queue.observe(event),undefined);await assert.rejects(queue.reply(r.id,result),/失效/);
  assert.equal(keepRequestOnTurn(request(),{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}}),false);
});

test('async replies reject duplicate submissions, retain failed answers for retry, and cancel on interruption/loss', async () => {
  let finish;const sent=[],resolved=[],queue=new AsyncUserInputs((r,text)=>{sent.push(text);return new Promise((resolve,reject)=>finish={resolve,reject});},p=>resolved.push(p));
  const r=queue.observe(asyncQuestion()),result={answers:{question_1:{answers:['custom environment']},question_2:{answers:['details']}}};
  const first=queue.reply(r.id,result);await assert.rejects(queue.reply(r.id,result),/正在提交/);
  finish.reject(Error('temporary failure'));await assert.rejects(first,/temporary failure/);assert.equal(queue.requests.size,1);assert.equal(resolved.length,0);
  const retry=queue.reply(r.id,result);finish.resolve();await retry;assert.equal(sent.length,2);assert.equal(resolved.length,1);
  for(const status of ['interrupted','failed']) {
    const pending=queue.observe(asyncQuestion('thread','turn',status));
    queue.observe({method:'turn/completed',params:{threadId:'thread',turn:{id:'other',status}}});assert.ok(queue.requests.has(pending.id));
    queue.observe({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status}}});assert.equal(queue.requests.size,0);
  }
  queue.observe(asyncQuestion('thread','turn','lost'));queue.observe({method:'connection/lost'});assert.equal(queue.requests.size,0);
});

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

test('native questions reach connected and reconnected pages and reply to the same running turn', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-questions-web-')), replies = [], threads = new Map(), pages = [];
  const app = await createApp({ dataDir: dir, inviteCode: '', codexFactory: (config, emit) => {
    const instances = new Map();
    const ensure = async user => {
      if (!instances.has(user.id)) {
        const queue = new PendingRequests(message => {
          replies.push(message);
          const thread = threads.get('question-thread'), turn = thread.turns[0];
          turn.status = 'completed'; turn.items.push({ id: 'answer', type: 'agentMessage', text: '已收到回答，继续执行并完成任务。' });
          queueMicrotask(() => emit(user.id, { method: 'turn/completed', params: { threadId: thread.id, turn } }));
        }, params => emit(user.id, { method: 'serverRequest/resolved', params }));
        instances.set(user.id, { requests: queue.requests, queue, loaded: new Set() });
      }
      return instances.get(user.id);
    };
    return { instances, ensure, async resume() {}, async generateTitle() { return '问答验证'; }, async stopIdle() {}, async shutdown() { for (const inst of instances.values()) inst.queue.dispose(); }, async reply(user, id, result) { (await ensure(user)).queue.reply(id, result); }, async call(user, method, params) {
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'thread/start') { const thread = { id: 'question-thread', turns: [] }; threads.set(thread.id, thread); return { thread }; }
      if (method === 'thread/read') return { thread: threads.get(params.threadId) };
      if (method === 'turn/start') {
        const inst = await ensure(user), turn = { id: 'paused-turn', status: 'inProgress', items: [] };
        threads.get(params.threadId).turns.push(turn);
        emit(user.id, { method: 'turn/started', params: { threadId: params.threadId, turn } });
        const message = request('native-question', null, params.threadId); message.params.turnId = turn.id;
        emit(user.id, inst.queue.add(message));
        return { turn };
      }
      return {};
    } };
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`; app.config.publicUrl = base;
  let cookie, csrf;
  const post = async (url, body) => { const response = await fetch(`${base}/api${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}) }, body: JSON.stringify(body) }); assert.ok(response.ok); return response; };
  async function connect() {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?csrf=${csrf}`, { headers: { Cookie: cookie, Origin: base } }), messages = [];
    ws.on('message', data => messages.push(JSON.parse(data))); pages.push(ws);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const wait = async predicate => { for (let n = 0; n < 200; n++) { const index = messages.findIndex(predicate); if (index >= 0) return messages.splice(index, 1)[0]; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('WebSocket event timeout'); };
    return { ws, wait, ready: await wait(message => message.type === 'ready') };
  }
  try {
    const registration = await post('/register', { username: 'QuestionTest', password: 'synthetic-password-42' });
    cookie = registration.headers.get('set-cookie').split(';')[0]; csrf = (await registration.json()).user.csrf;
    const project = await (await post('/projects', { name: '问答测试' })).json();
    const thread = await (await post('/threads', { projectId: project.id })).json();
    const first = await connect();
    first.ws.send(JSON.stringify({ id: 1, method: 'turn/start', params: { threadId: thread.id, text: '执行中请求补充信息' } }));
    const incoming = (await first.wait(message => message.event?.id === 'native-question')).event;
    const started = await first.wait(message => message.id === 1);
    assert.equal(started.result.turn.id, 'paused-turn'); assert.equal(started.result.turn.status, 'inProgress');
    assert.equal(incoming.method, 'item/tool/requestUserInput'); assert.equal(incoming.params.turnId, 'paused-turn');
    const second = await connect();
    assert.equal(second.ready.pending.length, 1); assert.deepEqual(second.ready.pending[0], incoming);
    const result = { answers: { choice: { answers: ['B'] }, text: { answers: ['补充说明'] } } };
    second.ws.send(JSON.stringify({ id: 2, method: 'approval/reply', params: { requestId: 'native-question', result } }));
    assert.deepEqual((await second.wait(message => message.id === 2)).result, { ok: true });
    for (const page of [first, second]) {
      assert.equal((await page.wait(message => message.event?.method === 'serverRequest/resolved')).event.params.requestId, 'native-question');
      const completed = (await page.wait(message => message.event?.method === 'turn/completed')).event;
      assert.equal(completed.params.turn.id, 'paused-turn'); assert.equal(completed.params.turn.status, 'completed');
    }
    assert.deepEqual(replies, [{ id: 'native-question', result }]);
    assert.equal((await connect()).ready.pending.length, 0);
    assert.equal(threads.get(thread.id).turns.length, 1);
  } finally {
    for (const ws of pages) ws.terminate(); await app.close(); await fs.rm(dir, { recursive: true, force: true });
  }
});

test('structured async questions reach all pages, survive completion, and deliver answers through authenticated user turns', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sv-async-questions-')),threads=new Map(),pages=[],inputs=[];
  let publish,sequence=0,failNext=false,nativeReplies=0;
  const app=await createApp({dataDir:dir,inviteCode:'async-fixture-invite',codexFactory:(config,emit)=>{
    publish=emit;
    return {instances:new Map(),async resume(){},async stopIdle(){},async shutdown(){},async reply(){nativeReplies++;throw Error('Async answers must not be JSON-RPC replies');},async call(u,method,p){
      if(method==='account/read')return {account:{type:'chatgpt'}};
      if(method==='thread/start'){const thread={id:'async-thread',turns:[]};threads.set(thread.id,thread);return {thread};}
      if(method==='thread/read')return {thread:threads.get(p.threadId)};
      if(method==='turn/start'){
        if(failNext){failNext=false;throw Error('Synthetic send failure');}
        const thread=threads.get(p.threadId),text=p.input[0].text;inputs.push({uid:u.id,text});
        let turn=thread.turns.find(t=>t.status==='inProgress');
        if(!turn){turn={id:`turn-${++sequence}`,status:'inProgress',items:[]};thread.turns.push(turn);emit(u.id,{method:'turn/started',params:{threadId:thread.id,turn}});}
        turn.items.push({id:`user-${inputs.length}`,type:'userMessage',content:p.input});
        if(text==='ask')emit(u.id,asyncQuestion(thread.id,turn.id,`async-${turn.id}`));
        return {turn};
      }
      return {};
    }};
  }});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;app.config.publicUrl=base;
  let cookie,csrf;
  const post=async(url,body)=>{const response=await fetch(`${base}/api${url}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{})},body:JSON.stringify(body)});assert.ok(response.ok);return response;};
  async function connect(){
    const ws=new WebSocket(`${base.replace('http','ws')}/ws?csrf=${csrf}`,{headers:{Cookie:cookie,Origin:base}}),messages=[];pages.push(ws);ws.on('message',data=>messages.push(JSON.parse(data)));
    await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    const wait=async predicate=>{for(let n=0;n<200;n++){const i=messages.findIndex(predicate);if(i>=0)return messages.splice(i,1)[0];await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Async WebSocket event timeout');};
    return {ws,wait,ready:await wait(m=>m.type==='ready'),call:async(id,method,params)=>{ws.send(JSON.stringify({id,method,params}));return wait(m=>m.id===id);}};
  }
  try{
    const registration=await post('/register',{username:'AsyncQuestionTest',password:'synthetic-password-42',inviteCode:'async-fixture-invite'});cookie=registration.headers.get('set-cookie').split(';')[0];const user=(await registration.json()).user;csrf=user.csrf;
    const project=await(await post('/projects',{name:'异步问答测试'})).json(),thread=await(await post('/threads',{projectId:project.id})).json();
    const first=await connect();await first.call(1,'turn/start',{threadId:thread.id,text:'ask'});
    const question=(await first.wait(m=>m.event?.method==='item/agentMessage/requestUserInput')).event;
    const second=await connect();assert.deepEqual(second.ready.pending,[question]);
    const result={answers:{question_1:{answers:['Build']},question_2:{answers:['fixture details']}}};
    assert.equal((await second.call(2,'approval/reply',{requestId:question.id,result})).result.ok,true);
    for(const page of [first,second])assert.equal((await page.wait(m=>m.event?.method==='serverRequest/resolved')).event.params.requestId,question.id);
    assert.equal(threads.get(thread.id).turns.length,1);assert.match(inputs.at(-1).text,/回答：Build/);assert.equal(nativeReplies,0);
    const original=threads.get(thread.id).turns[0];original.status='completed';publish(user.id,{method:'turn/completed',params:{threadId:thread.id,turn:original}});
    await first.call(3,'turn/start',{threadId:thread.id,text:'ask'});
    const later=(await first.wait(m=>m.event?.method==='item/agentMessage/requestUserInput')).event;
    const completed=threads.get(thread.id).turns[1];completed.status='completed';publish(user.id,{method:'turn/completed',params:{threadId:thread.id,turn:completed}});
    assert.equal((await connect()).ready.pending[0].id,later.id);
    failNext=true;assert.match((await first.call(4,'approval/reply',{requestId:later.id,result})).error.message,/Synthetic send failure/);
    assert.equal((await connect()).ready.pending[0].id,later.id);
    assert.equal((await first.call(5,'approval/reply',{requestId:later.id,result})).result.ok,true);
    assert.equal(threads.get(thread.id).turns.length,3);assert.equal((await connect()).ready.pending.length,0);
    assert.match((await first.call(6,'approval/reply',{requestId:later.id,result})).error.message,/失效/);assert.equal(nativeReplies,0);
    // A different account cannot submit this account's server-generated ID.
    await first.call(7,'turn/start',{threadId:thread.id,text:'ask'});
    const privateQuestion=(await first.wait(m=>m.event?.method==='item/agentMessage/requestUserInput')).event;
    cookie=undefined;csrf=undefined;
    const otherRegistration=await post('/register',{username:'OtherAsyncTest',password:'synthetic-password-43',inviteCode:'async-fixture-invite'});cookie=otherRegistration.headers.get('set-cookie').split(';')[0];csrf=(await otherRegistration.json()).user.csrf;
    const other=await connect();assert.equal(other.ready.pending.length,0);assert.match((await other.call(8,'approval/reply',{requestId:privateQuestion.id,result})).error.message,/失效/);assert.equal(inputs.length,5);
    assert.equal((await first.call(9,'approval/reply',{requestId:privateQuestion.id,result})).result.ok,true);
    // CLI-owned child threads need no web conversation-list entry to answer.
    threads.set('async-child',{id:'async-child',turns:[]});publish(user.id,asyncQuestion('async-child','child-turn'));
    const childQuestion=(await first.wait(m=>m.event?.method==='item/agentMessage/requestUserInput')).event;
    assert.equal((await first.call(10,'approval/reply',{requestId:childQuestion.id,result})).result.ok,true);
    assert.equal(threads.get('async-child').turns.length,1);assert.equal(inputs.at(-1).uid,user.id);assert.equal(nativeReplies,0);
  }finally{for(const ws of pages)ws.terminate();await app.close();await fs.rm(dir,{recursive:true,force:true});}
});
