import yauzl from 'yauzl';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import tar from 'tar-stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { crc32, createGunzip, createZstdDecompress } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { fail, relativePath, safePath, makeParents, anchored } from './files.js';
import { USER_FILE_ENTRY_LIMIT, fileEntryLimitMessage } from '../shared/file-limits.js';
import { archiveExtension } from '../shared/archive-formats.js';

const invalidArchive = '压缩包无效、损坏、加密或使用了不支持的压缩方式';

// TAR is parsed directly; bsdcat only decompresses TAR filters, never interprets
// archive entries. Restrict bsdtar conversion to signed 7Z/RAR input: its generic
// @archive reader also accepts formats such as mtree that can read local files.
export async function stageArchive(filename, staging, { name, ...options }) {
  const extension = archiveExtension(name);
  if (!extension) fail(400, '不支持此压缩包格式');
  if (extension === '.zip') return stageZip(filename, staging, options);
  if (extension === '.tar') return stageTar(createReadStream(filename), staging, options);
  // Node validates gzip CRCs (libarchive's gzip filter does not validate them).
  if (['.tar.gz', '.tgz', '.tar.zst', '.tzst'].includes(extension)) {
    return stageTar(createReadStream(filename), staging, options, [extension === '.tar.gz' || extension === '.tgz' ? createGunzip() : createZstdDecompress()]);
  }
  const converted = extension === '.7z' || extension === '.rar';
  const handle = await fs.open(filename, 'r');
  try {
    const signature = Buffer.alloc(8); await handle.read(signature, 0, 8, 0);
    let valid;
    if (extension === '.7z') valid = signature.subarray(0, 6).equals(Buffer.from('377abcaf271c', 'hex'));
    else if (extension === '.rar') valid = signature.subarray(0, 7).equals(Buffer.from('526172211a0700', 'hex')) || signature.equals(Buffer.from('526172211a070100', 'hex'));
    else if (['.tar.bz2', '.tbz2', '.tbz'].includes(extension)) valid = /^BZh[1-9]$/.test(signature.subarray(0, 4).toString('ascii'));
    else valid = signature.subarray(0, 6).equals(Buffer.from('fd377a585a00', 'hex'));
    if (!valid) fail(400, invalidArchive);
  } finally { await handle.close(); }
  const command = converted ? (process.platform === 'win32' ? 'tar.exe' : 'bsdtar') : 'bsdcat';
  // -P preserves unsafe names for our own validator; no native tool writes files.
  const args = converted ? ['-c', '-f', '-', '--format=pax', '-P', `@${path.resolve(filename)}`] : ['--', path.resolve(filename)];
  // No stdin or controlling terminal: encrypted input must fail without prompting.
  // Minimal Linux images default to the C locale, which rejects Unicode paths.
  const env = { ...process.env, TAR_READER_OPTIONS: '', TAR_WRITER_OPTIONS: '', ...(process.platform === 'linux' ? { LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' } : {}) };
  const child = spawn(command, args, { cwd: staging, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  let diagnostic = '', timedOut = false;
  child.stderr.on('data', chunk => { if (diagnostic.length < 4096) diagnostic += chunk.toString().slice(0, 4096 - diagnostic.length); });
  const completion = new Promise(resolve => {
    child.once('error', error => resolve({ error }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 120000);
  try {
    let result, failure;
    try { result = await stageTar(child.stdout, staging, options); }
    catch (error) { failure = error; child.kill('SIGKILL'); }
    const status = await completion;
    if (status.error?.code === 'ENOENT') fail(503, '服务器缺少解压工具，请安装 libarchive-tools（bsdtar、bsdcat）');
    if (timedOut) fail(408, '解压超时，请拆分压缩包后重试');
    if (failure?.status) throw failure;
    if (status.error || status.code !== 0 || diagnostic || failure) {
      if (/passphrase|password|encrypted|encryption/i.test(diagnostic)) fail(400, '不支持加密压缩包，请先解密后上传');
      fail(400, invalidArchive);
    }
    options.onProgress?.(result.entries.length, result.entries.length);
    return result;
  } finally { clearTimeout(timeout); child.kill('SIGKILL'); await completion; }
}

async function stageTar(input, staging, { maxFile, maxBytes, maxEntries = USER_FILE_ENTRY_LIMIT, onProgress }, filters = []) {
  const extract = tar.extract(), entries = [], names = new Set();
  let total = 0, actual = 0, inputBytes = 0, pendingEntry;
  const measure = new Transform({ transform(chunk, encoding, callback) { inputBytes += chunk.length; callback(null, chunk); } });
  extract.on('entry', (header, stream, next) => {
    // Parser/input errors can arrive while parent directories are being opened.
    stream.on('error', () => {});
    pendingEntry = (async () => {
      const directory = header.type === 'directory';
      if (!directory && header.type !== 'file' || header.linkname) fail(400, '压缩包不能包含链接或特殊文件');
      if (Object.keys(header.pax || {}).some(key => key.startsWith('GNU.sparse.') || key === 'SCHILY.realsize')) fail(400, '暂不支持 TAR 稀疏文件，请使用普通文件重新打包');
      if (!Number.isSafeInteger(header.size) || header.size < 0 || directory && header.size !== 0) fail(400, invalidArchive);
      // GNU/BSD tar commonly include a harmless ./ root and ./ path prefix.
      if (directory && (header.name === '.' || /^(\.\/)+$/.test(header.name))) { stream.resume(); return next(); }
      let name = header.name.replace(/^(\.\/)+/, '');
      if (directory) name = name.replace(/\/$/, '');
      const rel = relativePath(name, false);
      if (names.has(rel)) fail(400, `压缩包中包含重复路径：${rel}`);
      if (maxEntries != null && names.size >= maxEntries) fail(413, fileEntryLimitMessage(maxEntries));
      names.add(rel);
      if (header.size > maxFile || (total += header.size) > maxBytes) fail(413, '解压后文件大小超过存储配额或单文件上限');
      await makeParents(staging, rel + (directory ? '/placeholder' : ''));
      if (directory) stream.resume();
      else {
        let count = 0;
        const limit = new Transform({ transform(chunk, encoding, callback) {
          count += chunk.length; actual += chunk.length;
          callback(count > maxFile || actual > maxBytes ? Object.assign(new Error('解压后文件大小超过存储配额或单文件上限'), { status: 413 }) : null, chunk);
        } });
        const handle = await fs.open(path.join(staging, rel), 'wx', 0o600);
        try {
          if (extract.destroying) fail(400, invalidArchive);
          await pipeline(stream, limit, handle.createWriteStream());
        } finally { await handle.close().catch(() => {}); }
        if (count !== header.size) fail(400, invalidArchive);
      }
      entries.push({ path: rel, directory, size: header.size });
      onProgress?.(entries.length, 0); next();
    })().catch(error => { extract.destroy(error); });
  });
  try { await pipeline(input, ...filters, measure, extract); }
  catch (error) { if (error.status) throw error; fail(400, invalidArchive); }
  finally { await pendingEntry; }
  if (inputBytes < 512 || inputBytes % 512 !== 0) fail(400, invalidArchive);
  onProgress?.(entries.length, entries.length);
  return { entries, total };
}

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
