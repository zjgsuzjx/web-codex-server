import { imageMime } from './attachments.js';
import { openSafe, fail } from './files.js';

export async function fileImageMime(handle, rel) {
  const buffer = Buffer.alloc(4096);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  const head = buffer.subarray(0, bytesRead), mime = imageMime(head);
  if (mime !== 'application/octet-stream') return mime;
  if (head.subarray(0, 2).toString() === 'BM') return 'image/bmp';
  if (head.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return 'image/x-icon';
  if (head.subarray(4, 8).toString() === 'ftyp' && /avif|avis/.test(head.subarray(8, 40).toString())) return 'image/avif';
  if (/\.svg$/i.test(rel) && /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head.toString('utf8').replace(/^\uFEFF/, ''))) return 'image/svg+xml';
  return null;
}
export async function serveFileImage(res, root, rel) {
  const { handle, stat } = await openSafe(root, rel);
  let streaming = false;
  try {
    const mime = await fileImageMime(handle, rel);
    if (!mime) fail(415, '此文件不是支持的图片格式');
    res.set({ 'Content-Type': mime, 'Content-Length': String(stat.size), 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'Cache-Control': 'no-store' });
    const stream = handle.createReadStream({ start: 0 }); streaming = true;
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  } finally { if (!streaming) await handle.close(); }
}
