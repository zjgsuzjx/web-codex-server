import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { zipSync } from 'fflate';
import { stageZip, publishZip } from '../server/archives.js';

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
