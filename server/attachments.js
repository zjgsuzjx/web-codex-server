import path from 'node:path';
import { fail, openSafe } from './files.js';
import { executionTarget } from './execution.js';

export const attachmentRoot = (config, user) => path.join(config.dataDir, 'users', user.username, 'codex', 'chat-attachments');
export const attachmentRel = item => `${item.id}/${item.name}`;
export const attachmentPublic = item => ({ id: item.id, name: item.name, size: item.size, mime: item.mime, url: `/api/attachments/${item.id}/content` });
export function attachmentName(value) {
  if (typeof value !== 'string' || !value || value.length > 180 || /[\x00-\x1f/\\:]/.test(value) || ['.', '..'].includes(value)) fail(400, '附件名称无效');
  return value;
}
export function imageMime(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString())) return 'image/gif';
  if (data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}
export async function attachmentInput(config, user, item) {
  const { handle } = await openSafe(attachmentRoot(config, user), attachmentRel(item));
  await handle.close();
  const base = executionTarget(user) === 'server'
    ? path.posix.join(config.hostDataDir.replaceAll('\\', '/'), 'users', user.username, 'codex', 'chat-attachments')
    : '/home/node/.codex/chat-attachments';
  const location = `${base}/${attachmentRel(item)}`;
  return item.mime.startsWith('image/') ? { type: 'localImage', path: location } : { type: 'mention', name: item.name, path: location };
}
