import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { zipSync } from 'fflate';
import { stageArchive, stageZip, publishZip, uploadPlan } from '../server/archives.js';
import { fileEntryLimit } from '../shared/file-limits.js';
import { ARCHIVE_EXTENSIONS, ARCHIVE_ACCEPT, archiveExtension, isArchive } from '../shared/archive-formats.js';
import { archiveBuffer, tarBuffer, rarStored, encryptedRar } from './helpers/archive-fixtures.js';
import { gzipSync } from 'node:zlib';

test('archive formats match picker and server names including uppercase and compound suffixes', () => {
  for (const extension of ARCHIVE_EXTENSIONS) {
    assert.equal(archiveExtension('项目' + extension.toUpperCase()), extension);
    assert.ok(ARCHIVE_ACCEPT.split(',').includes(extension));
  }
  for (const name of ['a.zip.exe', 'a.gz', 'a.7z.001', 'a.rar.part', 'a.tar.gz.txt', '', null]) assert.equal(isArchive(name), false);
});

test('mainstream archives preserve Unicode, nested files, empty files and directories', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-formats-'));
  try {
    for (const extension of ARCHIVE_EXTENSIONS.filter(ext => !['.zip', '.rar'].includes(ext))) await t.test(extension, async () => {
      const entries = [{name:'./',type:'directory'}, {name:'./中文/' ,type:'directory'}, {name:'./中文/hello.txt',data:'hello 中文'}, {name:'empty/',type:'directory'}, {name:'empty.txt'}];
      const filename = path.join(dir, 'input' + extension), staging = await fs.mkdtemp(path.join(dir, 'stage-')), root = await fs.mkdtemp(path.join(dir, 'root-'));
      await fs.writeFile(filename, await archiveBuffer(dir, extension, entries));
      const progress = [], result = await stageArchive(filename, staging, {name:'INPUT' + extension.toUpperCase(),maxFile:100,maxBytes:200,onProgress:(done,total)=>progress.push([done,total])});
      assert.equal(result.entries.length, 4); assert.equal(result.total, Buffer.byteLength('hello 中文'));
      assert.equal((await publishZip(root, staging, result.entries)).uploaded, 2);
      assert.equal(await fs.readFile(path.join(root, '中文/hello.txt'), 'utf8'), 'hello 中文');
      assert.ok((await fs.stat(path.join(root, 'empty'))).isDirectory());
      assert.equal((await fs.stat(path.join(root, 'empty.txt'))).size, 0);
      assert.equal(progress.at(-1)[0], 4);
    });
    const filename = path.join(dir, 'stored.rar'), staging = await fs.mkdtemp(path.join(dir, 'stage-'));
    await fs.writeFile(filename, rarStored);
    const result = await stageArchive(filename, staging, {name:'STORED.RAR',maxFile:100,maxBytes:100});
    assert.equal(result.entries.length, 1);
    assert.equal(await fs.readFile(path.join(staging, 'helloworld.txt'), 'utf8'), 'hello libarchive test suite!\n');
  } finally { await fs.rm(dir, { recursive:true, force:true }); }
});

test('TAR, compressed TAR and 7Z validate paths, links, duplicates and quotas before publication', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-archive-reject-'));
  try {
    for (const extension of ['.tar', '.tgz', '.7z']) await t.test(extension, async () => {
      async function stage(entries, limits = {}) {
        const filename = path.join(dir, 'bad' + extension), staging = await fs.mkdtemp(path.join(dir, 'stage-'));
        await fs.writeFile(filename, await archiveBuffer(dir, extension, entries));
        return stageArchive(filename, staging, {name:'bad' + extension,maxFile:100,maxBytes:150,maxEntries:3,...limits});
      }
      for (const name of ['../escape', '/absolute', './nested/../../escape', 'C:/absolute', ...(extension === '.7z' ? [] : ['bad\\path'])]) await assert.rejects(stage([{name,data:'unsafe'}]), error => error.status === 400);
      for (const type of ['symlink', 'link']) await assert.rejects(stage([{name:'target',data:'safe'}, {name:'linked',type,linkname:'target'}]), /链接|压缩包/);
      // Some formats cannot represent duplicate paths or special TAR entry types.
      if (extension !== '.7z') {
        await assert.rejects(stage([{name:'dup',data:'one'}, {name:'./dup',data:'two'}]), /重复路径/);
        for (const type of ['fifo','block-device','character-device']) await assert.rejects(stage([{name:'special',type}]), /链接或特殊文件/);
      }
      await assert.rejects(stage([{name:'large',data:'x'.repeat(101)}]), error => error.status === 413);
      await assert.rejects(stage([{name:'a',data:'x'.repeat(80)}, {name:'b',data:'x'.repeat(80)}]), error => error.status === 413);
      await assert.rejects(stage(Array.from({length:4},(_,i)=>({name:'d'+i,type:'directory'}))), error => error.status === 413);
      assert.equal((await stage(Array.from({length:4},(_,i)=>({name:'d'+i,type:'directory'})), {maxEntries:null})).entries.length, 4);
    });
    async function raw(name, data) {
      const filename = path.join(dir, 'raw'), staging = await fs.mkdtemp(path.join(dir, 'stage-'));
      await fs.writeFile(filename, data);
      return stageArchive(filename, staging, {name,maxFile:100,maxBytes:200});
    }
    for (const name of ['bad.tar','bad.tgz','bad.7z','bad.rar']) await assert.rejects(raw(name, Buffer.from('not an archive')), error => error.status === 400);
    await assert.rejects(raw('bad.tar', Buffer.alloc(0)), error => error.status === 400);
    const valid = await tarBuffer([{name:'data',data:'ok'}]);
    await assert.rejects(raw('truncated.tar', valid.subarray(0, 513)), error => error.status === 400);
    const gzip = gzipSync(valid); gzip[gzip.length-8] ^= 0xff;
    await assert.rejects(raw('corrupt.tgz', gzip), error => error.status === 400);
    await assert.rejects(raw('truncated.rar', rarStored.subarray(0, 75)), error => error.status === 400);
    await assert.rejects(raw('encrypted.rar', await encryptedRar()), error => error.status === 400);
    for (const extension of ['.7z','.tar.bz2','.tar.xz']) {
      const corrupted = await archiveBuffer(dir,extension,[{name:'file',data:'content'}]);
      corrupted[corrupted.length-6] ^= 0xff;
      await assert.rejects(raw('corrupt'+extension,corrupted), error => error.status === 400);
    }
    // Renaming an mtree manifest must never make the converter read host files.
    const mtree = Buffer.from('#mtree\nsecret type=file contents=/etc/passwd\n');
    for (const name of ['spoof.7z','spoof.rar','spoof.tar']) await assert.rejects(raw(name,mtree), error => error.status === 400);
    await assert.rejects(raw('spoof.tgz',gzipSync(mtree)), error => error.status === 400);
  } finally { await fs.rm(dir, { recursive:true, force:true }); }
});

test('ZIP entry counts support an unlimited role policy without disabling path or byte checks',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sv-zip-count-')),filename=path.join(dir,'input.zip');
  async function stage(limits,data=zipSync({'a/':new Uint8Array(),'b/':new Uint8Array(),'c/':new Uint8Array()})) {
    await fs.writeFile(filename,data);const staging=await fs.mkdtemp(path.join(dir,'stage-'));
    return stageZip(filename,staging,{maxFile:10,maxBytes:20,...limits});
  }
  try {
    await assert.rejects(stage({maxEntries:2}),e=>e.status===413&&/2 项/.test(e.message));
    assert.equal((await stage({maxEntries:fileEntryLimit({role:'superadmin'})})).entries.length,3);
    await assert.rejects(stage({maxEntries:null},zipSync({'../escape':new Uint8Array()})),e=>e.status===400);
    await assert.rejects(stage({maxEntries:null},zipSync({'big':new Uint8Array(11)})),/上限/);
    const duplicate=Buffer.from(zipSync({'a/':new Uint8Array(),'b/':new Uint8Array()}));
    for(let at=0;(at=duplicate.indexOf('b/',at))!==-1;at+=2)duplicate.write('a/',at);
    await assert.rejects(stage({maxEntries:null},duplicate),e=>e.status===400&&/重复路径/.test(e.message)&&!/数量/.test(e.message));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

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
