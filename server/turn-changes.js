import { createHash } from 'node:crypto';
import { openSafe, walk } from './files.js';
import { changesSummary, historicalChanges, projectFilePath, textFileChange, unifiedChanges } from '../shared/file-changes.js';
import { USER_FILE_ENTRY_LIMIT, fileEntryLimit } from '../shared/file-limits.js';
import { changeFileFilter, generatedChangePath } from './change-files.js';

const skipNames = new Set(['.git', 'node_modules', '.venv']);
const sourcePriority = name => /\.(?:[cm]?[jt]sx?|cs|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|vue|svelte|html|css|scss|sh|ps1)$/i.test(name) ? 0 : 1;
export async function projectSnapshot(root, { maxFile = 4 * 1024 * 1024, maxBytes = 32 * 1024 * 1024, maxEntries = USER_FILE_ENTRY_LIMIT, baseline } = {}) {
  const files = new Map(); let used = 0;
  try {
    const filter = await changeFileFilter(root, baseline);
    const entries = await walk(root, maxEntries, '', { skipNames, filter });
    // Source baselines come before large assets; unchanged files share their
    // immutable baseline instead of consuming a second snapshot's text budget.
    entries.sort((a, b) => sourcePriority(a.path) - sourcePriority(b.path) || a.path.localeCompare(b.path));
    for (const entry of entries) {
      if (entry.type !== 'file') continue;
      const previous = baseline?.files.get(entry.path);
      const metadata = { size: entry.size, modified: entry.modified, content: null };
      files.set(entry.path, metadata);
      if (entry.size > maxFile) { metadata.reason = '文件超过单文件逐行预览大小限制。'; continue; }
      let opened;
      try {
        opened = await openSafe(root, entry.path);
        metadata.size = opened.stat.size; metadata.modified = opened.stat.mtimeMs;
        if (opened.stat.size > maxFile) { metadata.reason = '文件超过单文件逐行预览大小限制。'; continue; }
        // A file can grow during a tool operation. Never use unbounded readFile.
        const buffer = Buffer.alloc(Math.min(maxFile + 1, opened.stat.size + 1)); let length = 0;
        while (length < buffer.length) { const { bytesRead } = await opened.handle.read(buffer, length, buffer.length - length, length); if (!bytesRead) break; length += bytesRead; }
        if (length > maxFile || length > opened.stat.size) { metadata.reason = '文件仍在写入，暂不提供逐行预览。'; continue; }
        const bytes = buffer.subarray(0, length); metadata.hash = createHash('sha256').update(bytes).digest('hex');
        if (previous?.content != null && previous.hash === metadata.hash) { metadata.content = previous.content; continue; }
        try {
          if (bytes.includes(0)) throw new Error();
          const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if (used + length > maxBytes) metadata.reason = '本轮文本快照已达到容量限制，未保留此文件的逐行预览。';
          else { metadata.content = content; used += length; }
        }
        catch { metadata.reason = '二进制或非 UTF-8 文件，不提供逐行预览。'; }
      } catch { metadata.reason = '文件无法安全读取。'; }
      finally { await opened?.handle.close(); }
    }
    return { files };
  } catch { return { files, warning: '项目快照读取不完整，无法计算完整的本轮净变更。' }; }
}

export function compareSnapshots(before, after, moves = new Map()) {
  if (before.warning || after.warning) return [];
  const renamed = [], consumed = new Set(), candidates = new Map(moves);
  const addedByHash = new Map();
  for (const [newPath, current] of after.files) if (!before.files.has(newPath) && current.hash) {
    const matches = addedByHash.get(current.hash) || []; matches.push(newPath); addedByHash.set(current.hash, matches);
  }
  for (const [oldPath, old] of before.files) {
    if (after.files.has(oldPath) || !old.hash || candidates.has(oldPath)) continue;
    const matching = addedByHash.get(old.hash);
    if (matching?.length === 1) candidates.set(oldPath, matching[0]);
  }
  for (const [oldPath, newPath] of candidates) {
    const old = before.files.get(oldPath), current = after.files.get(newPath);
    if (!old || !current || after.files.has(oldPath) || before.files.has(newPath) || consumed.has(newPath)) continue;
    const file = old.content != null && current.content != null ? textFileChange(newPath, old.content, current.content, 'rename') : { path: newPath, kind: 'rename', added: null, removed: null, reason: current.reason || old.reason };
    renamed.push({ ...file, previousPath: oldPath }); consumed.add(oldPath); consumed.add(newPath);
  }
  const changed = [...new Set([...before.files.keys(), ...after.files.keys()])].sort().flatMap(path => {
    if (consumed.has(path)) return [];
    const old = before.files.get(path), current = after.files.get(path);
    if (old && current && (old.hash && current.hash ? old.hash === current.hash : old.size === current.size && old.modified === current.modified)) return [];
    const kind = !old ? 'add' : !current ? 'delete' : 'update';
    if ((!old || old.content != null) && (!current || current.content != null)) return [textFileChange(path, old?.content || '', current?.content || '', kind)];
    return [{ path, kind, added: null, removed: null, reason: current?.reason || old?.reason || '暂不提供逐行预览。' }];
  });
  return [...renamed, ...changed].sort((a, b) => a.path.localeCompare(b.path));
}

export function createTurnChanges({ store, root, cwd, emit, snapshot = projectSnapshot, delay = 600 }) {
  const states = new Map(); let closed = false;
  const key = (uid, tid) => `${uid}:${tid}`;
  const row = (tid, turnId) => store.get('SELECT * FROM turn_changes WHERE thread_id=? AND turn_id=?', tid, turnId);
  function stored(saved, details = false) {
    const summary = JSON.parse(saved.summary), files = details ? JSON.parse(saved.details) : summary.files;
    // Existing histories may contain scratch files captured before project filtering.
    const visible = summary.scope === 'project' ? files : files.filter(file => !generatedChangePath(file.path));
    return { ...summary, ...changesSummary(visible, summary), ...(details ? { files: visible } : {}) };
  }
  function save(state, files, source, warning = '') {
    let detailBytes = 0;
    files = files.map(file => {
      if (!file.patches) return file;
      const size = Buffer.byteLength(JSON.stringify(file.patches), 'utf8');
      if (detailBytes + size > 4 * 1024 * 1024) return { ...file, patches: undefined, reason: '本轮差异预览超过大小限制。' };
      detailBytes += size; return file;
    });
    const revision = (row(state.thread.id, state.turnId)?.revision || 0) + 1;
    const summary = { ...changesSummary(files, { revision, status: state.status, source, warning }), scope: 'project' };
    store.run('INSERT INTO turn_changes(thread_id,turn_id,revision,summary,details) VALUES(?,?,?,?,?) ON CONFLICT(thread_id,turn_id) DO UPDATE SET revision=excluded.revision,summary=excluded.summary,details=excluded.details', state.thread.id, state.turnId, revision, JSON.stringify(summary), JSON.stringify(files));
    emit(state.user.id, { method: 'turn/changes/updated', params: { threadId: state.thread.id, turnId: state.turnId, changes: summary } });
  }
  function refresh(state) {
    if (state.running) { state.again = true; return state.running; }
    state.running = (async () => {
      do {
        state.again = false;
        const after = await snapshot(state.root, {maxEntries:fileEntryLimit(store.user(state.user.id) || state.user), baseline: state.before});
        if (closed || state.again || !state.turnId) continue;
        const warning = state.before.warning || after.warning;
        const native = unifiedChanges(state.nativeDiff, state.cwd).filter(file => after.files.has(file.path) || state.before.files.has(file.path) || !generatedChangePath(file.path));
        const files = warning ? native : compareSnapshots(state.before, after, state.moves).map(file => {
          const fallback = !file.patches && native.find(candidate => candidate.path === file.path && candidate.kind === file.kind);
          return fallback ? { ...fallback, previousPath: file.previousPath, previewWarning: '快照未保留完整文本，以下为 Codex 记录的本轮修改补丁。' } : file;
        });
        save(state, files, warning ? 'native' : 'snapshot', warning || '');
      } while (!closed && state.again);
    })().catch(() => {}).finally(() => { state.running = null; if (state.status !== 'inProgress') states.delete(key(state.user.id, state.thread.id)); });
    return state.running;
  }
  return {
    busy() { return [...states.values()].some(state => state.running); },
    async begin(user, thread) {
      const id = key(user.id, thread.id);
      const previous = states.get(id);
      if (previous?.running) await previous.running;
      if (previous?.status === 'inProgress') return; // CLI rejects overlapping turns.
      const state = { user, thread, root: root(user, thread), cwd: cwd(user, thread), status: 'inProgress', turnId: null, moves: new Map() };
      state.before = await snapshot(state.root, {maxEntries:fileEntryLimit(user)}); states.set(id, state);
    },
    bind(user, thread, turnId) { const state = states.get(key(user.id, thread.id)); if (state && !state.turnId) state.turnId = turnId; },
    cancel(user, thread) { const state = states.get(key(user.id, thread.id)); if (state && !state.turnId) states.delete(key(user.id, thread.id)); },
    observe(uid, event) {
      if (closed) return;
      if (event.method === 'connection/lost') {
        for (const state of states.values()) if (state.user.id === uid) { state.status = 'failed'; clearTimeout(state.timer); if (state.turnId) void refresh(state); else states.delete(key(uid, state.thread.id)); }
        return;
      }
      const p = event.params || {}, tid = p.threadId || p.thread?.id;
      const state = states.get(key(uid, tid));
      if (!state) {
        const thread = tid && store.get('SELECT * FROM threads WHERE id=? AND user_id=?', tid, uid);
        if (!thread) return;
        if (event.method === 'turn/diff/updated' && p.turnId) {
          const saved = row(tid, p.turnId); if (saved && JSON.parse(saved.summary).status !== 'inProgress') return;
          const user = store.user(uid); save({ user, thread, turnId: p.turnId, status: 'inProgress' }, unifiedChanges(p.diff, cwd(user, thread)).filter(file => !generatedChangePath(file.path)), 'native', '此轮没有开始快照，显示 Codex 提供的修改补丁。');
        } else if (event.method === 'turn/completed' && p.turn?.id) {
          const saved = row(tid, p.turn.id), summary = saved && JSON.parse(saved.summary);
          if (summary?.status === 'inProgress') save({ user: store.user(uid), thread, turnId: p.turn.id, status: p.turn.status }, stored(saved, true).files, summary.source, '跟踪曾中断，显示最后一次捕获的变更。');
        }
        return;
      }
      if (event.method === 'turn/started') state.turnId ||= p.turn?.id;
      if (p.turnId && state.turnId && p.turnId !== state.turnId || p.turn?.id && state.turnId && p.turn.id !== state.turnId) return;
      if (event.method === 'turn/diff/updated') state.nativeDiff = typeof p.diff === 'string' && p.diff.length <= 4 * 1024 * 1024 ? p.diff : '';
      if (event.method === 'item/completed' && p.item?.type === 'fileChange' && p.item.status === 'completed') {
        for (const change of p.item.changes || []) {
          const from = projectFilePath(change.path, state.cwd), to = projectFilePath(change.kind?.move_path, state.cwd);
          if (!from || !to) continue;
          const first = [...state.moves].find(([, target]) => target === from)?.[0] || from;
          state.moves.delete(from); state.moves.set(first, to);
        }
      }
      if (event.method === 'turn/completed' || event.method === 'connection/lost') {
        state.status = p.turn?.status || 'failed'; clearTimeout(state.timer);
        if (state.turnId) void refresh(state); else states.delete(key(uid, tid));
      } else if (event.method === 'turn/diff/updated' || event.method === 'item/completed' && ['fileChange', 'commandExecution'].includes(p.item?.type)) {
        if (!state.timer) { state.timer = setTimeout(() => { state.timer = null; if (state.turnId) void refresh(state); }, delay); state.timer.unref?.(); }
      }
    },
    summary(thread, turn) {
      const saved = row(thread.id, turn.id); if (saved) return stored(saved);
      const user = store.user(thread.user_id), files = historicalChanges(turn, cwd(user, thread)).filter(file => !generatedChangePath(file.path));
      return files.length ? changesSummary(files, { status: turn.status, source: 'history', warning: '此历史轮次仅保留操作补丁，行数为已记录的修改操作总计。' }) : null;
    },
    details(thread, turnId) { const saved = row(thread.id, turnId); return saved ? stored(saved, true) : null; },
    fork(from, to) { store.run('INSERT OR IGNORE INTO turn_changes SELECT ?,turn_id,revision,summary,details FROM turn_changes WHERE thread_id=?', to, from); },
    async close() { closed = true; for (const state of states.values()) clearTimeout(state.timer); await Promise.all([...states.values()].map(state => state.running)); states.clear(); }
  };
}
