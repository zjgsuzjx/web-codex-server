import path from 'node:path';
import { fail, openSafe, relativePath } from './files.js';
import { imageMime } from './attachments.js';

const MAX_IMAGE = 32 * 1024 * 1024;
export function imageResult(value) {
  if (typeof value !== 'string' || !value) return null;
  const encoded = value.replace(/^data:image\/(?:png|jpeg|gif|webp);base64,/i, '');
  if (encoded.length > Math.ceil(MAX_IMAGE / 3) * 4) fail(413, '图片超过预览大小限制');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const data = Buffer.from(encoded, 'base64'), mime = imageMime(data);
  return mime.startsWith('image/') ? { data, mime } : null;
}

// Resolve CLI paths only within this thread's project or the owner's generated
// images directory. Never expose Codex configuration, credentials, or host files.
export function mediaLocation(config, user, thread, value) {
  if (typeof value !== 'string') fail(400, '图片路径无效');
  const home = path.posix.join(config.hostDataDir.replaceAll('\\', '/'), 'users', user.username);
  const project = path.join(config.dataDir, 'users', user.username, 'projects', thread.project_id);
  const generated = path.join(config.dataDir, 'users', user.username, 'codex', 'generated_images');
  for (const [prefix, root] of [[`/workspace/${thread.project_id}/`, project], [`${home}/projects/${thread.project_id}/`, project], ['/home/node/.codex/generated_images/', generated], [`${home}/codex/generated_images/`, generated]]) {
    if (value.startsWith(prefix)) return { root, rel: relativePath(value.slice(prefix.length), false) };
  }
  if (!value.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(value)) return { root: project, rel: relativePath(value, false) };
  fail(403, '图片不在当前对话可访问的目录中');
}
export async function readMedia(config, user, thread, value) {
  const { root, rel } = mediaLocation(config, user, thread, value);
  const { handle, stat } = await openSafe(root, rel);
  try {
    if (stat.size > MAX_IMAGE) fail(413, '图片超过预览大小限制');
    const data = await handle.readFile(), mime = imageMime(data);
    if (!mime.startsWith('image/')) fail(415, '文件不是支持的图片');
    return { data, mime };
  } finally { await handle.close(); }
}
