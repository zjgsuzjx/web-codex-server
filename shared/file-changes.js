import { parsePatch, structuredPatch } from 'diff';

export function projectFilePath(value, cwd) {
  if (typeof value !== 'string' || !value || value.length > 2000) return null;
  let rel = value.replaceAll('\\', '/');
  for (const directory of Array.isArray(cwd) ? cwd : [cwd]) {
    const base = directory?.replaceAll('\\', '/').replace(/\/$/, '');
    if (base && rel.startsWith(base + '/')) { rel = rel.slice(base.length + 1); break; }
  }
  if (rel.startsWith('./')) rel = rel.slice(2);
  if (/^[\/]|[\x00-\x1f:]/.test(rel) || rel.split('/').some(part => !part || part === '.' || part === '..' || part.length > 200)) return null;
  if (rel.split('/').some(part => ['.git', 'node_modules', '.venv'].includes(part))) return null;
  return rel;
}

export function patchStats(patch) {
  let added = 0, removed = 0;
  for (const hunk of patch?.hunks || []) for (const line of hunk.lines || []) {
    if (line[0] === '+') added++; else if (line[0] === '-') removed++;
  }
  return { added, removed };
}

export function textFileChange(path, before, after, kind) {
  const patch = structuredPatch(path, path, before, after, '', '', { context: 3, timeout: 150 });
  if (!patch) return { path, kind, added: null, removed: null, reason: '内容差异过大，暂不提供逐行预览。' };
  return { path, kind, ...patchStats(patch), patches: [patch] };
}

export function changesSummary(files, { revision = 0, status = 'inProgress', source = 'snapshot', warning = '' } = {}) {
  return { revision, status, source, warning, added: files.reduce((n, file) => n + (file.added || 0), 0), removed: files.reduce((n, file) => n + (file.removed || 0), 0), unknown: files.filter(file => file.added == null).length,
    files: files.map(({ patches, ...file }) => file) };
}

function gitPath(value) {
  if (!value) return value;
  if (value.startsWith('"')) {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value.replace(/^[ab]\//, '');
}

export function unifiedChanges(diff, cwd) {
  if (typeof diff !== 'string' || diff.length > 4 * 1024 * 1024) return [];
  try {
    return parsePatch(diff).flatMap(patch => {
      const deleted = patch.newFileName === '/dev/null', added = patch.oldFileName === '/dev/null';
      const path = projectFilePath(gitPath(deleted ? patch.oldFileName : patch.newFileName), cwd);
      if (!path) return [];
      return [{ path, kind: deleted ? 'delete' : added ? 'add' : 'update', ...patchStats(patch), patches: [patch] }];
    });
  } catch { return []; }
}

// Older turns have operation patches, but no recoverable turn-start snapshot.
export function historicalChanges(turn, cwd) {
  const files = new Map();
  for (const item of turn.items || []) {
    if (item.type !== 'fileChange' || item.status !== 'completed') continue;
    for (const change of item.changes || []) {
      const path = projectFilePath(change.path, cwd); if (!path) continue;
      const kind = typeof change.kind === 'string' ? change.kind : change.kind?.type || 'update';
      let patches;
      try { patches = parsePatch(change.diff || '').filter(patch => patch.hunks?.length); } catch { patches = []; }
      let file;
      if (patches.length) file = { path, kind, patches, ...patchStats({ hunks: patches.flatMap(patch => patch.hunks) }) };
      else if (['add', 'delete'].includes(kind) && change.diff) file = textFileChange(path, kind === 'add' ? '' : change.diff, kind === 'add' ? change.diff : '', kind);
      else file = { path, kind, added: null, removed: null, reason: '历史记录未提供可解析的补丁。' };
      const previous = files.get(path);
      if (previous) file = { ...file, patches: [...(previous.patches || []), ...(file.patches || [])], added: previous.added == null || file.added == null ? null : previous.added + file.added, removed: previous.removed == null || file.removed == null ? null : previous.removed + file.removed };
      files.set(path, file);
    }
  }
  return [...files.values()];
}

export function hunkRows(hunk) {
  let oldLine = hunk.oldStart, newLine = hunk.newStart;
  return (hunk.lines || []).map(line => {
    const type = line[0] === '+' ? 'add' : line[0] === '-' ? 'delete' : line[0] === '\\' ? 'note' : 'context';
    return { type, text: line.slice(1).replace(/\r$/, ''), oldLine: ['add', 'note'].includes(type) ? null : oldLine++, newLine: ['delete', 'note'].includes(type) ? null : newLine++ };
  });
}
