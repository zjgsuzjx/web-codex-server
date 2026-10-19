import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { zipSync } from 'fflate';
import { stageZip, publishZip, uploadPlan } from '../server/archives.js';

test('ZIP validation rejects traversal, links, CRC corruption, quota excess and conflicts before publishing',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sv-zip-')),root=path.join(dir,'root');await fs.mkdir(root);
  async function stage(data,limits={}) {const filename=path.join(dir,'input.zip');await fs.writeFile(filename,data);const staging=await fs.mkdtemp(path.join(dir,'stage-'));const result=await stageZip(filename,staging,{maxFile:1000,maxBytes:2000,...limits});return {staging,...result};}
  try {
    await assert.rejects(stage(zipSync({'../escape':Buffer.from('outside')})));
    await assert.rejects(stage(zipSync({'/absolute':Buffer.from('outside')})));
    const link=Buffer.from(zipSync({'link':Buffer.from('/etc/passwd')})),central=link.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));link.writeUInt16LE(0x0314,central+4);link.writeUInt32LE((0xa1ff*65536)>>>0,central+38);await assert.rejects(stage(link),/链接/);
    const crc=Buffer.from(zipSync({'file':Buffer.from('hello')}));const header=crc.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));crc.writeUInt32LE(0,header+16);await assert.rejects(stage(crc),/校验/);
    await assert.rejects(stage(zipSync({'one':new Uint8Array(900),'two':new Uint8Array(900)}),{maxBytes:1500}),/配额/);
    await assert.rejects(stage(zipSync({'large':new Uint8Array(1001)})),/上限/);
    const valid=await stage(zipSync({'new.txt':Buffer.from('new'),'existing.txt':Buffer.from('replace')}));await fs.writeFile(path.join(root,'existing.txt'),'original');
    await assert.rejects(publishZip(root,valid.staging,valid.entries),/已存在/);assert.equal(await fs.readFile(path.join(root,'existing.txt'),'utf8'),'original');await assert.rejects(fs.stat(path.join(root,'new.txt')));
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('ZIP conflicts can skip, overwrite and merge directories without removing type collisions',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sv-zip-choice-')),root=path.join(dir,'root');await fs.mkdir(root);
  async function stage() {
    const filename=path.join(dir,'input.zip'),staging=await fs.mkdtemp(path.join(dir,'stage-'));
    await fs.writeFile(filename,zipSync({'same.txt':Buffer.from('replacement'),'new.txt':Buffer.from('new'),'folder/':new Uint8Array(),'folder/nested.txt':Buffer.from('nested'),'blocked/child.txt':Buffer.from('blocked'),'existing-dir':Buffer.from('never replace folder')}));
    return {staging,...await stageZip(filename,staging,{maxFile:1000,maxBytes:2000})};
  }
  try {
    await fs.writeFile(path.join(root,'same.txt'),'old');await fs.writeFile(path.join(root,'blocked'),'keep');await fs.mkdir(path.join(root,'folder'));await fs.mkdir(path.join(root,'existing-dir'));
    const first=await stage();
    await assert.rejects(publishZip(root,first.staging,first.entries),e=>e.code==='UPLOAD_CONFLICT'&&e.conflictCount===3);
    await assert.rejects(fs.stat(path.join(root,'new.txt')));
    const skipped=await publishZip(root,first.staging,first.entries,{policy:'skip'});
    assert.equal(skipped.skipped,3);assert.equal(skipped.uploaded,2);assert.equal(await fs.readFile(path.join(root,'same.txt'),'utf8'),'old');
    assert.equal(await fs.readFile(path.join(root,'folder/nested.txt'),'utf8'),'nested');
    const second=await stage(),plan=await uploadPlan(root,second.entries,'overwrite');
    assert.equal(plan.overwritten,3);assert.equal(plan.skipped,2);
    assert.equal(plan.growth,'replacement'.length-'old'.length);
    const result=await publishZip(root,second.staging,second.entries,{policy:'overwrite'});
    assert.equal(result.overwritten,3);assert.equal(result.skipped,2);
    assert.equal(await fs.readFile(path.join(root,'same.txt'),'utf8'),'replacement');assert.equal(await fs.readFile(path.join(root,'blocked'),'utf8'),'keep');assert.ok((await fs.stat(path.join(root,'existing-dir'))).isDirectory());
    assert.equal((await fs.readdir(second.staging)).some(name=>name.startsWith('.backup-')),false);
    const third=await stage();
    await assert.rejects(publishZip(root,third.staging,third.entries,{policy:'invalid'}),/无效/);
    await assert.rejects(publishZip(root,third.staging,third.entries,{policy:'overwrite',beforePublish:()=>{throw new Error('quota');}}),/quota/);
    assert.equal(await fs.readFile(path.join(root,'same.txt'),'utf8'),'replacement');
    const rollback=await stage();
    await fs.unlink(path.join(rollback.staging,'new.txt'));
    await fs.writeFile(path.join(root,'same.txt'),'must survive failed publish');
    await assert.rejects(publishZip(root,rollback.staging,rollback.entries,{policy:'overwrite'}));
    assert.equal(await fs.readFile(path.join(root,'same.txt'),'utf8'),'must survive failed publish');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
