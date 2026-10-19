import path from 'node:path';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver';
import { fail, openSafe, safePath, walk } from './files.js';
import { USER_FILE_ENTRY_LIMIT, fileEntryLimitMessage } from '../shared/file-limits.js';

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

export async function downloadSelected(res, root, paths, filename, { maxEntries = USER_FILE_ENTRY_LIMIT } = {}) {
  // Validate and inventory every selected root before sending ZIP headers.
  const entries = [];
  for (const rel of paths) {
    const target = await safePath(root, rel), stat = await fs.lstat(target);
    if (stat.isFile()) entries.push({ path: rel, type: 'file' });
    else if (stat.isDirectory()) {
      entries.push({ path: rel, type: 'directory' });
      let children;
      try { children = await walk(root, maxEntries == null ? null : Math.max(0, maxEntries - entries.length), rel); }
      catch (error) { if (error.status === 413 && maxEntries != null) fail(413,fileEntryLimitMessage(maxEntries)); throw error; }
      for (const entry of children) entries.push({ ...entry, path: `${rel}/${entry.path}` });
    } else fail(400, '只能下载普通文件或文件夹');
    if (maxEntries != null && entries.length > maxEntries) fail(413, fileEntryLimitMessage(maxEntries));
  }
  res.setHeader('Content-Disposition', attachmentHeader(filename));
  res.type('application/zip');
  const archive = archiver('zip', { zlib: { level: 3 } });
  archive.on('error', () => res.destroy());
  res.on('close', () => archive.abort());
  archive.pipe(res);
  for (const entry of entries) {
    if (entry.type === 'directory') archive.append('', { name: `${entry.path}/` });
    else archive.append(Readable.from((async function* () {
      const { handle } = await openSafe(root, entry.path);
      try { for await (const chunk of handle.createReadStream()) yield chunk; }
      finally { await handle.close().catch(() => {}); }
    })()), { name: entry.path });
  }
  await archive.finalize();
}
