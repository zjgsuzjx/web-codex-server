import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { unzipSync } from 'fflate';
import { walk } from '../server/files.js';
import { downloadSelected } from '../server/downloads.js';

test('tree and grouped ZIP downloads respect finite and unlimited entry budgets',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sv-file-limits-'));
  await fs.mkdir(path.join(root,'folder'));await fs.writeFile(path.join(root,'folder/a'),'one');await fs.writeFile(path.join(root,'folder/b'),'two');
  function response(){const res=new PassThrough();res.headers=new Map();res.setHeader=(name,value)=>res.headers.set(name,value);res.type=value=>res.setHeader('Content-Type',value);return res;}
  try{
    await assert.rejects(walk(root,1,'folder'),e=>e.status===413&&/1 项/.test(e.message));
    const tree=await walk(root,null,'folder');
    assert.equal(tree.length,2);
    const stat=await fs.stat(path.join(root,'folder/a'));
    assert.equal(tree.find(entry=>entry.path==='a').modified,stat.mtimeMs);
    assert.equal(tree.find(entry=>entry.path==='a').created,stat.birthtimeMs>0?stat.birthtimeMs:null);
    const limited=response();
    await assert.rejects(downloadSelected(limited,root,['folder'],'selected.zip',{maxEntries:2}),e=>e.status===413&&/2 项/.test(e.message));
    assert.equal(limited.headers.size,0);limited.destroy();
    const unlimited=response(),chunks=[];
    unlimited.on('data',chunk=>chunks.push(chunk));
    const done=new Promise((resolve,reject)=>{unlimited.once('finish',resolve);unlimited.once('error',reject);});
    await Promise.all([downloadSelected(unlimited,root,['folder'],'selected.zip',{maxEntries:null}),done]);
    const zip=unzipSync(Buffer.concat(chunks));assert.equal(new TextDecoder().decode(zip['folder/a']),'one');assert.equal(new TextDecoder().decode(zip['folder/b']),'two');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
