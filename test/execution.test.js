import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {executionTarget,hostCommand,projectCwd,workerSpec} from '../server/execution.js';
import {CodexManager} from '../server/codex.js';
import {createStore} from '../server/store.js';
const config={hostDataDir:'/srv/app/data',enableHostExecution:true,hostCodexScript:'/opt/codex.js',workerImage:'worker',workerMemory:384};
const user=(role,target='workspace')=>({id:'safe-id',username:'alice',role,settings:JSON.stringify({executionTarget:target})});
test('members and administrators cannot forge host mode; their workers have no host access',()=>{
  for(const role of ['user','admin']){
    assert.throws(()=>executionTarget(user(role,'server')),/超级管理员/);
    assert.throws(()=>workerSpec(config,user(role,'server')),/超级管理员/);
    assert.throws(()=>hostCommand(config,user(role),['bash']),/超级管理员/);
    const spec=workerSpec(config,user(role));assert.equal(spec.User,'1000:1000');assert.ok(!spec.HostConfig.Privileged);assert.ok(!spec.HostConfig.PidMode);
    assert.equal(spec.HostConfig.NetworkMode,'bridge');assert.ok(spec.HostConfig.ReadonlyRootfs);assert.deepEqual(spec.HostConfig.CapDrop,['ALL']);
    assert.ok(spec.HostConfig.Binds.every(x=>x.startsWith('/srv/app/data/users/alice/')));assert.ok(!JSON.stringify(spec).includes('docker.sock'));
  }
});
test('superadmin host root requires explicit server mode and deployment opt-in',()=>{
  assert.equal(workerSpec(config,user('superadmin')).User,'1000:1000');
  assert.throws(()=>workerSpec({...config,enableHostExecution:false},user('superadmin','server')),/尚未配置/);
  const spec=workerSpec(config,user('superadmin','server'));assert.equal(spec.User,'0:0');assert.equal(spec.HostConfig.Privileged,true);
  assert.equal(spec.HostConfig.PidMode,'host');assert.equal(spec.HostConfig.NetworkMode,'host');
  const cwd=projectCwd(config,user('superadmin','server'),'project');assert.equal(cwd,'/srv/app/data/users/alice/projects/project');
  const cmd=hostCommand(config,user('superadmin','server'),['/usr/bin/node','/opt/codex.js','app-server'],cwd);
  assert.ok(cmd.includes('--root'));assert.ok(cmd.includes('--wd=/proc/1/root'+cwd));assert.equal(cmd.at(-1),'app-server');
});
test('manager rechecks persisted roles instead of trusting stale or forged user objects',async()=>{
  const manager=new CodexManager({...config,resolveUser:()=>user('admin','server')},()=>{});
  await assert.rejects(manager.ensure(user('superadmin','server')),/超级管理员/);
  manager.config.resolveUser=()=>user('superadmin','server');manager.config.changingUsers=new Set(['safe-id']);
  await assert.rejects(manager.ensure(user('superadmin','server')),/权限正在更新/);
  assert.equal(manager.instances.size,0);
});
test('ownership repair mounts only that user and cannot enter the host',async()=>{
  const manager=new CodexManager(config,()=>{});let spec;
  manager.docker={async createContainer(value){spec=value;return {async start(){},async wait(){return {StatusCode:0};},async remove(){}};}};
  await manager.prepareHome(user('admin'),true);
  assert.equal(spec.HostConfig.NetworkMode,'none');assert.ok(!spec.HostConfig.Privileged);assert.ok(!spec.HostConfig.PidMode);
  assert.ok(spec.HostConfig.Binds.every(x=>x.startsWith('/srv/app/data/users/alice/')));assert.deepEqual(spec.HostConfig.CapAdd,['CHOWN','DAC_OVERRIDE','FOWNER']);
  assert.deepEqual(spec.HostConfig.CapDrop,['ALL']);assert.deepEqual(spec.HostConfig.SecurityOpt,['no-new-privileges:true']);
  assert.ok(spec.HostConfig.ReadonlyRootfs);assert.equal(spec.HostConfig.Memory,32*1024*1024);
  assert.ok(spec.Cmd.includes('--no-dereference'));assert.ok(spec.Cmd.includes('/own-projects'));
});
test('legacy migration upgrades only the original administrator and never repeats',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sv-role-migration-'));let store;
  try{
    store=createStore(dir);store.run("DELETE FROM migrations WHERE name='superadmin-v1'");
    for(const [id,created] of [['owner',1],['invited-admin',2]])store.run('INSERT INTO users(id,username,password,role,created) VALUES(?,?,?,?,?)',id,id,'unused','admin',created);
    store.db.close();store=createStore(dir);assert.equal(store.user('owner').role,'superadmin');assert.equal(store.user('invited-admin').role,'admin');
    store.run("UPDATE users SET role='admin' WHERE id='owner'");store.db.close();store=createStore(dir);assert.equal(store.user('owner').role,'admin');
  }finally{store?.db.close();await fs.rm(dir,{recursive:true,force:true});}
});
