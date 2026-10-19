import { Zip, AsyncZipDeflate, ZipPassThrough } from 'fflate';

export const FOLDER_MAX_BYTES = 128 * 1024 * 1024;
export function uploadPath(file) { return file.uploadPath || file.webkitRelativePath || file.name; }

// Stream one file at a time through a worker at DEFLATE's highest compression level.
export async function zipFolder(files, signal, onProgress, directories = []) {
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > FOLDER_MAX_BYTES) throw new Error('浏览器压缩支持 128 MB 以内的文件夹；更大的文件夹请先压缩为 ZIP 后上传。');
  const names = new Set();
  for (const name of [...directories, ...files.map(uploadPath)]) {
    if (!name || name.startsWith('/') || name.split('/').some(x => !x || x === '.' || x === '..') || /[\\:\x00-\x1f]/.test(name)) throw new Error('文件夹中包含无效路径');
    if (names.has(name)) throw new Error(`本次上传包含重复路径：${name}`);
    names.add(name);
  }
  if (names.size > 20000) throw new Error('文件夹中的文件或目录数量超过 20000 项上限');
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
      if (error) { fail(error); return; }
      chunks.push(data);
      if (final) {
        settled = true; cleanup();
        onProgress?.({phase:'compressing',done:total,total,index:files.length,count:files.length,percent:100});
        const root = (uploadPath(files[0] || {}) || directories[0] || 'folder').split('/')[0];
        resolve(new File(chunks, `${root}.zip`, {type:'application/zip'}));
      }
    });
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) { abort(); return; }
    (async () => {
      for (const name of directories) {
        const entry = new ZipPassThrough(`${name}/`); archive.add(entry); entry.push(new Uint8Array(), true);
      }
      for (let index = 0; index < files.length; index++) {
        if (signal?.aborted) throw new Error('已取消上传');
        const file = files[index], name = uploadPath(file), entry = new AsyncZipDeflate(name, {level:9});
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
      }
      archive.end();
    })().catch(fail);
  });
}
