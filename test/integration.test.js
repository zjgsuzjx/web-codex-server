import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { relativePath, safePath, anchored, safeRemove } from '../server/files.js';
import { zipSync, unzipSync } from 'fflate';

function mockCodex(config, emit) {
  const threads = new Map(), calls = [];
  return { calls, instances: new Map(), emit, threads, async generateTitle(u, exchange) { calls.push({method:'generateTitle',params:{exchange}}); return '改善工作区体验'; }, async ensure() {}, async resume() {}, async restart() {}, async stopIdle() {}, async shutdown() {}, async reply() {}, async call(u, method, params) {
    calls.push({ method, params });
    if (method === 'thread/start') { const thread = { id: randomUUID(), turns: [] }; threads.set(thread.id, thread); return { thread }; }
    if (method === 'thread/read') return { thread: threads.get(params.threadId) };
    if (method === 'thread/turns/list') {
      const turns = threads.get(params.threadId).turns, ordered = params.sortDirection === 'asc' ? [...turns] : [...turns].reverse();
      const start = params.cursor ? ordered.findIndex(turn => turn.id === params.cursor) + 1 : 0;
      const data = ordered.slice(start, start + params.limit);
      return { data, nextCursor: start + data.length < turns.length ? data.at(-1).id : null };
    }
    if (method === 'thread/fork') { const thread = { ...structuredClone(threads.get(params.threadId)), id: randomUUID() }; threads.set(thread.id, thread); return { thread }; }
    if (method === 'account/read') return { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
    if (method === 'account/rateLimits/read') return { rateLimits: { limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: { usedPercent: 7, windowDurationMins: 10080 } } };
    if (method === 'turn/start') { const turn = { id: randomUUID(), status: 'inProgress', items: [{id:randomUUID(),type:'userMessage',content:params.input}] }; threads.get(params.threadId).turns.push(turn); emit(u.id, { method: 'turn/started', params: { threadId: params.threadId, turn } }); return { turn }; }
    return {};
  } };
}
async function socket(base, session, origin = base) {
  const ws = new WebSocket(base.replace('http','ws') + '/ws?csrf=' + session.csrf, { headers: { Cookie: session.cookie, Origin: origin } });
  let id = 1; const waiters = new Map(); const inbox = [];
  ws.on('message', buf => { const m = JSON.parse(buf); const key = m.id ?? m.type; const q = waiters.get(key); if (q) { waiters.delete(key); m.error && m.id ? q.reject(Object.assign(new Error(m.error.message),m.error)) : q.resolve(m); } else inbox.push(m); });
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  const wait = key => new Promise((resolve,reject)=> { const i = inbox.findIndex(m=>(m.id??m.type)===key); if (i>=0) return resolve(inbox.splice(i,1)[0]); const timer=setTimeout(()=>reject(new Error('test timeout')),5000); waiters.set(key,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}}); });
  return { ws, async call(method,params={}) { const n=id++;const pending=wait(n);ws.send(JSON.stringify({id:n,method,params}));return (await pending).result; }, async chunk(buf){const pending=wait('upload/ack');ws.send(buf);return pending;}, wait, async close(){if(ws.readyState===WebSocket.CLOSED)return;const pending=new Promise(r=>ws.once('close',r));ws.close();await pending;} };
}

test('authenticated projects, safe files, websocket uploads, and Codex routing', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'sv-codex-test-'));
  const instance = await createApp({ dataDir: dir, inviteCode: 'test-invite-secret', quota: 50000, maxFile: 30000, enableHostExecution:true, hostCodexScript:'/opt/codex/bin/codex.js', codexFactory: mockCodex });
  await new Promise(r=>instance.server.listen(0,'127.0.0.1',r)); const base=`http://127.0.0.1:${instance.server.address().port}`; instance.config.publicUrl=base;
  const sessions=[]; const sockets=[];
  const request = async (url, method='GET', body, session, overrides={})=>{const r=await fetch(base+'/api'+url,{method,headers:{'Content-Type':'application/json',Origin:base,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...overrides},body:body?JSON.stringify(body):undefined});let data;try{data=await r.json();}catch{}return {status:r.status,data,headers:r.headers};};
  async function register(username){const r=await request('/register','POST',{username,password:'Very-good-password42',inviteCode:'test-invite-secret'});assert.equal(r.status,200);const s={...r.data.user,cookie:r.headers.get('set-cookie').split(';')[0]};sessions.push(s);return s;}
  try {
    await t.test('deployment health reports readiness without account or operation details', async () => {
      const idle = await fetch(base + '/api/health').then(r => r.json());
      assert.equal(idle.deploymentReady, true);
      for (const field of ['active', 'terminals', 'requests', 'pending']) {
        instance.codex.instances.set('deployment-check', { [field]: new Set(['private-operation']) });
        const busy = await fetch(base + '/api/health').then(r => r.json());
        assert.equal(busy.deploymentReady, false);
        assert.ok(!JSON.stringify(busy).includes('private-operation'));
        instance.codex.instances.delete('deployment-check');
      }
    });
    await t.test('registration requires invite; password is hashed; first user is superadministrator',async()=>{assert.equal((await request('/register','POST',{username:'Alice',password:'Very-good-password42',inviteCode:'wrong'})).status,403);const a=await register('Alice');assert.equal(a.username,'alice');assert.equal(a.role,'superadmin');assert.ok(!instance.store.user(a.id).password.includes('Very-good'));const b=await register('Bob');assert.equal(b.role,'user');assert.equal((await request('/admin/users','GET',null,b)).status,403);});
    const [a,b]=sessions;const p=(await request('/projects','POST',{name:'测试项目'},a)).data;
    await t.test('dashboard is authenticated and reports real capacity and cached account quota',async()=>{
      assert.equal((await request('/dashboard')).status,401);assert.equal((await request('/codex-usage')).status,401);
      const dashboard=await request('/dashboard','GET',null,a);assert.equal(dashboard.status,200);assert.equal(dashboard.data.storage.quota,50000);assert.equal(dashboard.data.storage.available,50000);assert.ok(dashboard.data.server.disk.total>0);assert.ok(dashboard.data.server.memory.total>0);assert.ok(dashboard.data.server.disk.available>=0);
      const before=instance.codex.calls.filter(x=>x.method==='account/rateLimits/read').length;
      const limits=await request('/codex-usage','GET',null,a);assert.equal(limits.status,200);assert.equal(limits.data.status,'available');assert.equal(limits.data.snapshot.rateLimits.primary.usedPercent,25);
      await request('/codex-usage','GET',null,a);assert.equal(instance.codex.calls.filter(x=>x.method==='account/rateLimits/read').length,before+1);
      assert.ok(!JSON.stringify(dashboard.data).includes('alice'));
    });
    await t.test('authentication, CSRF, origin, and cross-user access',async()=>{assert.equal((await request('/projects')).status,401);assert.equal((await request('/projects','POST',{name:'bad'},a,{'X-CSRF-Token':'bad'})).status,403);assert.equal((await request('/projects','POST',{name:'bad'},a,{Origin:'https://evil.example'})).status,403);assert.equal((await request(`/projects/${p.id}/files`,'GET',null,b)).status,404);assert.equal((await request('/projects','GET',null,b)).data.length,0);});
    await t.test('WebSocket rejects unauthenticated or foreign-origin handshake',async()=>{await assert.rejects(socket(base,a,'https://evil.example'));});
    const s=await socket(base,a);sockets.push(s);
    await t.test('binary websocket upload preserves folder paths and verifies content',async()=>{const task=await s.call('upload/begin',{projectId:p.id,path:'src/hello.txt',size:11});assert.equal((await s.chunk(Buffer.from('hello '))).offset,6);assert.equal((await s.chunk(Buffer.from('world'))).offset,11);const done=await s.call('upload/finish',{uploadId:task.uploadId});assert.match(done.sha256,/^[a-f0-9]{64}$/);assert.equal((await request(`/projects/${p.id}/file?path=src/hello.txt`,'GET',null,a)).data.content,'hello world');});
    await t.test('disconnect and resume upload at acknowledged offset',async()=>{const task=await s.call('upload/begin',{projectId:p.id,path:'resumed.txt',size:6});await s.chunk(Buffer.from('abc'));await s.close();const s2=await socket(base,a);sockets.push(s2);assert.equal((await s2.call('upload/resume',{uploadId:task.uploadId})).offset,3);await s2.chunk(Buffer.from('def'));await s2.call('upload/finish',{uploadId:task.uploadId});assert.equal((await request(`/projects/${p.id}/file?path=resumed.txt`,'GET',null,a)).data.content,'abcdef');});
    const s2=sockets.at(-1);
    await t.test('latency ping uses the authenticated gateway without starting a Codex worker', async () => {
      const before = instance.codex.calls.length;
      assert.deepEqual(await s2.call('connection/ping'), { ok: true });
      assert.equal(instance.codex.calls.length, before);
    });
    await t.test('quota accounts for reserved bytes across concurrent connections',async()=>{const other=await socket(base,a);sockets.push(other);const task=await s2.call('upload/begin',{projectId:p.id,path:'reserve-one',size:30000});await assert.rejects(other.call('upload/begin',{projectId:p.id,path:'reserve-two',size:25000}),/配额/);await s2.call('upload/cancel',{uploadId:task.uploadId});await other.close();});
    await t.test('path traversal, symlinks, quota, and oversized files are rejected',async()=>{for(const rel of ['../escape','/etc/passwd','a/../../b','a\\b','a//b'])await assert.rejects(s2.call('upload/begin',{projectId:p.id,path:rel,size:2}));await assert.rejects(s2.call('upload/begin',{projectId:p.id,path:'big.txt',size:30001}));const outside=path.join(dir,'outside');await fs.mkdir(outside);await fs.symlink(outside,path.join(dir,'users','alice','projects',p.id,'link'),process.platform==='win32'?'junction':'dir');assert.equal((await request(`/projects/${p.id}/file?path=link/secret`,'GET',null,a)).status,403);const task=await s2.call('upload/begin',{projectId:p.id,path:'reservation',size:30000});await assert.rejects(s2.call('upload/begin',{projectId:p.id,path:'second',size:1000}));await s2.call('upload/cancel',{uploadId:task.uploadId});});
    await t.test('unfinished and conflicting uploads do not overwrite existing files',async()=>{const task=await s2.call('upload/begin',{projectId:p.id,path:'src/hello.txt',size:2});await assert.rejects(s2.call('upload/finish',{uploadId:task.uploadId}));await s2.chunk(Buffer.from('XX'));await assert.rejects(s2.call('upload/finish',{uploadId:task.uploadId}),e=>e.code==='UPLOAD_CONFLICT'&&e.conflicts[0].path==='src/hello.txt');assert.equal((await request(`/projects/${p.id}/file?path=src/hello.txt`,'GET',null,a)).data.content,'hello world');const skipped=await s2.call('upload/finish',{uploadId:task.uploadId,conflictPolicy:'skip'});assert.equal(skipped.skipped,1);assert.equal(skipped.uploaded,0);});
    await t.test('editor uses optimistic concurrency and supports rename and deletion',async()=>{const file=(await request(`/projects/${p.id}/file?path=src/hello.txt`,'GET',null,a)).data;const saved=await request(`/projects/${p.id}/file`,'PUT',{path:'src/hello.txt',content:'modified',etag:file.etag},a);assert.equal(saved.status,200);assert.equal((await request(`/projects/${p.id}/file`,'PUT',{path:'src/hello.txt',content:'stale',etag:file.etag},a)).status,409);assert.equal((await request(`/projects/${p.id}/file`,'PATCH',{from:'src/hello.txt',to:'src/new.txt'},a)).status,200);assert.equal((await request(`/projects/${p.id}/file`,'DELETE',{path:'src/new.txt'},a)).status,200);});
    await t.test('directory download produces a zip; unauthorized user cannot download',async()=>{const r=await fetch(base+`/api/projects/${p.id}/download`,{headers:{Cookie:a.cookie,Origin:base}});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/zip');const buf=Buffer.from(await r.arrayBuffer());assert.equal(buf.subarray(0,2).toString(),'PK');assert.ok(buf.includes(Buffer.from('resumed.txt')));assert.equal((await request(`/projects/${p.id}/download`,'GET',null,b)).status,404);});
    await t.test('search inventories skip dot directories without changing the ordinary file tree', async () => {
      const fixture = path.join(dir, 'users', a.username, 'projects', p.id, 'search-fixture');
      await fs.mkdir(path.join(fixture, '.hidden', 'nested'), { recursive: true });
      await fs.writeFile(path.join(fixture, '.hidden', 'nested', 'secret.txt'), 'synthetic');
      await fs.writeFile(path.join(fixture, '.env'), 'synthetic');
      await fs.writeFile(path.join(fixture, 'visible.txt'), 'synthetic');
      try {
        const url = `/projects/${p.id}/files?path=search-fixture`;
        const ordinary = (await request(url, 'GET', null, a)).data;
        assert.ok(ordinary.some(entry => entry.path.includes('/.hidden/')));
        const search = await request(url + '&excludeHidden=true', 'GET', null, a);
        assert.equal(search.status, 200);
        assert.deepEqual(search.data.map(entry => entry.path), ['search-fixture/.env', 'search-fixture/visible.txt']);
        assert.deepEqual((await request(url + '/.hidden&excludeHidden=true', 'GET', null, a)).data, []);
        assert.equal((await request(url + '&excludeHidden=true', 'GET', null, b)).status, 404);
      } finally { await fs.rm(fixture, { recursive: true, force: true }); }
    });
    await t.test('file inventories and upload preflight enforce persisted role limits',async t=>{
      const own=(await request('/projects','POST',{name:'Count limits'},b)).data;
      const roots=new Set([path.resolve(dir,'users',a.username,'projects',p.id),path.resolve(dir,'users',b.username,'projects',own.id)]);
      const originalReaddir=fs.readdir.bind(fs),originalLstat=fs.lstat.bind(fs);
      let count=20001;
      const fakeStat={isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false,size:0,mtimeMs:1};
      t.mock.method(fs,'readdir',async(target,...args)=>{
        const resolved=String(target).startsWith('/proc/self/fd/')?await fs.realpath(target):path.resolve(String(target));
        if(!roots.has(resolved))return originalReaddir(target,...args);
        return Array.from({length:count},(_,i)=>({name:`count-fixture-${i}`,isSymbolicLink:()=>false,isDirectory:()=>false}));
      });
      t.mock.method(fs,'lstat',async(target,...args)=>String(target).includes('count-fixture-')?fakeStat:originalLstat(target,...args));
      assert.equal((await request(`/projects/${own.id}/files`,'GET',null,b)).data.length,20001);
      count=100001;
      assert.equal((await request(`/projects/${p.id}/files`,'GET',null,a)).data.length,100001);
      const limited=await request(`/projects/${own.id}/files`,'GET',null,b);assert.equal(limited.status,413);assert.match(limited.data.error,/100,000/);
      const member=await socket(base,b);sockets.push(member);
      const paths=['../escape',...Array(100000).fill('x')];
      // The superadmin passes the count check and still fails path validation.
      await assert.rejects(s2.call('upload/check',{projectId:p.id,paths}),e=>e.status===400&&/路径无效/.test(e.message));
      await assert.rejects(member.call('upload/check',{projectId:own.id,paths,role:'superadmin',maxEntries:null}),e=>e.status===413&&/100,000/.test(e.message));
      instance.store.run("UPDATE users SET role='admin' WHERE id=?",b.id);
      try{await assert.rejects(member.call('upload/check',{projectId:own.id,paths}),e=>e.status===413&&/100,000/.test(e.message));}
      finally{instance.store.run("UPDATE users SET role='user' WHERE id=?",b.id);}
      await member.close();
    });
    await t.test('Codex routes owned threads with the current protocol and isolates users',async()=>{const tr=await request('/threads','POST',{projectId:p.id},a);assert.equal(tr.status,201);assert.equal(instance.codex.calls.find(x=>x.method==='thread/start').params.sandbox,'danger-full-access');const sb=await socket(base,b);sockets.push(sb);await assert.rejects(sb.call('turn/start',{threadId:tr.data.id,text:'read other user'}));await s2.call('turn/start',{threadId:tr.data.id,text:'hello'});assert.equal(instance.codex.calls.at(-1).params.cwd,`/workspace/${p.id}`);assert.equal(instance.codex.calls.at(-1).params.sandboxPolicy.type,'externalSandbox');assert.equal(instance.codex.calls.at(-1).params.sandboxPolicy.networkAccess,'enabled');assert.equal((await request('/settings','PUT',{...a.settings,sandbox:'readOnly'},a)).status,400);assert.equal((await request('/settings','PUT',{...a.settings,effort:'ultra'},a)).status,200);await assert.rejects(s2.call('command/exec',{command:['sh']}));});
    await t.test('long conversations page newest turns first without reading the entire history', async () => {
      const tr = (await request('/threads', 'POST', { projectId: p.id }, a)).data;
      instance.store.run("UPDATE threads SET title_state='manual' WHERE id=?", tr.id);
      const turns = instance.codex.threads.get(tr.id).turns;
      for (let i = 0; i < 75; i++) turns.push({ id: `history-${i}`, status: 'completed', items: [{ id: `item-${i}`, type: 'agentMessage', text: `Answer ${i}` }] });
      const before = instance.codex.calls.length;
      const recent = await request(`/threads/${tr.id}`, 'GET', null, a);
      assert.equal(recent.status, 200);
      assert.deepEqual(recent.data.thread.turns.map(t => t.id), turns.slice(-8).map(t => t.id));
      assert.equal(recent.data.thread.turns.at(-1).items[0].text, 'Answer 74');
      const calls = instance.codex.calls.slice(before);
      assert.equal(calls.find(c => c.method === 'thread/read').params.includeTurns, false);
      assert.deepEqual(calls.find(c => c.method === 'thread/turns/list').params, { threadId: tr.id, limit: 8, sortDirection: 'desc', itemsView: 'full' });
      // A newer live turn must not shift the older cursor or introduce gaps.
      turns.push({ id: 'new-live', status: 'inProgress', items: [] });
      let cursor = recent.data.nextCursor, seen = [...recent.data.thread.turns.map(t => t.id)];
      const pageStart = instance.codex.calls.length;
      while (cursor) {
        const page = await request(`/threads/${tr.id}?limit=16&cursor=${encodeURIComponent(cursor)}`, 'GET', null, a);
        assert.equal(page.status, 200); assert.ok(page.data.thread.turns.length <= 16);
        seen = [...page.data.thread.turns.map(t => t.id), ...seen]; cursor = page.data.nextCursor;
      }
      assert.deepEqual(seen, turns.slice(0, 75).map(t => t.id));
      assert.ok(instance.codex.calls.slice(pageStart).every(c => c.method === 'thread/turns/list'));
      assert.equal((await request(`/threads/${tr.id}?cursor=history-67`, 'GET', null, b)).status, 404);
      assert.equal((await request(`/threads/${tr.id}`)).status, 401);
      for (const query of ['limit=0', 'limit=33', 'limit=1.5', 'limit=abc', 'cursor=', `cursor=${'x'.repeat(4097)}`]) assert.equal((await request(`/threads/${tr.id}?${query}`, 'GET', null, a)).status, 400);
    });
    await t.test('only superadmins assign roles; changes revoke sessions; the last owner cannot be demoted',async()=>{
      assert.equal((await request(`/admin/users/${b.id}/role`,'PATCH',{role:'superadmin'},b)).status,403);
      assert.equal((await request(`/admin/users/${a.id}/role`,'PATCH',{role:'admin'},a)).status,409);
      assert.equal((await request(`/admin/users/${b.id}/role`,'PATCH',{role:'admin'},a)).status,200);
      assert.equal((await request('/projects','GET',null,b)).status,401);
      const logged=await request('/login','POST',{username:'bob',password:'Very-good-password42'});
      Object.assign(b,logged.data.user,{cookie:logged.headers.get('set-cookie').split(';')[0]});
      assert.equal(b.role,'admin');assert.equal((await request('/admin/users','GET',null,b)).status,200);
      assert.equal((await request(`/admin/users/${b.id}/role`,'PATCH',{role:'superadmin'},b)).status,403);
      assert.equal((await request('/settings','PUT',{...b.settings,executionTarget:'server'},b)).status,403);
      assert.equal(instance.store.user(b.id).role,'admin');
    });
    await t.test('server mode uses a real host cwd and full access only for superadmins',async()=>{
      assert.equal((await request('/settings','PUT',{...a.settings,executionTarget:'server'},a)).status,200);
      const tr=await request('/threads','POST',{projectId:p.id},a);
      await s2.call('turn/start',{threadId:tr.data.id,text:'Read server status'});
      const last=instance.codex.calls.at(-1);assert.equal(last.params.sandboxPolicy.type,'dangerFullAccess');
      assert.equal(last.params.cwd,path.posix.join(instance.config.hostDataDir.replaceAll('\\','/'),'users','alice','projects',p.id));
      assert.equal((await request('/settings','PUT',{...a.settings,executionTarget:'workspace'},a)).status,200);
    });
    await t.test('single-use invites record their user, stay hashed, expire and require a superadmin',async()=>{
      assert.equal((await request('/admin/invites','POST',{label:'team'},b)).status,403);
      const invite=await request('/admin/invites','POST',{label:'team',days:7},a);assert.equal(invite.status,201);
      const register=await request('/register','POST',{username:'charlie',password:'Very-good-password42',inviteCode:invite.data.code});assert.equal(register.status,200);
      assert.equal((await request('/register','POST',{username:'david',password:'Very-good-password42',inviteCode:invite.data.code})).status,403);
      const list=await request('/admin/invites','GET',null,a);const used=list.data.find(i=>i.id===invite.data.id);assert.equal(used.usedBy,'charlie');assert.ok(used.used_at);assert.ok(!JSON.stringify(list.data).includes(invite.data.code));
      const dbInvite=instance.store.get('SELECT * FROM invites WHERE id=?',invite.data.id);assert.notEqual(dbInvite.hash,invite.data.code);
      const revoked=await request('/admin/invites','POST',{days:1},a);await request(`/admin/invites/${revoked.data.id}`,'DELETE',null,a);
      assert.equal((await request('/register','POST',{username:'david',password:'Very-good-password42',inviteCode:revoked.data.code})).status,403);
      assert.equal((await request('/admin/invites','POST',{days:0},a)).status,400);
      const expired=await request('/admin/invites','POST',{days:1},a);instance.store.run('UPDATE invites SET expires=? WHERE id=?',Date.now()-1,expired.data.id);
      assert.equal((await request('/register','POST',{username:'expireduser',password:'Very-good-password42',inviteCode:expired.data.code})).status,403);
      const concurrent=await request('/admin/invites','POST',{days:1},a);const attempts=await Promise.all(['redeemone','redeemtwo'].map(username=>request('/register','POST',{username,password:'Very-good-password42',inviteCode:concurrent.data.code})));
      assert.deepEqual(attempts.map(r=>r.status).sort(),[200,403]);
    });
    await t.test('chat attachments use binary upload, stay outside projects, belong to one user/thread, and survive history',async()=>{
      const tr=(await request('/threads','POST',{projectId:p.id},a)).data;
      const task=await s2.call('upload/begin',{scope:'attachment',threadId:tr.id,path:'notes.txt',size:5});await s2.chunk(Buffer.from('hello'));const done=await s2.call('upload/finish',{uploadId:task.uploadId});const id=done.attachment.id;
      const files=(await request(`/projects/${p.id}/files`,'GET',null,a)).data;assert.ok(!files.some(f=>f.path==='notes.txt'));
      assert.equal((await request(`/attachments/${id}/preview`,'GET',null,b)).status,404);
      assert.equal((await request(`/attachments/${id}/preview`,'GET',null,a)).data.text,'hello');
      const other=(await request('/threads','POST',{projectId:p.id},a)).data;await assert.rejects(s2.call('turn/start',{threadId:other.id,text:'wrong thread',attachments:[id]}));
      const started=await s2.call('turn/start',{threadId:tr.id,text:'',attachments:[id]});assert.equal(started.turn.items[0].attachments[0].id,id);
      const call=instance.codex.calls.at(-1);assert.equal(call.params.input[1].type,'text');assert.match(call.params.input[1].text,/\/home\/node\/\.codex\/chat-attachments\//);assert.ok(call.params.input[1].text.includes('"content":"hello"'));
      assert.deepEqual(started.turn.items[0].content.filter(i=>i.type==='text'),[{type:'text',text:'请查看这些附件。'}]);
      assert.equal((await request(`/threads/${tr.id}`,'GET',null,a)).data.thread.turns[0].items[0].attachments[0].id,id);
      assert.equal((await request(`/attachments/${id}`,'DELETE',null,a)).status,409);await assert.rejects(s2.call('turn/start',{threadId:tr.id,text:'reuse',attachments:[id]}));
      const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNioAAAAASUVORK5CYII=','base64');
      const image=await s2.call('upload/begin',{scope:'attachment',threadId:other.id,path:'paste.png',size:png.length});await s2.chunk(png);const uploaded=(await s2.call('upload/finish',{uploadId:image.uploadId})).attachment;
      assert.equal((await request(`/attachments/${uploaded.id}/preview`,'GET',null,a)).data.kind,'image');
      await s2.call('turn/start',{threadId:other.id,text:'see screenshot',attachments:[uploaded.id]});assert.equal(instance.codex.calls.at(-1).params.input[1].type,'localImage');
      const draft=await s2.call('upload/begin',{scope:'attachment',threadId:other.id,path:'draft',size:0});const draftId=(await s2.call('upload/finish',{uploadId:draft.uploadId})).attachment.id;
      assert.equal((await request(`/attachments/${draftId}`,'DELETE',null,a)).status,200);assert.equal((await request(`/attachments/${draftId}/content`,'GET',null,a)).status,404);
    });
    await t.test('source attachment bytes reach Codex alongside the question but stay out of displayed user history',async()=>{
      const tr=(await request('/threads','POST',{projectId:p.id},a)).data;
      const source=Buffer.from('const SERVICE_MARKER="attachment-specific-service";\nexport function api() { return SERVICE_MARKER; }\n'+'// source line\n'.repeat(1000));
      const uploaded=await s2.call('upload/begin',{scope:'attachment',threadId:tr.id,path:'app.js',size:source.length});await s2.chunk(source);const attachment=(await s2.call('upload/finish',{uploadId:uploaded.uploadId})).attachment;
      const question='这是个什么服务？有什么功能';
      const result=await s2.call('turn/start',{threadId:tr.id,text:question,attachments:[attachment.id]});
      const input=instance.codex.calls.at(-1).params.input;assert.equal(input[0].text,question);assert.equal(input[1].type,'text');const context=JSON.parse(input[1].text.split('\n').slice(1).join('\n'));assert.equal(context.content,source.toString());assert.equal(context.contentStatus,'full');assert.equal(context.name,'app.js');
      assert.deepEqual(result.turn.items[0].content.filter(i=>i.type==='text'),[{type:'text',text:question}]);
      const history=(await request(`/threads/${tr.id}`,'GET',null,a)).data.thread.turns[0].items[0];assert.equal(history.attachments[0].id,attachment.id);assert.equal(history.content[0].text,question);assert.ok(!JSON.stringify(history).includes('SERVICE_MARKER'));
      assert.equal(instance.store.get('SELECT message_text FROM attachments WHERE id=?',attachment.id).message_text,question);
      const inherited=(await request('/threads','POST',{projectId:p.id},a)).data;instance.codex.threads.get(inherited.id).turns=[instance.codex.threads.get(tr.id).turns[0]];
      const forkHistory=(await request(`/threads/${inherited.id}`,'GET',null,a)).data.thread.turns[0].items[0];assert.equal(forkHistory.content[0].text,question);assert.equal(forkHistory.attachments[0].id,attachment.id);
      const missing=await s2.call('upload/begin',{scope:'attachment',threadId:tr.id,path:'missing.js',size:1});await s2.chunk(Buffer.from('x'));const id=(await s2.call('upload/finish',{uploadId:missing.uploadId})).attachment.id;
      await fs.unlink(path.join(dir,'users','alice','codex','chat-attachments',id,'missing.js'));const turns=instance.codex.calls.filter(c=>c.method==='turn/start').length;
      await assert.rejects(s2.call('turn/start',{threadId:tr.id,text:'read the missing file',attachments:[id]}),/文件不存在/);assert.equal(instance.codex.calls.filter(c=>c.method==='turn/start').length,turns);assert.equal(instance.store.get('SELECT turn_id FROM attachments WHERE id=?',id).turn_id,null);
    });
    await t.test('ZIP imports extract safely; single files keep their bytes and directories remain ZIP',async()=>{
      const data=Buffer.from(zipSync({'import/readme.txt':Buffer.from('zipped'),'import/empty/':new Uint8Array()}));
      const task=await s2.call('upload/begin',{projectId:p.id,path:'project.zip',size:data.length,extract:true});await s2.chunk(data);const result=await s2.call('upload/finish',{uploadId:task.uploadId});assert.equal(result.extracted,2);
      assert.equal((await request(`/projects/${p.id}/file?path=import/readme.txt`,'GET',null,a)).data.content,'zipped');assert.equal((await request(`/projects/${p.id}/file?path=project.zip`,'GET',null,a)).status,404);
      const r=await fetch(base+`/api/projects/${p.id}/download?path=import/readme.txt`,{headers:{Cookie:a.cookie,Origin:base}});assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.match(r.headers.get('content-disposition'),/attachment;.*readme\.txt/);assert.equal(await r.text(),'zipped');
      const folder=await fetch(base+`/api/projects/${p.id}/download?path=import`,{headers:{Cookie:a.cookie}});assert.equal(folder.headers.get('content-type'),'application/zip');const zip=unzipSync(new Uint8Array(await folder.arrayBuffer()));assert.equal(Buffer.from(zip['readme.txt']).toString(),'zipped');
      const conflict=await s2.call('upload/begin',{projectId:p.id,path:'again.zip',size:data.length,extract:true});await s2.chunk(data);await assert.rejects(s2.call('upload/finish',{uploadId:conflict.uploadId}),/已存在/);
      await s2.call('upload/cancel',{uploadId:conflict.uploadId});
      const bomb=Buffer.from(zipSync({'too-large.txt':new Uint8Array(30001)}));const bad=await s2.call('upload/begin',{projectId:p.id,path:'big.zip',size:bomb.length,extract:true});await s2.chunk(bomb);await assert.rejects(s2.call('upload/finish',{uploadId:bad.uploadId}),/上限/);
    });
    await t.test('ZIP conflict decisions reuse binary data and cancellation never publishes the batch',async()=>{
      const data=Buffer.from(zipSync({'import/readme.txt':Buffer.from('replaced'),'import/fresh.txt':Buffer.from('fresh')}));
      async function start() {const task=await s2.call('upload/begin',{projectId:p.id,path:'decisions.zip',size:data.length,extract:true});await s2.chunk(data);return task;}
      const cancelled=await start();
      await assert.rejects(s2.call('upload/finish',{uploadId:cancelled.uploadId}),e=>e.code==='UPLOAD_CONFLICT'&&e.conflictCount===1);
      assert.equal((await request(`/projects/${p.id}/file?path=import/fresh.txt`,'GET',null,a)).status,404);
      await s2.call('upload/cancel',{uploadId:cancelled.uploadId});await assert.rejects(s2.call('upload/resume',{uploadId:cancelled.uploadId}),/过期/);
      const skip=await start();await assert.rejects(s2.call('upload/finish',{uploadId:skip.uploadId}));
      const result=await s2.call('upload/finish',{uploadId:skip.uploadId,conflictPolicy:'skip'});assert.equal(result.skipped,1);assert.equal(result.uploaded,1);
      assert.equal((await request(`/projects/${p.id}/file?path=import/readme.txt`,'GET',null,a)).data.content,'zipped');
      const overwrite=await start();await assert.rejects(s2.call('upload/finish',{uploadId:overwrite.uploadId}));
      const replaced=await s2.call('upload/finish',{uploadId:overwrite.uploadId,conflictPolicy:'overwrite'});assert.equal(replaced.overwritten,2);
      assert.equal((await request(`/projects/${p.id}/file?path=import/readme.txt`,'GET',null,a)).data.content,'replaced');
      const empty=await s2.call('upload/begin',{projectId:p.id,path:'import/readme.txt',size:0});
      assert.equal((await s2.call('upload/finish',{uploadId:empty.uploadId,conflictPolicy:'overwrite'})).overwritten,1);
      assert.equal((await request(`/projects/${p.id}/file?path=import/readme.txt`,'GET',null,a)).data.content,'');
    });
    await t.test('chat download streams original binary files and rejects foreign roots, folders and links', async () => {
      const tr=(await request('/threads','POST',{projectId:p.id},a)).data;
      const filename="报告 (final)'s.bin", bytes=Buffer.from([0,255,17,13,10,128]);
      const projectRoot=path.join(dir,'users','alice','projects',p.id);
      await fs.writeFile(path.join(projectRoot,filename),bytes);
      const url=value=>base+`/api/threads/${tr.id}/download?path=${encodeURIComponent(value)}`;
      for (const value of [filename,`/workspace/${p.id}/${filename}`,`${instance.config.hostDataDir.replaceAll('\\','/')}/users/alice/projects/${p.id}/${filename}`]) {
        const response=await fetch(url(value),{headers:{Cookie:a.cookie}});
        assert.equal(response.status,200);assert.equal(response.headers.get('content-length'),String(bytes.length));
        assert.match(response.headers.get('content-disposition'),/filename\*=UTF-8''%E6/);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
      }
      assert.equal((await fetch(url(filename))).status,401);
      assert.equal((await fetch(url(filename),{headers:{Cookie:b.cookie}})).status,404);
      for (const value of ['../escape','/etc/passwd',`/workspace/another/${filename}`,'/home/node/.codex/auth.json','import']) assert.ok((await fetch(url(value),{headers:{Cookie:a.cookie}})).status>=400);
      const outside=path.join(dir,'outside-download');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'secret'),'private');
      await fs.symlink(outside,path.join(projectRoot,'download-link'),process.platform==='win32'?'junction':'dir');
      assert.equal((await fetch(url('download-link/secret'),{headers:{Cookie:a.cookie}})).status,403);
      const generated=path.join(dir,'users','alice','codex','generated_images');await fs.mkdir(generated,{recursive:true});await fs.writeFile(path.join(generated,'artifact.txt'),'generated');
      const response=await fetch(url('/home/node/.codex/generated_images/artifact.txt'),{headers:{Cookie:a.cookie}});assert.equal(response.status,200);assert.equal(await response.text(),'generated');
    });
    await t.test('completed turns generate a title once, preserve manual names, and persist current context statistics',async()=>{
      const tr=(await request('/threads','POST',{projectId:p.id},a)).data;const start=await s2.call('turn/start',{threadId:tr.id,text:'improve UX'});
      const turn=instance.codex.threads.get(tr.id).turns[0];turn.status='completed';turn.items.push({id:randomUUID(),type:'agentMessage',text:'I improved the UI'});
      instance.codex.emit(a.id,{method:'turn/completed',params:{threadId:tr.id,turn:{id:start.turn.id,status:'completed',items:[]}}});
      for(let n=0;n<30&&instance.store.thread(a,tr.id).title_state==='pending';n++)await new Promise(r=>setTimeout(r,10));
      assert.equal(instance.store.thread(a,tr.id).title,'改善工作区体验');assert.match(instance.codex.calls.find(c=>c.method==='generateTitle').params.exchange,/I improved/);
      const before=instance.codex.calls.filter(c=>c.method==='generateTitle').length;instance.codex.emit(a.id,{method:'turn/completed',params:{threadId:tr.id,turn}});await new Promise(r=>setTimeout(r,10));assert.equal(instance.codex.calls.filter(c=>c.method==='generateTitle').length,before);
      await request(`/threads/${tr.id}`,'PATCH',{title:'My title'},a);instance.codex.emit(a.id,{method:'thread/name/updated',params:{threadId:tr.id,threadName:'overwrite'}});assert.equal(instance.store.thread(a,tr.id).title,'My title');
      const usage={last:{totalTokens:1250},total:{totalTokens:25000},modelContextWindow:200000};instance.codex.emit(a.id,{method:'thread/tokenUsage/updated',params:{threadId:tr.id,tokenUsage:usage}});
      assert.deepEqual((await request(`/threads/${tr.id}`,'GET',null,a)).data.thread.tokenUsage,usage);
    });
    await t.test('generated images survive history and websocket completion; image endpoints enforce ownership and path boundaries',async()=>{
      const tr=(await request('/threads','POST',{projectId:p.id},a)).data;
      const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNioAAAAASUVORK5CYII=','base64');
      const image={id:'generated',type:'imageGeneration',status:'completed',result:png.toString('base64'),revisedPrompt:'Test image'};
      const turn={id:'image-turn',status:'completed',items:[image]};instance.codex.threads.get(tr.id).turns.push(turn);
      const events=await socket(base,a);sockets.push(events);await events.wait('ready');
      instance.codex.emit(a.id,{method:'item/completed',params:{threadId:tr.id,turnId:turn.id,item:image}});
      // Background title updates can arrive on this connection before the image event.
      let message;
      do { message=(await events.wait('codex/event')).event; } while(message.method!=='item/completed'||message.params?.threadId!==tr.id||message.params?.item?.id!==image.id);
      const event=message.params.item;assert.ok(!('result' in event));assert.match(event.imageUrl,/\/images\/generated$/);
      const history=(await request(`/threads/${tr.id}`,'GET',null,a)).data.thread.turns[0].items[0];assert.equal(history.imageUrl,event.imageUrl);assert.ok(!('result' in history));
      const url=base+history.imageUrl;
      const response=await fetch(url,{headers:{Cookie:a.cookie}});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
      assert.match((await fetch(url+'?download=1',{headers:{Cookie:a.cookie}})).headers.get('content-disposition'),/^attachment; filename="?generated-image\.png"?$/);
      assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{Cookie:b.cookie}})).status,404);
      assert.equal((await request(`/threads/${tr.id}/turns/wrong/images/generated`,'GET',null,a)).status,404);
      const generatedDir=path.join(dir,'users','alice','codex','generated_images');await fs.mkdir(generatedDir,{recursive:true});await fs.writeFile(path.join(generatedDir,'saved.png'),png);
      image.result='';image.savedPath='/home/node/.codex/generated_images/saved.png';assert.equal((await fetch(url,{headers:{Cookie:a.cookie}})).status,200);
      image.savedPath='/home/node/.codex/auth.json';assert.equal((await fetch(url,{headers:{Cookie:a.cookie}})).status,403);
      image.savedPath='/home/node/.codex/generated_images/not-found.png';assert.equal((await fetch(url,{headers:{Cookie:a.cookie}})).status,404);
      image.savedPath=null;image.result='';assert.equal((await fetch(url,{headers:{Cookie:a.cookie}})).status,404);
      const projectDir=path.join(dir,'users','alice','projects',p.id);await fs.writeFile(path.join(projectDir,'diagram.png'),png);
      const media=rel=>`/threads/${tr.id}/media?path=${encodeURIComponent(rel)}`;
      assert.equal((await request(media(`/workspace/${p.id}/diagram.png`),'GET',null,a)).status,200);
      for(const rel of ['/etc/passwd','/home/node/.codex/auth.json',`/workspace/${p.id}/../other.png`])assert.equal((await request(media(rel),'GET',null,a)).status,rel.includes('..')?400:403);
      assert.equal((await request(media('resumed.txt'),'GET',null,a)).status,415);
      await fs.symlink(generatedDir,path.join(projectDir,'media-link'),process.platform==='win32'?'junction':'dir');
      assert.equal((await request(media('media-link/saved.png'),'GET',null,a)).status,403);
      assert.equal((await request(media('diagram.png'),'GET',null,b)).status,404);
    });
    await t.test('turn-scoped changes capture shell edits, isolate users, filter a single file and survive forks',async()=>{
      const project = (await request('/projects', 'POST', { name: 'Diff project' }, a)).data;
      await request(`/projects/${project.id}/file`, 'PUT', { path: 'app.js', content: 'preexisting edit\nold\n' }, a);
      await request(`/projects/${project.id}/file`, 'PUT', { path: 'delete.txt', content: 'removed\n' }, a);
      const tr = (await request('/threads', 'POST', { projectId: project.id }, a)).data;
      const projectDir = path.join(dir, 'users', 'alice', 'projects', project.id);
      await fs.mkdir(path.join(projectDir, '.work'));
      await fs.writeFile(path.join(projectDir, '.work', 'Backup.cs'), 'old backup\n');
      const source = '// Unity C# source\n'.repeat(40000);
      await fs.writeFile(path.join(projectDir, 'MarkerManager.cs'), source);
      const start = await s2.call('turn/start', { threadId: tr.id, text: 'modify files' });
      await fs.writeFile(path.join(projectDir, 'app.js'), 'preexisting edit\nnew\nextra\n');
      await fs.writeFile(path.join(projectDir, 'new.js'), 'created\n'); await fs.unlink(path.join(projectDir, 'delete.txt'));
      await fs.writeFile(path.join(projectDir, '.work', 'Backup.cs'), 'new backup\n');
      await fs.writeFile(path.join(projectDir, '.work', 'After.dll'), Buffer.from([0, 1, 2]));
      await fs.appendFile(path.join(projectDir, 'MarkerManager.cs'), '// actual change\n');
      instance.codex.emit(a.id, { method: 'item/completed', params: { threadId: tr.id, turnId: start.turn.id, item: { id: 'shell-diff', type: 'commandExecution', status: 'completed' } } });
      const turn = instance.codex.threads.get(tr.id).turns[0]; turn.status = 'completed';
      instance.codex.emit(a.id, { method: 'turn/completed', params: { threadId: tr.id, turn } });
      const endpoint = `/threads/${tr.id}/turns/${turn.id}/changes`;
      let details;
      for (let i = 0; i < 100; i++) { details = await request(endpoint, 'GET', null, a); if (details.data?.source === 'snapshot' && details.data.status === 'completed') break; await new Promise(resolve => setTimeout(resolve, 5)); }
      assert.equal(details.status, 200); assert.equal(details.data.files.length, 4); assert.equal(details.data.added, 4); assert.equal(details.data.removed, 2);
      const csharp = await request(endpoint + '?path=MarkerManager.cs', 'GET', null, a);
      assert.equal(csharp.data.files[0].added, 1); assert.ok(csharp.data.files[0].patches[0].hunks[0].lines.includes('+// actual change'));
      assert.equal((await request(endpoint, 'GET')).status, 401); assert.equal((await request(endpoint, 'GET', null, b)).status, 404);
      const single = await request(endpoint + '?path=app.js', 'GET', null, a); assert.equal(single.data.files.length, 1); assert.equal(single.data.added, 2); assert.equal(single.data.removed, 1);
      assert.equal((await request(endpoint + '?path=..%2Fsecret', 'GET', null, a)).status, 400);
      assert.equal((await request(`/threads/${tr.id}/turns/wrong/changes`, 'GET', null, a)).status, 404);
      const history = (await request(`/threads/${tr.id}`, 'GET', null, a)).data.thread.turns[0]; assert.equal(history.changes.files.length, 4); assert.equal('patches' in history.changes.files[0], false);
      const other = (await request('/threads', 'POST', { projectId: project.id }, a)).data;
      assert.equal((await request(`/threads/${other.id}/turns/${turn.id}/changes`, 'GET', null, a)).status, 404);
      const fork = await s2.call('thread/fork', { threadId: tr.id }); const inherited = await request(`/threads/${fork.thread.id}/turns/${turn.id}/changes`, 'GET', null, a); assert.equal(inherited.data.added, 4);
    });
    await t.test('turn clocks and sidebar activity survive reads and reconnects without leaking across users', async () => {
      const tr = (await request('/threads', 'POST', { projectId: p.id }, a)).data;
      const start = await s2.call('turn/start', { threadId: tr.id, text: 'observe task timing' });
      assert.ok(start.turn.timing.startedAt > 0); assert.equal(start.turn.timing.completedAt, null);
      const list = (await request('/threads', 'GET', null, a)).data;
      assert.equal(list.find(thread => thread.id === tr.id).activeTurn.id, start.turn.id);
      assert.ok(!(await request('/threads', 'GET', null, b)).data.some(thread => thread.id === tr.id));
      const reconnect = await socket(base, a); sockets.push(reconnect);
      const ready = await reconnect.wait('ready');
      assert.deepEqual(ready.activeTurns.find(entry => entry.threadId === tr.id).turn.timing, start.turn.timing);
      const running = (await request(`/threads/${tr.id}`, 'GET', null, a)).data.thread.turns[0];
      assert.deepEqual(running.timing, start.turn.timing);
      const turn = instance.codex.threads.get(tr.id).turns[0]; turn.status = 'completed';
      instance.codex.emit(a.id, { method: 'turn/completed', params: { threadId: tr.id, turn } });
      const done = (await request(`/threads/${tr.id}`, 'GET', null, a)).data.thread.turns[0];
      assert.ok(done.timing.completedAt >= done.timing.startedAt);
      instance.codex.emit(a.id, { method: 'turn/started', params: { threadId: tr.id, turn: { id: turn.id, status: 'inProgress', items: [] } } });
      assert.equal((await request('/threads', 'GET', null, a)).data.find(thread => thread.id === tr.id).activeTurn, null);
      assert.deepEqual((await request(`/threads/${tr.id}`, 'GET', null, a)).data.thread.turns[0].timing, done.timing);
      const fork = await s2.call('thread/fork', { threadId: tr.id });
      assert.deepEqual((await request(`/threads/${fork.thread.id}`, 'GET', null, a)).data.thread.turns[0].timing, done.timing);
      await reconnect.close();
    });
    await t.test('web login permits managed device flow but rejects browser callbacks and external tokens',async()=>{
      await s2.call('account/login/start',{type:'chatgptDeviceCode',accessToken:'ignored'});assert.deepEqual(instance.codex.calls.at(-1).params,{type:'chatgptDeviceCode'});
      await assert.rejects(s2.call('account/login/start',{type:'chatgptAuthTokens',accessToken:'forbidden'}));await assert.rejects(s2.call('account/login/start',{type:'chatgpt'}));
    });
    await t.test('logout invalidates session and websocket',async()=>{assert.equal((await request('/logout','POST',{},a)).status,200);assert.equal((await request('/projects','GET',null,a)).status,401);});
  } finally { for(const s of sockets) await s.close(); await instance.close(); await fs.rm(dir,{recursive:true,force:true}); }
});

test('Linux directory fd prevents ancestor replacement from escaping the workspace',{skip:process.platform!=='linux'},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sv-race-'));const root=path.join(dir,'root'),outside=path.join(dir,'outside');await fs.mkdir(path.join(root,'nested'),{recursive:true});await fs.mkdir(outside);await fs.writeFile(path.join(outside,'file'),'private');
  let anchor;try{anchor=await anchored(root,'nested/file');await fs.rename(path.join(root,'nested'),path.join(root,'moved'));await fs.symlink(outside,path.join(root,'nested'));await fs.writeFile(anchor.target,'safe');assert.equal(await fs.readFile(path.join(outside,'file'),'utf8'),'private');assert.equal(await fs.readFile(path.join(root,'moved','file'),'utf8'),'safe');await fs.symlink(outside,path.join(root,'moved','link'));await safeRemove(root,'moved');assert.equal(await fs.readFile(path.join(outside,'file'),'utf8'),'private');}finally{await anchor?.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('path validation includes invalid characters and root symlinks',async()=>{
  for(const v of ['',null,'..','a/../b','C:/file','a\0b','a\nb'])assert.throws(()=>relativePath(v,false));
  assert.equal(relativePath('.git/config'),'.git/config');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sv-safe-'));try{const target=path.join(dir,'target'),link=path.join(dir,'link');await fs.mkdir(target);await fs.symlink(target,link,process.platform==='win32'?'junction':'dir');await assert.rejects(safePath(link,''));}finally{await fs.rm(dir,{recursive:true,force:true});}
});
