import { Zip, AsyncZipDeflate, ZipPassThrough } from 'fflate';
import { USER_FILE_ENTRY_LIMIT, fileEntryLimitMessage } from '../shared/file-limits.js';

export const FOLDER_MAX_BYTES = 128 * 1024 * 1024;
export function uploadPath(file) { return file.uploadPath || file.webkitRelativePath || file.name; }

// fflate writes 16-bit EOCD counts. Add ZIP64 end records when counts overflow;
// file sizes/offsets still fit ZIP32 because browser folder data is byte-bounded.
async function folderArchive(chunks, count, name) {
  const blob = new Blob(chunks, {type:'application/zip'});
  if (blob.size >= 0xffffffff) throw new Error('浏览器生成的压缩包超过 4 GiB，请手工压缩为 ZIP64 后上传');
  if (count < 0xffff) return new File([blob],name,{type:blob.type});
  const end = new Uint8Array(await blob.slice(-22).arrayBuffer()), legacy = new DataView(end.buffer);
  if (legacy.getUint32(0,true) !== 0x06054b50) throw new Error('压缩包目录记录无效');
  const records = new Uint8Array(76), view = new DataView(records.buffer);
  view.setUint32(0,0x06064b50,true); view.setBigUint64(4,44n,true);
  view.setUint16(12,45,true); view.setUint16(14,45,true);
  view.setBigUint64(24,BigInt(count),true); view.setBigUint64(32,BigInt(count),true);
  view.setBigUint64(40,BigInt(legacy.getUint32(12,true)),true);
  view.setBigUint64(48,BigInt(legacy.getUint32(16,true)),true);
  view.setUint32(56,0x07064b50,true); view.setBigUint64(64,BigInt(blob.size-22),true); view.setUint32(72,1,true);
  legacy.setUint16(8,0xffff,true); legacy.setUint16(10,0xffff,true);
  legacy.setUint32(12,0xffffffff,true); legacy.setUint32(16,0xffffffff,true);
  return new File([blob.slice(0,-22),records,end],name,{type:blob.type});
}

// Stream one file at a time through a worker at DEFLATE's highest compression level.
export async function zipFolder(files, signal, onProgress, directories = [], { maxEntries = USER_FILE_ENTRY_LIMIT } = {}) {
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > FOLDER_MAX_BYTES) throw new Error('浏览器压缩支持 128 MB 以内的文件夹；更大的文件夹请先压缩为 ZIP 后上传。');
  const names = new Set();
  for (const name of [...directories, ...files.map(uploadPath)]) {
    if (!name || name.startsWith('/') || name.split('/').some(x => !x || x === '.' || x === '..') || /[\\:\x00-\x1f]/.test(name)) throw new Error('文件夹中包含无效路径');
    if (names.has(name)) throw new Error(`本次上传包含重复路径：${name}`);
    names.add(name);
  }
  if (maxEntries != null && names.size > maxEntries) throw new Error(fileEntryLimitMessage(maxEntries));
  const chunks = [];
  let archive, rejectPending, settled = false, done = 0;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = error => {
      if (settled) return;
      settled = true; archive?.terminate(); cleanup(); rejectPending?.(error); reject(error);
    };
    const abort = () => fail(new Error('已取消上传'));
    archive = new Zip((error, data, final) => {
      if (settled) return;
      if (error) { fail(error); return; }
      chunks.push(data);
      if (final) {
        const root = (uploadPath(files[0] || {}) || directories[0] || 'folder').split('/')[0];
        folderArchive(chunks,names.size,`${root}.zip`).then(file=>{
          if (settled) return;
          settled = true; cleanup();
          onProgress?.({phase:'compressing',done:total,total,index:files.length,count:files.length,percent:100});
          resolve(file);
        }).catch(fail);
      }
    });
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) { abort(); return; }
    (async () => {
      for (let index=0;index<directories.length;index++) {
        if (signal?.aborted) throw new Error('已取消上传');
        const name=directories[index];
        const entry = new ZipPassThrough(`${name}/`); archive.add(entry); entry.push(new Uint8Array(), true);
        if (index % 128 === 0) {
          onProgress?.({phase:'compressing',name,done:0,total,index:index+1,count:names.size,percent:total ? 0 : Math.min(99,(index+1)/names.size*100)});
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }
      for (let index = 0; index < files.length; index++) {
        if (signal?.aborted) throw new Error('已取消上传');
        const file = files[index], name = uploadPath(file), entry = file.size ? new AsyncZipDeflate(name, {level:9}) : new ZipPassThrough(name);
        archive.add(entry);
        const finished = new Promise((r, j) => {
          rejectPending = j;
          const output = entry.ondata;
          entry.ondata = (error, data, final) => { output(error, data, final); if (error) j(error); else if (final) r(); };
        });
        finished.catch(() => {});
        for (let offset = 0; offset < file.size || offset === 0; offset += 512 * 1024) {
          const end = Math.min(file.size, offset + 512 * 1024);
          const data = new Uint8Array(await file.slice(offset, end).arrayBuffer());
          if (signal?.aborted) throw new Error('已取消上传');
          entry.push(data, end === file.size);
          onProgress?.({phase:'compressing',name,done:done + end,total,index:index + 1,count:files.length,percent:Math.min(99,total ? (done + end) / total * 100 : 0)});
          if (end === file.size) break;
        }
        await finished; rejectPending = null; done += file.size;
        if (index % 128 === 0) await new Promise(resolve=>setTimeout(resolve,0));
      }
      archive.end();
    })().catch(fail);
  });
}
