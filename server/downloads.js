import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { openSafe } from './files.js';

export function attachmentHeader(name) {
  const safe = name.replace(/[\r\n"\\]/g, '_');
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const fallback = safe.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function downloadFile(res, root, rel) {
  const { handle, stat } = await openSafe(root, rel);
  try {
    res.setHeader('Content-Disposition', attachmentHeader(path.posix.basename(rel)));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    await pipeline(handle.createReadStream({ autoClose: false }), res);
  } finally { await handle.close().catch(() => {}); }
}
