import { FOLDER_MAX_BYTES } from './zip-folder.js';

// Capture entries synchronously: the browser protects DataTransfer after drop returns.
export function droppedFiles(dataTransfer, signal, onProgress) {
  const items = [...(dataTransfer.items || [])].filter(item => item.kind === 'file');
  const roots = items.map(item => ({entry:(item.getAsEntry || item.webkitGetAsEntry)?.call(item),file:item.getAsFile()}));
  const fallback = [...dataTransfer.files];
  return (async () => {
    const files = [], directories = []; let bytes = 0, folder = false;
    const check = () => { if (signal?.aborted) throw new Error('已取消上传'); };
    function add(file, name) {
      check(); bytes += file.size;
      if (folder && bytes > FOLDER_MAX_BYTES) throw new Error('浏览器压缩支持 128 MB 以内的文件夹；更大的文件夹请先压缩为 ZIP 后上传。');
      if (name) Object.defineProperty(file, 'uploadPath', {value:name,configurable:true});
      files.push(file); onProgress?.({phase:'scanning',name:name || file.name,index:files.length,count:0,done:0,total:0});
      if (files.length + directories.length > 20000) throw new Error('文件夹中的文件或目录数量超过 20000 项上限');
    }
    async function visit(entry, prefix = '') {
      check();
      const name = prefix + entry.name;
      if (entry.isFile) { add(await new Promise((resolve,reject) => entry.file(resolve,reject)), name); return; }
      if (!entry.isDirectory) throw new Error('拖入的项目无法读取，请使用上传菜单重试');
      directories.push(name);
      if (files.length + directories.length > 20000) throw new Error('文件夹中的文件或目录数量超过 20000 项上限');
      const reader = entry.createReader();
      while (true) {
        check();
        const batch = await new Promise((resolve,reject) => reader.readEntries(resolve,reject));
        if (!batch.length) break;
        for (const child of batch) await visit(child, `${name}/`);
      }
    }
    folder = roots.some(root => root.entry?.isDirectory);
    if (roots.length) for (const root of roots) {
      if (root.entry) await visit(root.entry);
      else if (root.file) add(root.file);
      else throw new Error('拖入的项目无法读取，请使用上传菜单重试');
    }
    else for (const file of fallback) add(file);
    return {files,directories,folder};
  })();
}
