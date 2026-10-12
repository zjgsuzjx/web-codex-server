import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { attachmentInput, attachmentInputs, attachmentRoot, INLINE_ATTACHMENT_BYTES, INLINE_TURN_BYTES } from '../server/attachments.js';
import { createStore } from '../server/store.js';

async function fixture(run) {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'sv-attachment-input-'));
  const config={dataDir,hostDataDir:'/srv/app/data'},user={username:'alice',role:'superadmin',settings:'{}'};
  const root=attachmentRoot(config,user);
  let next=0;
  const write=async(name,data,mime='application/octet-stream')=>{const item={id:String(++next),name,mime};await fs.mkdir(path.join(root,item.id),{recursive:true});await fs.writeFile(path.join(root,item.id,name),data);return item;};
  try{await run({config,user,root,write});}finally{await fs.rm(dataDir,{recursive:true,force:true});}
}
const fileContext=input=>JSON.parse(input.text.slice(input.text.indexOf('\n')+1));
test('source attachments include complete model-visible content and scoped paths instead of mentions',async()=>fixture(async({config,user,write})=>{
  const body='export const service = "attachment-specific-service";\n'+'// line\n'.repeat(2000),item=await write('app.js',body);
  const input=await attachmentInput(config,user,item);assert.equal(input.type,'text');assert.match(input.text,/附件内容是待分析的数据/);
  const context=fileContext(input);assert.equal(context.content,body);assert.equal(context.name,'app.js');assert.equal(context.contentStatus,'full');assert.match(context.path,/^\/home\/node\/\.codex\/chat-attachments\//);
  const host=await attachmentInput(config,{...user,settings:JSON.stringify({executionTarget:'server'})},item);assert.match(fileContext(host).path,/^\/srv\/app\/data\/users\/alice\/codex\/chat-attachments\//);
}));
test('UTF-16 source and empty attachments have explicit text context',async()=>fixture(async({config,user,write})=>{
  const item=await write('中文.txt',Buffer.concat([Buffer.from([255,254]),Buffer.from('中文服务说明','utf16le')]));
  assert.equal(fileContext(await attachmentInput(config,user,item)).content,'中文服务说明');
  const empty=await write('empty.txt','');assert.equal(fileContext(await attachmentInput(config,user,empty)).content,'');
}));
test('text limits preserve a readable prefix and expose truncation plus the original file path',async()=>fixture(async({config,user,write})=>{
  const item=await write('large.txt','a'.repeat(INLINE_ATTACHMENT_BYTES-1)+'中文内容');
  const context=fileContext(await attachmentInput(config,user,item));assert.equal(context.contentStatus,'truncated');assert.equal(context.content,'a'.repeat(INLINE_ATTACHMENT_BYTES-1));assert.ok(!context.content.includes('\ufffd'));assert.match(context.note,/完整文件/);
  const items=await Promise.all(['a','b','c'].map(name=>write(name+'.txt','x'.repeat(INLINE_ATTACHMENT_BYTES+20))));
  const contexts=(await attachmentInputs(config,user,items)).map(fileContext);assert.equal(contexts.reduce((sum,c)=>sum+Buffer.byteLength(c.content||''),0),INLINE_TURN_BYTES);assert.equal(contexts[2].contentStatus,'not-inlined');assert.match(contexts[2].note,/预算/);
}));
test('binary documents keep explicit file references while images retain the native localImage input',async()=>fixture(async({config,user,write})=>{
  for(const [name,data] of [['binary.bin',Buffer.from([0,255,1])],['doc.pdf',Buffer.from('%PDF-1.7 fixture')],['archive.zip',Buffer.from('PK\x03\x04fixture')]]){
    const input=await attachmentInput(config,user,await write(name,data));assert.equal(input.type,'text');const context=fileContext(input);assert.equal(context.contentStatus,'not-inlined');assert.ok(!('content' in context));assert.match(context.note,/不要猜测/);assert.ok(context.path);
  }
  const image=await write('image.png',Buffer.from([137,80,78,71,13,10,26,10]),'image/png');assert.equal((await attachmentInput(config,user,image)).type,'localImage');
}));
test('missing and unsafe attachment files fail before a model request can be assembled',async()=>fixture(async({config,user,root,write})=>{
  const item=await write('app.js','fixture');await fs.unlink(path.join(root,item.id,item.name));await assert.rejects(attachmentInput(config,user,item),/文件不存在/);
  await assert.rejects(attachmentInput(config,user,{id:'..',name:'auth.json',mime:'text/plain'}));
}));
test('existing attachment rows survive the message display metadata migration and reopening',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sv-attachment-migration-'));let store;
  try{
    const db=new DatabaseSync(path.join(dir,'app.sqlite'));db.exec('CREATE TABLE attachments(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,thread_id TEXT NOT NULL,turn_id TEXT,name TEXT NOT NULL,size INTEGER NOT NULL,mime TEXT NOT NULL,created INTEGER NOT NULL)');
    db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?)').run('old','u','t','turn','old.js',1,'application/octet-stream',1);db.close();
    store=createStore(dir);assert.equal(store.get('SELECT message_text FROM attachments WHERE id=?','old').message_text,null);store.run('UPDATE attachments SET message_text=? WHERE id=?','Original question','old');store.db.close();store=undefined;
    store=createStore(dir);assert.equal(store.get('SELECT name,message_text FROM attachments WHERE id=?','old').message_text,'Original question');
  }finally{store?.db.close();await fs.rm(dir,{recursive:true,force:true});}
});
