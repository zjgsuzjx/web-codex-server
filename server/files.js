import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { USER_FILE_ENTRY_LIMIT, fileEntryLimitMessage } from '../shared/file-limits.js';

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const fail = (status, message) => { throw new HttpError(status, message); };
export function relativePath(value, allowEmpty = true) {
  if (typeof value !== 'string' || value.length > 1000 || /[\x00-\x1f\\:]/.test(value)) fail(400, '文件路径无效');
  if (!value && allowEmpty) return '';
  if (!value || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..' || p.length > 200)) fail(400, '文件路径无效');
  return value;
}
// Refuse every symlink component, even when the symlink currently points inside the project.
export async function safePath(root, value = '', { missing = false } = {}) {
  relativePath(value);
  let current = path.resolve(root);
  const base = await fs.lstat(current);
  if (base.isSymbolicLink() || !base.isDirectory()) fail(403, '项目目录无效');
  const parts = value ? value.split('/') : [];
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const st = await fs.lstat(current);
      if (st.isSymbolicLink()) fail(403, '不允许访问符号链接');
      if (i < parts.length - 1 && !st.isDirectory()) fail(400, '父路径不是文件夹');
    } catch (e) { if (e.code === 'ENOENT' && missing) continue; if (e.code === 'ENOENT') fail(404, '文件不存在'); throw e; }
  }
  return current;
}
export async function makeParents(root, value) {
  const parts = relativePath(value, false).split('/').slice(0, -1);
  if (process.platform !== 'linux') { let rel=''; for(const part of parts){rel=rel?`${rel}/${part}`:part;const target=await safePath(root,rel,{missing:true});try{await fs.mkdir(target);}catch(e){if(e.code!=='EEXIST')throw e;}await safePath(root,rel);}return; }
  let dir = await openDirectory(root);
  try { for(const part of parts){const target=`/proc/self/fd/${dir.fd}/${part}`;try{await fs.mkdir(target);}catch(e){if(e.code!=='EEXIST')throw e;}const next=await openDirectory(target);await dir.close();dir=next;} } finally { await dir.close(); }
}
async function openDirectory(target) {
  try { return await fs.open(target, constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW || 0)); }
  catch(e) { if(['ELOOP','ENOTDIR'].includes(e.code)) fail(403,'不允许访问符号链接或非目录路径'); if(e.code==='ENOENT')fail(404,'文件不存在');throw e; }
}
// On production Linux, pin each directory with an fd. /proc/self/fd anchors every
// operation even if a concurrent terminal command renames/replaces its ancestors.
export async function anchored(root, rel) {
  relativePath(rel,false);
  if(process.platform!=='linux'){const target=await safePath(root,rel,{missing:true});return{target,close:async()=>{}};}
  const parts=rel.split('/');const name=parts.pop();let dir=await openDirectory(root);
  try{for(const part of parts){const next=await openDirectory(`/proc/self/fd/${dir.fd}/${part}`);await dir.close();dir=next;}return{target:`/proc/self/fd/${dir.fd}/${name}`,close:()=>dir.close()};}catch(e){await dir.close();throw e;}
}
export async function walk(root, max = USER_FILE_ENTRY_LIMIT, start = '', { skipNames, pruneNames, filter } = {}) {
  const entries = [];
  async function visit(rel, dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory() && skipNames?.has(item.name)) continue;
      const name = rel ? `${rel}/${item.name}` : item.name;
      try{relativePath(name,false);}catch{continue;}
      if (filter && !await filter(name, item.isDirectory())) continue;
      const target = path.join(dir,item.name);
      let st;try{st=await fs.lstat(target);}catch(e){if(e.code==='ENOENT')continue;throw e;}
      if(st.isSymbolicLink())continue;
      if (!st.isDirectory() && !st.isFile()) continue;
      entries.push({ path: name, name: item.name, type: st.isDirectory() ? 'directory' : 'file', size: st.size, modified: st.mtimeMs, created: Number.isFinite(st.birthtimeMs) && st.birthtimeMs > 0 ? st.birthtimeMs : null });
      if (max != null && entries.length > max) fail(413, fileEntryLimitMessage(max));
      if (st.isDirectory() && !pruneNames?.has(item.name)) {if(process.platform==='linux'){const handle=await openDirectory(target);try{await visit(name,`/proc/self/fd/${handle.fd}`);}finally{await handle.close();}}else await visit(name,await safePath(root,start?`${start}/${name}`:name));}
    }
  }
  if(process.platform==='linux'){let anchor;try{anchor=start?await anchored(root,start):null;const handle=await openDirectory(anchor?.target||root);try{await visit('',`/proc/self/fd/${handle.fd}`);}finally{await handle.close();}}finally{await anchor?.close();}}
  else await visit('',await safePath(root,start));
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
export async function openSafe(root, rel, flags = 'r') {
  const anchor=await anchored(root,rel);let handle;
  try{handle=await fs.open(anchor.target,flags==='r'?constants.O_RDONLY|(constants.O_NOFOLLOW||0):flags);}catch(e){if(e.code==='ELOOP')fail(403,'不允许访问符号链接');if(e.code==='ENOENT')fail(404,'文件不存在');throw e;}finally{await anchor.close();}
  const st = await handle.stat();
  if (!st.isFile()) { await handle.close(); fail(400, '只能读取普通文件'); }
  return { handle, stat: st };
}
export async function etag(root, rel) {
  const { handle } = await openSafe(root, rel);
  try { return createHash('sha256').update(await handle.readFile()).digest('hex'); } finally { await handle.close(); }
}
export async function atomicWrite(root, rel, content, uploadsDir) {
  await makeParents(root, rel);
  const anchor = await anchored(root,rel);
  const temp = path.join(uploadsDir, randomUUID());
  try{await fs.writeFile(temp,content,{mode:0o600,flag:'wx'});await fs.rename(temp,anchor.target);}finally{await anchor.close();await fs.rm(temp,{force:true});}
}
export async function safeRename(root,from,to){await safePath(root,from);await makeParents(root,to);const source=await anchored(root,from),dest=await anchored(root,to);try{try{await fs.lstat(dest.target);fail(409,'目标路径已存在');}catch(e){if(e.code!=='ENOENT')throw e;}await fs.rename(source.target,dest.target);}finally{await source.close();await dest.close();}}
export async function safeRemove(root,rel){await safePath(root,rel);const anchor=await anchored(root,rel);async function remove(target){const st=await fs.lstat(target);if(st.isDirectory()&&!st.isSymbolicLink()){if(process.platform==='linux'){const dir=await openDirectory(target);try{for(const name of await fs.readdir(`/proc/self/fd/${dir.fd}`))await remove(`/proc/self/fd/${dir.fd}/${name}`);}finally{await dir.close();}await fs.rmdir(target);}else await fs.rm(target,{recursive:true});}else await fs.unlink(target);}try{await remove(anchor.target);}finally{await anchor.close();}}
