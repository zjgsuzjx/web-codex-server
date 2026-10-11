// Production smoke check: transient accounts only, no model inference or user credentials.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { DatabaseSync } from 'node:sqlite';
import Docker from 'dockerode';
import fs from 'node:fs/promises';
import path from 'node:path';
const origin = process.env.PUBLIC_URL, base = process.env.SMOKE_BASE || 'http://127.0.0.1:3100', name = 'qa_' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
const db = new DatabaseSync('/data/app.sqlite'), docker = new Docker({ socketPath: '/var/run/docker.sock' });
let user, cookie, ws, next = 1;const waiters = new Map(), events = [];
async function api(url,method='GET',body){const r=await fetch(base+'/api'+url,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie,'X-CSRF-Token':user.csrf}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.ok(r.ok,`${method} ${url}: ${data.error}`);return{data,res:r};}
async function rpc(method,params={}){const id=next++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiters.delete(id);reject(new Error(`${method} timed out`));},60000);waiters.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params}));});}
async function until(predicate){for(let n=0;n<100;n++){const event=events.find(predicate);if(event)return event;await new Promise(r=>setTimeout(r,100));}throw new Error('Expected event was not delivered');}
try {
  const registered=await api('/register','POST',{username:name,password,inviteCode:process.env.INVITE_CODE});user=registered.data.user;cookie=registered.res.headers.get('set-cookie').split(';')[0];
  const p=(await api('/projects','POST',{name:'Temporary deployment verification'})).data;
  ws=new WebSocket(base.replace('http','ws')+'/ws?csrf='+user.csrf,{headers:{Origin:origin,Cookie:cookie}});
  ws.on('message',buf=>{const msg=JSON.parse(buf);if(msg.id!=null){const w=waiters.get(msg.id);if(w){waiters.delete(msg.id);msg.error?w.reject(new Error(msg.error.message)):w.resolve(msg.result);}}else events.push(msg);});
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  const upload=await rpc('upload/begin',{projectId:p.id,path:'src/check.txt',size:5});ws.send(Buffer.from('hello'));await until(e=>e.type==='upload/ack');await rpc('upload/finish',{uploadId:upload.uploadId});
  assert.equal((await api(`/projects/${p.id}/file?path=src/check.txt`)).data.content,'hello');
  const dashboard=(await api('/dashboard')).data;assert.ok(dashboard.server.disk.total>0);assert.ok(dashboard.server.disk.available>=0);assert.ok(dashboard.server.memory.total>0);assert.equal(dashboard.storage.used,5);
  const quotaStatus=(await api('/codex-usage')).data;assert.ok(['available','unauthenticated','unsupported','unavailable'].includes(quotaStatus.status));
  const catalog=await rpc('model/list',{limit:100});assert.ok(Array.isArray(catalog.data));
  const account=await rpc('account/read',{refreshToken:false});assert.ok('account' in account);
  const thread=(await api('/threads','POST',{projectId:p.id,title:'Smoke check'})).data;
  let unauthenticatedTurnChecked=false;
  if(account.account===null&&account.requiresOpenaiAuth){
    await assert.rejects(rpc('turn/start',{threadId:thread.id,text:'Verify connection.'}),/账号.*登录/);
    unauthenticatedTurnChecked=true;
  }
  await rpc('thread/shellCommand',{threadId:thread.id,command:'printf smoke-shell-ok',timeoutMs:10000});
  await until(e=>e.event?.method==='item/completed'&&e.event.params?.item?.type==='commandExecution');
  const command=events.find(e=>e.event?.method==='item/completed'&&e.event.params?.item?.type==='commandExecution').event.params.item;
  assert.equal(command.exitCode,0);assert.ok(command.aggregatedOutput.includes('smoke-shell-ok'));
  const read=await api(`/threads/${thread.id}`);assert.ok(read.data.thread.turns.length);
  await rpc('terminal/start',{projectId:p.id,cols:80,rows:24});await rpc('terminal/input',{data:'printf "terminal-smoke-ok\\n"\n'});await until(e=>e.type==='terminal/data'&&Buffer.from(e.data,'base64').toString().includes('terminal-smoke-ok'));await rpc('terminal/stop');
  const info=await docker.getContainer('sv-codex-'+user.id).inspect();assert.equal(info.Config.User,'1000:1000');assert.ok(info.HostConfig.ReadonlyRootfs);assert.ok(info.HostConfig.CapDrop.includes('ALL'));assert.ok(!info.Mounts.some(m=>m.Destination.includes('docker.sock')));assert.ok(info.Mounts.every(m=>m.Source.includes('/users/'+name+'/')));
  await api('/settings','PUT',{...user.settings,networkAccess:false});
  await rpc('model/list',{limit:100});
  const offline=await docker.getContainer('sv-codex-'+user.id).inspect();assert.equal(offline.HostConfig.NetworkMode,'none');
  console.log(JSON.stringify({status:'passed',base,checks:['HTTPS-origin session','websocket binary upload','model catalog','account status','real Codex thread','shell event streaming','persistent history','interactive terminal','non-root isolated container','Docker-enforced network restriction'],unauthenticatedTurnChecked,modelCount:catalog.data.length}));
} finally {
  if(ws?.readyState===WebSocket.OPEN)await rpc('codex/restart').catch(()=>{});
  if(cookie)await api('/logout','POST',{}).catch(()=>{});
  ws?.close();
  if(user){await docker.getContainer('sv-codex-'+user.id).remove({force:true}).catch(()=>{});db.exec('BEGIN');try{for(const table of ['events','threads','sessions','projects'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(user.id);db.prepare('DELETE FROM audit WHERE user_id=?').run(user.id);db.prepare('DELETE FROM users WHERE id=? AND username=?').run(user.id,name);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}const dir=path.join('/data/users',name);assert.ok(dir.startsWith('/data/users/qa_'));await fs.rm(dir,{recursive:true,force:true});await fs.rm(path.join('/data/uploads',user.id),{recursive:true,force:true});}
  db.close();
}
