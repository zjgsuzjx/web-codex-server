import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { zipFolder } from '../src/zip-folder.js';
import { droppedFiles } from '../src/drop-files.js';
import { LiveSocket } from '../src/socket.js';

test('folder compression preserves nested and empty paths, compresses source, and supports cancellation',async()=>{
  const file=new File(['const example = "hello world";\n'.repeat(10000)],'source.js');
  Object.defineProperty(file,'uploadPath',{value:'project/src/source.js'});
  const progress=[],zip=await zipFolder([file],undefined,p=>progress.push(p),['project','project/src','project/empty']);
  const unpacked=unzipSync(new Uint8Array(await zip.arrayBuffer()));
  assert.equal(new TextDecoder().decode(unpacked['project/src/source.js']),await file.text());
  assert.ok('project/empty/' in unpacked);assert.ok(zip.size<file.size/10);assert.equal(progress.at(-1).percent,100);
  assert.ok(progress.every(p=>p.percent>=0&&p.percent<=100));
  await assert.rejects(zipFolder([file,file]),/重复路径/);
  const cancelled=new AbortController();
  await assert.rejects(zipFolder([file],cancelled.signal,()=>cancelled.abort()),/已取消/);
  const empty=await zipFolder([],undefined,undefined,['empty-folder']);
  assert.ok('empty-folder/' in unzipSync(new Uint8Array(await empty.arrayBuffer())));
});

test('dropped directories drain multiple reader batches and retain hierarchy and empty directories',async()=>{
  const fileEntry=name=>({name,isFile:true,file:callback=>callback(new File([name],name))});
  const directory=(name,batches)=>({name,isDirectory:true,createReader:()=>{let index=0;return{readEntries:callback=>callback(batches[index++]||[])};}});
  const root=directory('project',[
    Array.from({length:100},(_,i)=>fileEntry(`${i}.txt`)),
    [fileEntry('last.txt'),directory('empty',[[]]),directory('nested',[[fileEntry('code.js')]])]
  ]);
  const result=await droppedFiles({items:[{kind:'file',webkitGetAsEntry:()=>root,getAsFile:()=>null}],files:[]});
  assert.equal(result.folder,true);assert.equal(result.files.length,102);
  assert.ok(result.directories.includes('project/empty'));
  assert.equal(result.files.at(-1).uploadPath,'project/nested/code.js');
  const controller=new AbortController();controller.abort();
  await assert.rejects(droppedFiles({items:[{kind:'file',webkitGetAsEntry:()=>root,getAsFile:()=>null}],files:[]},controller.signal),/已取消/);
  const fallback=await droppedFiles({files:[new File(['plain'],'plain.txt')]});assert.equal(fallback.folder,false);assert.equal(fallback.files[0].name,'plain.txt');
});

test('socket conflict handling retries finish without retransmitting and applies the decision to remaining files',async()=>{
  const socket=Object.create(LiveSocket.prototype),calls=[],progress=[];let chunks=0,attempts=0;
  socket.call=async(method,params)=>{
    calls.push({method,params});
    if(method==='upload/check')return{conflictCount:0,conflicts:[]};
    if(method==='upload/begin')return{uploadId:params.path,offset:0,chunkSize:1024};
    if(method==='upload/finish'){
      if(!attempts++)throw Object.assign(new Error('conflict'),{code:'UPLOAD_CONFLICT',conflicts:[{path:'one.txt',overwrite:true}]});
      return{ok:true,uploaded:1};
    }
    return{};
  };
  socket.chunk=async data=>{chunks++;return{offset:data.byteLength};};
  let prompts=0;
  const results=await socket.upload({projectId:'project'},[new File(['one'],'one.txt'),new File(['two'],'two.txt')],p=>progress.push(p),undefined,async()=>{prompts++;return'overwrite';});
  assert.equal(results.length,2);assert.equal(prompts,1);assert.equal(chunks,2);
  assert.deepEqual(calls.filter(c=>c.method==='upload/finish').map(c=>c.params.conflictPolicy),['ask','overwrite','overwrite']);
  assert.equal(progress.at(-1).done,6);assert.equal(socket.listeners.size,0);
  const cancelled=Object.create(LiveSocket.prototype),cancelCalls=[];
  cancelled.call=async(method,params)=>{cancelCalls.push(method);if(method==='upload/begin')return{uploadId:'cancel',offset:0,chunkSize:1};if(method==='upload/finish')throw Object.assign(new Error('conflict'),{code:'UPLOAD_CONFLICT'});return{};};
  await assert.rejects(cancelled.upload({},[new File([],'empty.txt')],()=>{},undefined,async()=> 'cancel'),/已取消/);
  assert.deepEqual(cancelCalls,['upload/begin','upload/finish','upload/cancel']);assert.equal(cancelled.listeners.size,0);
  const preflight=Object.create(LiveSocket.prototype),preflightCalls=[];
  preflight.call=async method=>{preflightCalls.push(method);return{conflictCount:1,conflicts:[{path:'existing.txt',overwrite:true}]};};
  await assert.rejects(preflight.upload({projectId:'project'},[new File(['new'],'new.txt'),new File(['replace'],'existing.txt')],()=>{},undefined,async()=> 'cancel'),/已取消/);
  assert.deepEqual(preflightCalls,['upload/check']);
});
