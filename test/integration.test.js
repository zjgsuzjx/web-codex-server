import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { relativePath, safePath, anchored, safeRemove } from '../server/files.js';

function mockCodex(config, emit) {
  const threads = new Map(), calls = [];
  return { calls, instances: new Map(), async ensure() {}, async resume() {}, async restart() {}, async stopIdle() {}, async shutdown() {}, async reply() {}, async call(u, method, params) {
    calls.push({ method, params });
    if (method === 'thread/start') { const thread = { id: randomUUID(), turns: [] }; threads.set(thread.id, thread); return { thread }; }
    if (method === 'thread/read') return { thread: threads.get(params.threadId) };
    if (method === 'account/read') return { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
    if (method === 'account/rateLimits/read') return { rateLimits: { limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: { usedPercent: 7, windowDurationMins: 10080 } } };
    if (method === 'turn/start') { const turn = { id: randomUUID(), status: 'inProgress', items: [] }; emit(u.id, { method: 'turn/started', params: { threadId: params.threadId, turn } }); return { turn }; }
    return {};
  } };
}
async function socket(base, session, origin = base) {
  const ws = new WebSocket(base.replace('http','ws') + '/ws?csrf=' + session.csrf, { headers: { Cookie: session.cookie, Origin: origin } });
  let id = 1; const waiters = new Map(); const inbox = [];
  ws.on('message', buf => { const m = JSON.parse(buf); const key = m.id ?? m.type; const q = waiters.get(key); if (q) { waiters.delete(key); m.error && m.id ? q.reject(new Error(m.error.message)) : q.resolve(m); } else inbox.push(m); });
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
    await t.test('quota accounts for reserved bytes across concurrent connections',async()=>{const other=await socket(base,a);sockets.push(other);const task=await s2.call('upload/begin',{projectId:p.id,path:'reserve-one',size:30000});await assert.rejects(other.call('upload/begin',{projectId:p.id,path:'reserve-two',size:25000}),/配额/);await s2.call('upload/cancel',{uploadId:task.uploadId});await other.close();});
    await t.test('path traversal, symlinks, quota, and oversized files are rejected',async()=>{for(const rel of ['../escape','/etc/passwd','a/../../b','a\\b','a//b'])await assert.rejects(s2.call('upload/begin',{projectId:p.id,path:rel,size:2}));await assert.rejects(s2.call('upload/begin',{projectId:p.id,path:'big.txt',size:30001}));const outside=path.join(dir,'outside');await fs.mkdir(outside);await fs.symlink(outside,path.join(dir,'users','alice','projects',p.id,'link'),process.platform==='win32'?'junction':'dir');assert.equal((await request(`/projects/${p.id}/file?path=link/secret`,'GET',null,a)).status,403);const task=await s2.call('upload/begin',{projectId:p.id,path:'reservation',size:30000});await assert.rejects(s2.call('upload/begin',{projectId:p.id,path:'second',size:1000}));await s2.call('upload/cancel',{uploadId:task.uploadId});});
    await t.test('unfinished and conflicting uploads do not overwrite existing files',async()=>{const task=await s2.call('upload/begin',{projectId:p.id,path:'src/hello.txt',size:2});await assert.rejects(s2.call('upload/finish',{uploadId:task.uploadId}));await s2.chunk(Buffer.from('XX'));await assert.rejects(s2.call('upload/finish',{uploadId:task.uploadId}));assert.equal((await request(`/projects/${p.id}/file?path=src/hello.txt`,'GET',null,a)).data.content,'hello world');});
    await t.test('editor uses optimistic concurrency and supports rename and deletion',async()=>{const file=(await request(`/projects/${p.id}/file?path=src/hello.txt`,'GET',null,a)).data;const saved=await request(`/projects/${p.id}/file`,'PUT',{path:'src/hello.txt',content:'modified',etag:file.etag},a);assert.equal(saved.status,200);assert.equal((await request(`/projects/${p.id}/file`,'PUT',{path:'src/hello.txt',content:'stale',etag:file.etag},a)).status,409);assert.equal((await request(`/projects/${p.id}/file`,'PATCH',{from:'src/hello.txt',to:'src/new.txt'},a)).status,200);assert.equal((await request(`/projects/${p.id}/file`,'DELETE',{path:'src/new.txt'},a)).status,200);});
    await t.test('directory download produces a zip; unauthorized user cannot download',async()=>{const r=await fetch(base+`/api/projects/${p.id}/download`,{headers:{Cookie:a.cookie,Origin:base}});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/zip');const buf=Buffer.from(await r.arrayBuffer());assert.equal(buf.subarray(0,2).toString(),'PK');assert.ok(buf.includes(Buffer.from('resumed.txt')));assert.equal((await request(`/projects/${p.id}/download`,'GET',null,b)).status,404);});
    await t.test('Codex routes owned threads with the current protocol and isolates users',async()=>{const tr=await request('/threads','POST',{projectId:p.id},a);assert.equal(tr.status,201);assert.equal(instance.codex.calls.find(x=>x.method==='thread/start').params.sandbox,'danger-full-access');const sb=await socket(base,b);sockets.push(sb);await assert.rejects(sb.call('turn/start',{threadId:tr.data.id,text:'read other user'}));await s2.call('turn/start',{threadId:tr.data.id,text:'hello'});assert.equal(instance.codex.calls.at(-1).params.cwd,`/workspace/${p.id}`);assert.equal(instance.codex.calls.at(-1).params.sandboxPolicy.type,'externalSandbox');assert.equal(instance.codex.calls.at(-1).params.sandboxPolicy.networkAccess,'enabled');assert.equal((await request('/settings','PUT',{...a.settings,sandbox:'readOnly'},a)).status,400);assert.equal((await request('/settings','PUT',{...a.settings,effort:'ultra'},a)).status,200);await assert.rejects(s2.call('command/exec',{command:['sh']}));});
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
