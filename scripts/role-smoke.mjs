import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {WebSocket} from 'ws';
import Docker from 'dockerode';
import fs from 'node:fs/promises';
import path from 'node:path';
import {CodexManager} from '../server/codex.js';
const base=process.env.SMOKE_BASE||'http://127.0.0.1:3100',origin=process.env.PUBLIC_URL,name='qa_role_'+randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');
const db=new DatabaseSync('/data/app.sqlite'),docker=new Docker({socketPath:'/var/run/docker.sock'});let user,cookie,ws,n=1;const pending=new Map(),events=[];
async function api(url,method='GET',body,expected=200){const r=await fetch(base+'/api'+url,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie,'X-CSRF-Token':user.csrf}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,expected,`${method} ${url}: ${data.error}`);if(url==='/register'||url==='/login'){user=data.user;cookie=r.headers.get('set-cookie').split(';')[0];}return data;}
async function login(){return api('/login','POST',{username:name,password});}
async function connect(){ws=new WebSocket(base.replace('http','ws')+'/ws?csrf='+user.csrf,{headers:{Origin:origin,Cookie:cookie}});ws.on('message',buf=>{const m=JSON.parse(buf),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else events.push(m);});await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});}
async function rpc(method,params={}){const id=n++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(method+' timeout')),60000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function shell(threadId,command){events.length=0;await rpc('thread/shellCommand',{threadId,command,timeoutMs:10000});for(let i=0;i<100;i++){const item=events.find(e=>e.event?.method==='item/completed'&&e.event.params?.item?.type==='commandExecution')?.event.params.item;if(item)return item;await new Promise(r=>setTimeout(r,100));}throw new Error('No shell result');}
try{
  await api('/register','POST',{username:name,password,inviteCode:process.env.INVITE_CODE});assert.equal(user.role,'user');
  await api('/settings','PUT',{...user.settings,executionTarget:'server'},403);
  db.prepare("UPDATE users SET role='superadmin' WHERE id=? AND username=?").run(user.id,name);await login();assert.equal(user.role,'superadmin');
  const project=await api('/projects','POST',{name:'Temporary role verification'},201);
  user.settings=await api('/settings','PUT',{...user.settings,executionTarget:'server'});await connect();
  const thread=await api('/threads','POST',{projectId:project.id},201);
  const host=await shell(thread.id,'test "$(id -u)" = 0 && test "$(readlink /proc/self/ns/mnt)" = "$(readlink /proc/1/ns/mnt)" && test -f /home/zhuzi/apps/web-codex-server/compose.yml && printf root-to-workspace > root-generated.txt && printf host-root-verified');
  assert.equal(host.exitCode,0);assert.ok(host.aggregatedOutput.includes('host-root-verified'));
  const privileged=await docker.getContainer('sv-codex-'+user.id).inspect();assert.equal(privileged.HostConfig.Privileged,true);assert.equal(privileged.HostConfig.PidMode,'host');
  await api(`/admin/users/${user.id}/role`,'PATCH',{role:'admin'});ws.close();
  await login();assert.equal(user.role,'admin');assert.equal(user.settings.executionTarget,'workspace');
  const file=await api(`/projects/${project.id}/file?path=root-generated.txt`);assert.equal(file.content,'root-to-workspace');
  await api(`/projects/${project.id}/file`,'PUT',{path:'root-generated.txt',content:'editable-after-downgrade',etag:file.etag});
  await api('/settings','PUT',{...user.settings,executionTarget:'server'},403);
  await api(`/admin/users/${user.id}/role`,'PATCH',{role:'superadmin'},403);
  await connect();await rpc('model/list',{limit:100});
  const isolated=await docker.getContainer('sv-codex-'+user.id).inspect();assert.equal(isolated.Config.User,'1000:1000');assert.ok(!isolated.HostConfig.Privileged);assert.ok(!isolated.HostConfig.PidMode||isolated.HostConfig.PidMode==='');assert.ok(isolated.HostConfig.ReadonlyRootfs);assert.ok(isolated.HostConfig.CapDrop.includes('ALL'));assert.ok(isolated.Mounts.every(m=>m.Source.includes('/users/'+name+'/')));
  const ownThread=await api('/threads','POST',{projectId:project.id},201);
  const confined=await shell(ownThread.id,'set -e; test "$(id -u)" = 1000; test ! -e /home/zhuzi/apps/web-codex-server/compose.yml; if touch /etc/starvalley-role-smoke 2>/dev/null; then exit 1; fi; printf workspace-isolation-verified');
  assert.equal(confined.exitCode,0);assert.ok(confined.aggregatedOutput.includes('workspace-isolation-verified'));
  console.log(JSON.stringify({status:'passed',checks:['host root and actual host mount namespace','superadmin-only server mode','role downgrade closes old root backend','administrator cannot promote self','administrator non-root own-project mounts','host system files inaccessible and image system files read-only']}));
}finally{
  for(const item of pending.values())clearTimeout(item.timer);
  if(ws?.readyState===WebSocket.OPEN)await rpc('codex/restart').catch(()=>{});ws?.close();
  if(user){await docker.getContainer('sv-codex-'+user.id).remove({force:true}).catch(()=>{});await new CodexManager({hostDataDir:process.env.HOST_DATA_DIR,workerImage:process.env.WORKER_IMAGE},()=>{}).prepareHome(user);db.exec('BEGIN');try{for(const table of ['events','threads','sessions','projects','audit'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(user.id);db.prepare('DELETE FROM users WHERE id=? AND username=?').run(user.id,name);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}const dir=path.join('/data/users',name);assert.ok(dir.startsWith('/data/users/qa_role_'));await fs.rm(dir,{recursive:true,force:true});await fs.rm(path.join('/data/uploads',user.id),{recursive:true,force:true});}db.close();
}
