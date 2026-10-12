import yauzl from 'yauzl';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { crc32 } from 'node:zlib';
import { fail, relativePath, safePath, makeParents, anchored, safeRemove } from './files.js';

// Extract into a private spool first. Validate the entire archive before publishing.
export async function stageZip(filename, staging, { maxFile, maxBytes, maxEntries = 20000 }) {
  const zip = await new Promise((resolve, reject) => yauzl.open(filename, { lazyEntries: true, autoClose: false, strictFileNames: true }, (e, z) => e ? reject(e) : resolve(z))).catch(() => fail(400, 'ZIP 无效或已损坏'));
  const entries = [], names = new Set(); let total = 0, actual = 0;
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject); zip.on('end', resolve);
      zip.on('entry', entry => {
        (async () => {
          const directory = entry.fileName.endsWith('/'), rel = relativePath(directory ? entry.fileName.slice(0, -1) : entry.fileName, false);
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (mode && mode !== 0x8000 && mode !== 0x4000) fail(400, '压缩包不能包含链接或特殊文件');
          if (entry.generalPurposeBitFlag & 1) fail(400, '不支持加密 ZIP');
          if (names.has(rel) || names.size >= maxEntries) fail(413, '压缩包路径重复或文件数量超过上限');
          names.add(rel);
          if (entry.uncompressedSize > maxFile || (total += entry.uncompressedSize) > maxBytes) fail(413, '解压后文件大小超过存储配额或单文件上限');
          await makeParents(staging, `${rel}${directory ? '/placeholder' : ''}`);
          if (!directory) {
            const stream = await new Promise((r, j) => zip.openReadStream(entry, (e, s) => e ? j(e) : r(s)));
            let count = 0, crc = 0;
            const limit = new Transform({ transform(chunk, encoding, cb) { count += chunk.length; actual += chunk.length; crc = crc32(chunk, crc); cb(count > maxFile || actual > maxBytes ? new Error('解压数据超过上限') : null, chunk); } });
            const handle = await fs.open(path.join(staging, rel), 'wx', 0o600);
            try { await pipeline(stream, limit, handle.createWriteStream()); } finally { await handle.close().catch(() => {}); }
            if (crc !== entry.crc32) fail(400, 'ZIP 文件校验失败');
          }
          entries.push({ path: rel, directory, size: entry.uncompressedSize }); zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
    return { entries, total };
  } catch (e) { if (e.status) throw e; fail(400, 'ZIP 无效、损坏或解压数据超过限制'); }
  finally { zip.close(); }
}
export async function publishZip(root, staging, entries) {
  for (const entry of entries) {
    const target = await safePath(root, entry.path, { missing: true });
    try { const st = await fs.lstat(target); if (!entry.directory || !st.isDirectory()) fail(409, `目标路径已存在：${entry.path}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const published = [];
  try {
    for (const entry of entries) {
      await makeParents(root, entry.path + (entry.directory ? '/placeholder' : ''));
      if (entry.directory) continue;
      const anchor = await anchored(root, entry.path);
      try { await fs.link(path.join(staging, entry.path), anchor.target); published.push(entry.path); } finally { await anchor.close(); }
    }
  } catch (e) {
    for (const rel of published.reverse()) await safeRemove(root, rel).catch(() => {});
    if (e.code === 'EEXIST') fail(409, '目标文件已存在，请检查文件树后重试');
    throw e;
  }
}
