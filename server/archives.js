import yauzl from 'yauzl';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { crc32 } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { fail, relativePath, safePath, makeParents, anchored } from './files.js';
import { USER_FILE_ENTRY_LIMIT, fileEntryLimitMessage } from '../shared/file-limits.js';

// Extract into a private spool first. Validate the entire archive before publishing.
export async function stageZip(filename, staging, { maxFile, maxBytes, maxEntries = USER_FILE_ENTRY_LIMIT, onProgress }) {
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
          if (names.has(rel)) fail(400, `压缩包中包含重复路径：${rel}`);
          if (maxEntries != null && names.size >= maxEntries) fail(413, fileEntryLimitMessage(maxEntries));
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
          entries.push({ path: rel, directory, size: entry.uncompressedSize });
          onProgress?.(entries.length, zip.entryCount); zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
    return { entries, total };
  } catch (e) { if (e.status) throw e; fail(400, 'ZIP 无效、损坏或解压数据超过限制'); }
  finally { zip.close(); }
}
export async function uploadPlan(root, entries, policy = 'ask') {
  if (!['ask', 'skip', 'overwrite'].includes(policy)) fail(400, '重名处理方式无效');
  const conflicts = [], accepted = []; let skipped = 0, growth = 0, overwritten = 0;
  for (const entry of entries) {
    const parts = relativePath(entry.path, false).split('/');
    let existing, conflict;
    for (let i = 1; i <= parts.length; i++) {
      const rel = parts.slice(0, i).join('/');
      const target = await safePath(root, rel, { missing: true });
      let stat;
      try { stat = await fs.lstat(target); } catch (e) { if (e.code === 'ENOENT') break; throw e; }
      if (!stat.isFile() && !stat.isDirectory()) fail(403, '不允许替换链接或特殊文件');
      if (i < parts.length && !stat.isDirectory()) { conflict = { path: entry.path, overwrite: false }; break; }
      if (i === parts.length) {
        existing = stat;
        if (!(entry.directory && stat.isDirectory())) conflict = { path: entry.path, overwrite: !entry.directory && stat.isFile() };
      }
    }
    if (conflict) {
      conflicts.push(conflict);
      // A file/folder type collision is never removed recursively by an upload.
      if (policy === 'skip' || policy === 'overwrite' && !conflict.overwrite) { skipped++; continue; }
      if (policy === 'overwrite') overwritten++;
    }
    accepted.push(entry);
    if (!entry.directory) growth += entry.size - (existing?.isFile() ? existing.size : 0);
  }
  return { entries: accepted, conflicts, skipped, growth, overwritten };
}

export async function publishZip(root, staging, entries, { policy = 'ask', beforePublish } = {}) {
  const plan = await uploadPlan(root, entries, policy);
  if (plan.conflicts.length && policy === 'ask') {
    const error = new Error('目标路径已存在，请选择重名文件的处理方式');
    Object.assign(error, { status: 409, code: 'UPLOAD_CONFLICT', conflicts: plan.conflicts.slice(0, 100), conflictCount: plan.conflicts.length });
    throw error;
  }
  await beforePublish?.(plan);
  const published = [];
  try {
    for (const entry of plan.entries) {
      await makeParents(root, entry.path + (entry.directory ? '/placeholder' : ''));
      if (entry.directory) continue;
      const anchor = await anchored(root, entry.path);
      let backup, keep = false;
      try {
        if (policy === 'overwrite') {
          try {
            const stat = await fs.lstat(anchor.target);
            if (!stat.isFile() || stat.isSymbolicLink()) fail(409, '目标文件类型已变化，请重新上传');
            backup = path.join(staging, `.backup-${randomUUID()}`);
            await fs.link(anchor.target, backup);
          } catch (e) { if (e.code !== 'ENOENT') throw e; }
        }
        const source = entry.source || path.join(staging, entry.path);
        if (backup) await fs.rename(source, anchor.target);
        else await fs.link(source, anchor.target);
        published.push({ path:entry.path, backup }); keep = true;
      } finally { await anchor.close(); if (!keep && backup) await fs.rm(backup, { force: true }); }
    }
  } catch (e) {
    for (const { path:rel, backup } of published.slice().reverse()) {
      // Re-open each bounded path during rollback; never retain one fd per file.
      try {
        const anchor = await anchored(root,rel);
        try { if (backup) await fs.rename(backup, anchor.target); else await fs.unlink(anchor.target); }
        finally { await anchor.close(); }
      } catch {}
    }
    if (e.code === 'EEXIST') fail(409, '目标文件已存在，请检查文件树后重试');
    throw e;
  } finally {
    for (const { backup } of published) if (backup) await fs.rm(backup, { force: true });
  }
  return { extracted: plan.entries.length, uploaded: plan.entries.filter(e => !e.directory).length, skipped: plan.skipped, overwritten: plan.overwritten };
}
