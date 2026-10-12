import { zip } from 'fflate';
export async function zipFolder(files, signal, onProgress) {
  if (files.reduce((n,f)=>n+f.size,0) > 128 * 1024 * 1024) throw new Error('浏览器压缩支持 128 MB 以内的文件夹；更大的文件夹请先压缩为 ZIP 后上传。');
  const entries = Object.create(null);
  for (let i=0;i<files.length;i++) {
    if(signal?.aborted)throw new Error('已取消上传');
    const file=files[i], name=file.webkitRelativePath||file.name;
    if(!name||name.startsWith('/')||name.split('/').some(x=>!x||x==='.'||x==='..')||/[\\:\x00-\x1f]/.test(name))throw new Error('文件夹中包含无效路径');
    entries[name]=new Uint8Array(await file.arrayBuffer());onProgress?.(i+1,files.length);
  }
  const data=await new Promise((resolve,reject)=>{
    const cancel=zip(entries,{level:3},(e,result)=>{signal?.removeEventListener('abort',abort);e?reject(e):resolve(result);});
    const abort=()=>{cancel();reject(new Error('已取消上传'));};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
  return new File([data],`${(files[0].webkitRelativePath||'folder').split('/')[0]}.zip`,{type:'application/zip'});
}
