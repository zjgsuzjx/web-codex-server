import express from 'express';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import archiver from 'archiver';
import TOML from '@iarna/toml';
import { createStore, passwordHash, passwordMatches, digest } from './store.js';
import { CodexManager } from './codex.js';
import { createResources } from './resources.js';
import { ROLES, isAdministrator, executionTarget, projectCwd } from './execution.js';
import { fail, safePath, relativePath, makeParents, walk, openSafe, etag, atomicWrite, anchored, safeRename, safeRemove } from './files.js';
import { attachmentRoot, attachmentRel, attachmentPublic, attachmentName, imageMime, attachmentInputs } from './attachments.js';
import { stageZip, publishZip } from './archives.js';
import { imageResult, readMedia } from './chat-media.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MB = 1024 * 1024;
const defaultSettings = { model: '', effort: 'medium', approvalPolicy: 'on-request', sandbox: 'dangerFullAccess', networkAccess: true, mode: 'default', executionTarget: 'workspace' };
function settings(value) {
  const s = { ...defaultSettings, ...value };
  if (!['workspace', 'server'].includes(s.executionTarget)) fail(400, '执行环境无效');
  if (typeof s.model !== 'string' || s.model.length > 100 || typeof s.effort !== 'string' || !/^[a-z]{1,20}$/.test(s.effort) || !['untrusted', 'on-request', 'never'].includes(s.approvalPolicy) || !['readOnly', 'workspaceWrite', 'dangerFullAccess'].includes(s.sandbox) || typeof s.networkAccess !== 'boolean' || !['default', 'plan'].includes(s.mode)) fail(400, 'Codex 设置无效');
  return Object.fromEntries(Object.keys(defaultSettings).map(k => [k, s[k]]));
}
const threadSettings = s => ({ ...(s.model ? { model: s.model } : {}), approvalPolicy: s.approvalPolicy, sandbox: { readOnly: 'read-only', workspaceWrite: 'workspace-write', dangerFullAccess: 'danger-full-access' }[s.sandbox] });
export async function createApp(options = {}) {
  const config = {
    dataDir: path.resolve(process.env.DATA_DIR || './data'), hostDataDir: process.env.HOST_DATA_DIR || path.resolve('./data'),
    publicUrl: process.env.PUBLIC_URL || 'http://localhost:3100', secure: process.env.COOKIE_SECURE === 'true', inviteCode: process.env.INVITE_CODE || '',
    workerImage: process.env.WORKER_IMAGE || 'starvalley-codex-worker:local', workerMemory: Number(process.env.WORKER_MEMORY_MB || 384), maxWorkers: Number(process.env.MAX_ACTIVE_WORKERS || 2),
    enableHostExecution: process.env.ENABLE_HOST_EXECUTION === 'true', hostCodexScript: process.env.HOST_CODEX_SCRIPT || '', hostCodexBin:process.env.HOST_CODEX_BIN || '/usr/local/bin', changingUsers: new Set(),
    nestedSandbox: process.env.ENABLE_NESTED_SANDBOX === 'true', maxUsers: Number(process.env.MAX_USERS || 10), quota: Number(process.env.USER_QUOTA_MB || 512) * MB, maxFile: Number(process.env.MAX_FILE_MB || 256) * MB, ...options
  };
  config.templateDir ||= path.join(config.dataDir, 'template');
  const store = createStore(config.dataDir), app = express(), server = createServer(app), wss = new WebSocketServer({ noServer: true, maxPayload: MB + 4096 });
  config.resolveUser = id => store.user(id);
  const clients = new Map(), uploads = new Map(), uploadLocks = new Set(), rates = new Map(), mutationLocks = new Map(), eventCounters = new Map();
  let resources;
  const titleJobs = new Map(), attachmentSends = new Map();
  const userDir = u => path.join(config.dataDir, 'users', u.username);
  const root = (u, p) => path.join(userDir(u), 'projects', p.id);
  const uploadsDir = u => path.join(config.dataDir, 'uploads', u.id);
  const send = (ws, value) => { if (ws.readyState === WebSocket.OPEN) { if (ws.bufferedAmount > 8 * MB) ws.close(1013, '客户端处理过慢，请重连'); else ws.send(JSON.stringify(value)); } };
  const emit = (uid, msg) => {
    if(!store.user(uid))return;
    resources?.observe(uid, msg);
    const tid = msg.params?.threadId || msg.params?.thread?.id || null;
    const t = tid && store.get('SELECT * FROM threads WHERE id=? AND user_id=?', tid, uid);
    if (t && msg.method === 'thread/tokenUsage/updated') store.run('UPDATE threads SET token_usage=? WHERE id=?', JSON.stringify(msg.params.tokenUsage), tid);
    if (t && msg.method === 'turn/started') bindAttachments(uid, tid, msg.params.turn.id);
    if (t && msg.params?.item) msg = { ...msg, params: { ...msg.params, item: decorateItem(uid, tid, msg.params.turnId, msg.params.item) } };
    if (t && msg.params?.turn) msg = { ...msg, params: { ...msg.params, turn: decorateTurn(uid, tid, msg.params.turn) } };
    if (t && msg.method === 'thread/name/updated' && msg.params.threadName && t.title_state !== 'manual') setTitle(uid, tid, msg.params.threadName);
    // Codex owns durable conversation history; reconnect re-reads it via thread/read.
    // Keeping output deltas out of SQLite avoids duplicate unbounded history storage.
    const seq=(eventCounters.get(uid)||0)+1;eventCounters.set(uid,seq);
    if (msg.method === 'thread/archived' && tid) store.run('UPDATE threads SET archived=1 WHERE id=? AND user_id=?', tid, uid);
    for (const ws of clients.get(uid) || []) send(ws, { type: 'codex/event', seq, event: msg });
    if (t && msg.method === 'turn/completed' && msg.params.turn.status === 'completed') void autoTitle(uid, tid);
  };
  const codex = options.codexFactory ? options.codexFactory(config, emit) : new CodexManager(config, emit);
  function bindAttachments(uid, tid, turnId) {
    const pending = attachmentSends.get(`${uid}:${tid}`);
    for (const [index, id] of (pending?.ids || []).entries()) store.run('UPDATE attachments SET turn_id=?,message_text=? WHERE id=? AND user_id=? AND thread_id=? AND turn_id IS NULL', turnId, index === 0 ? pending.text : null, id, uid, tid);
  }
  function decorateItem(uid, tid, turnId, item) {
    if (item.type === 'imageGeneration') {
      const { result, ...metadata } = item;
      // Keep multi-megabyte image payloads out of WebSocket events and history
      // JSON. Fetch bytes through the authenticated, thread-scoped endpoint.
      return { ...metadata, imageUrl: result || item.savedPath ? `/api/threads/${encodeURIComponent(tid)}/turns/${encodeURIComponent(turnId)}/images/${encodeURIComponent(item.id)}` : null };
    }
    if (item.type !== 'userMessage') return item;
    // Forked turns retain their IDs and attachment references in Codex history.
    const attachments = store.all('SELECT * FROM attachments WHERE user_id=? AND turn_id=?', uid, turnId);
    const original = attachments.find(attachment => attachment.message_text != null)?.message_text;
    // CLI history includes model-only attachment context. Keep the user's
    // original question and attachment chips in the browser, including forks.
    return { ...item, ...(original != null ? { text: original, content: [{ type: 'text', text: original }, ...(item.content || []).filter(content => content.type !== 'text')] } : {}), attachments: attachments.map(attachmentPublic) };
  }
  function decorateTurn(uid, tid, turn) { return { ...turn, items: (turn.items || []).map(i => decorateItem(uid, tid, turn.id, i)) }; }
  function setTitle(uid, tid, title) {
    title = title.trim().slice(0, 100); if (!title) return;
    const changed = store.run("UPDATE threads SET title=?,title_state='generated' WHERE id=? AND user_id=? AND title_state!='manual'", title, tid, uid);
    if (changed.changes) emit(uid, { method: 'thread/title/updated', params: { threadId: tid, title } });
  }
  async function autoTitle(uid, tid) {
    if (titleJobs.has(tid) || store.thread({id:uid}, tid).title_state !== 'pending') return;
    const job = (async () => {
      try {
        const user = store.user(uid), r = await codex.call(user, 'thread/read', { threadId: tid, includeTurns: true });
        if (r.thread.name) { setTitle(uid, tid, r.thread.name); return; }
        const first = r.thread.turns?.find(turn => turn.status === 'completed' && turn.items?.some(i => i.type === 'userMessage'));
        if (!first || !codex.generateTitle) return;
        const exchange = decorateTurn(uid, tid, first).items.filter(i => ['userMessage','agentMessage'].includes(i.type)).map(i => i.type === 'userMessage' ? `User: ${i.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n') || i.text || ''}` : `Assistant: ${i.text || ''}`).join('\n').slice(0,12000);
        const title = await codex.generateTitle(user, exchange);
        // Manual edits and native names that arrived during generation win.
        if (store.thread(user, tid).title_state === 'pending') {
          setTitle(uid, tid, title);
          await codex.call(user, 'thread/name/set', { threadId: tid, name: title }).catch(() => {});
        }
      } catch { /* Keep the provisional title; retry when history is opened. */ }
    })();
    titleJobs.set(tid, job); await job; titleJobs.delete(tid);
  }
  const allowedOrigin = req => !req.headers.origin || req.headers.origin === new URL(config.publicUrl).origin;
  const publicUser = u => ({ id: u.id, username: u.username, role: u.role, settings: settings(JSON.parse(u.settings)), nestedSandbox: config.nestedSandbox, hostExecution: u.role === 'superadmin' && config.enableHostExecution, hostProjectBase:u.role==='superadmin'?path.posix.join(config.hostDataDir.replaceAll('\\','/'),'users',u.username,'projects'):undefined, csrf: u.csrf });
  const cookie = token => `sv_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${config.secure ? '; Secure' : ''}`;
  function rate(req, category, limit) {
    const key = `${req.ip}:${category}`, now = Date.now();
    if (rates.size > 10000) for (const [k, v] of rates) if (v.until < now) rates.delete(k);
    const entry = rates.get(key);
    if (!entry || entry.until < now) rates.set(key, { count: 1, until: now + 15 * 60000 });
    else if (++entry.count > limit) fail(429, '请求过于频繁，请 15 分钟后重试');
  }
  async function mutation(u, fn) {
    const before = mutationLocks.get(u.id) || Promise.resolve();
    const next = before.catch(() => {}).then(fn); mutationLocks.set(u.id, next);
    try { return await next; } finally { resources?.invalidateStorage(u.id); if (mutationLocks.get(u.id) === next) mutationLocks.delete(u.id); }
  }
  async function used(u) {
    const dir = path.join(userDir(u), 'projects'); await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(attachmentRoot(config, u), { recursive: true });
    return [...await walk(dir), ...await walk(attachmentRoot(config, u))].reduce((n, x) => n + (x.type === 'file' ? x.size : 0), 0);
  }
  resources = createResources(config, codex, used);
  async function quota(u, extra) {
    const reserved = [...uploads.values()].filter(x => x.uid === u.id).reduce((n, x) => n + x.size, 0);
    if (await used(u) + reserved + extra > config.quota) fail(413, '用户存储配额不足');
  }
  async function userDirs(u) {
    await fs.mkdir(path.join(userDir(u), 'projects'), { recursive: true });
    await fs.mkdir(path.join(userDir(u), 'codex'), { recursive: true });
    await fs.mkdir(uploadsDir(u), { recursive: true, mode: 0o700 });
  }
  app.disable('x-powered-by'); app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'" });
    if (!allowedOrigin(req)) return res.status(403).json({ error: '请求来源无效' }); next();
  });
  app.use(express.json({ limit: '3mb' }));
  app.get('/api/health', (req, res) => {
    const busy = uploads.size || mutationLocks.size || titleJobs.size || codex.starting?.size || [...codex.instances.values()].some(i => i.active?.size || i.terminals?.size || i.requests?.size || i.pending?.size);
    res.json({ status: 'ok', version: '1.0.0', revision: process.env.APP_REVISION || null, deploymentReady: !busy });
  });
  app.get('/api/session', (req, res) => { const u = store.auth(req); res.json({ user: u ? publicUser(u) : null, inviteRequired: !!config.inviteCode || !!store.get('SELECT id FROM users LIMIT 1') }); });
  async function login(res, u) {
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
    store.run('INSERT INTO sessions(hash,user_id,csrf,expires) VALUES(?,?,?,?)', digest(token), u.id, csrf, Date.now() + 7 * 86400000);
    res.setHeader('Set-Cookie', cookie(token)); res.json({ user: publicUser({ ...u, csrf }) });
  }
  app.post('/api/register', async (req, res) => {
    rate(req, 'auth', 20); const { username, password, inviteCode } = req.body;
    if (typeof username !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/.test(username)) fail(400, '用户名需 3–32 位，以字母开头，可包含数字、下划线和连字符');
    if (typeof password !== 'string' || password.length < 10 || password.length > 128) fail(400, '密码需 10–128 个字符');
    const existingUsers = store.get('SELECT COUNT(*) AS n FROM users').n;
    const legacyInvite = config.inviteCode && typeof inviteCode === 'string' && timingSafeEqual(Buffer.from(digest(inviteCode)), Buffer.from(digest(config.inviteCode)));
    const invite = typeof inviteCode === 'string' && store.get('SELECT * FROM invites WHERE hash=? AND revoked=0 AND used_by IS NULL AND expires>?', digest(inviteCode), Date.now());
    if ((config.inviteCode || existingUsers) && !legacyInvite && !invite) fail(403, '邀请码无效、已使用或已过期');
    const normalized = username.toLowerCase();
    if (store.get('SELECT id FROM users WHERE username=?', normalized)) fail(409, '用户名已存在');
    const hash = await passwordHash(password);
    if (store.get('SELECT COUNT(*) AS n FROM users').n >= config.maxUsers) fail(403, '用户数量已达上限，请联系管理员');
    const u = { id: randomUUID(), username: normalized, password: hash, role: store.get('SELECT COUNT(*) AS n FROM users').n ? 'user' : 'superadmin', settings: JSON.stringify(defaultSettings) };
    store.db.exec('BEGIN IMMEDIATE');
    try {
      store.run('INSERT INTO users(id,username,password,role,settings,created) VALUES(?,?,?,?,?,?)', u.id, u.username, u.password, u.role, u.settings, Date.now());
      if (invite && !store.run('UPDATE invites SET used_by=?,used_at=? WHERE id=? AND used_by IS NULL AND revoked=0 AND expires>?', u.id, Date.now(), invite.id, Date.now()).changes) fail(403, '邀请码已使用或已过期');
      store.db.exec('COMMIT');
    } catch (e) { store.db.exec('ROLLBACK'); if (e.code?.includes('SQLITE')) fail(409, '用户名已存在'); throw e; }
    await userDirs(u); store.audit(u.id, 'register'); await login(res, u);
  });
  const dummyHash = await passwordHash(randomUUID());
  app.post('/api/login', async (req, res) => {
    rate(req, 'auth', 20); const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 128 || username.length > 100) fail(400, '登录信息无效');
    const u = store.get('SELECT * FROM users WHERE username=?', username.toLowerCase());
    if (!await passwordMatches(password, u?.password || dummyHash) || !u) fail(401, '用户名或密码不正确');
    store.audit(u.id, 'login'); await login(res, u);
  });
  app.use('/api', (req, res, next) => {
    req.user = store.auth(req); if (!req.user) return res.status(401).json({ error: '请先登录' });
    if (config.changingUsers.has(req.user.id)) return res.status(409).json({error:'账号权限正在更新，请重新登录'});
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-csrf-token'] !== req.user.csrf) return res.status(403).json({ error: '安全令牌失效，请刷新页面' }); next();
  });
  app.post('/api/logout', (req, res) => { store.run('DELETE FROM sessions WHERE hash=?', req.user.session_hash); for (const ws of clients.get(req.user.id) || []) if (ws.sessionHash === req.user.session_hash) ws.close(4001, '已退出登录'); res.setHeader('Set-Cookie', 'sv_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'); res.json({ ok: true }); });
  app.post('/api/password', async (req, res) => {
    rate(req, 'password', 10); const { oldPassword, newPassword } = req.body;
    if (typeof oldPassword !== 'string' || oldPassword.length > 128 || typeof newPassword !== 'string' || newPassword.length < 10 || newPassword.length > 128) fail(400, '密码无效');
    if (!await passwordMatches(oldPassword, req.user.password)) fail(400, '原密码不正确');
    store.run('UPDATE users SET password=? WHERE id=?', await passwordHash(newPassword), req.user.id);
    store.run('DELETE FROM sessions WHERE user_id=?', req.user.id); for (const ws of clients.get(req.user.id) || []) ws.close(4001, '密码已修改'); store.audit(req.user.id, 'password/change'); await login(res, store.user(req.user.id));
  });
  app.get('/api/projects', (req, res) => res.json(store.all('SELECT id,name,created FROM projects WHERE user_id=? ORDER BY created DESC', req.user.id)));
  app.post('/api/projects', async (req, res) => {
    const name = req.body.name?.trim(); if (!name || name.length > 80) fail(400, '项目名称需 1–80 个字符');
    if (store.get('SELECT COUNT(*) AS n FROM projects WHERE user_id=?', req.user.id).n >= 50) fail(400, '项目数已达上限');
    const p = { id: randomUUID(), name, created: Date.now() }; await fs.mkdir(root(req.user, p), { recursive: true });
    store.run('INSERT INTO projects(id,user_id,name,created) VALUES(?,?,?,?)', p.id, req.user.id, p.name, p.created); store.audit(req.user.id, 'project/create'); res.status(201).json(p);
  });
  app.patch('/api/projects/:id', (req, res) => { store.project(req.user, req.params.id); const name = req.body.name?.trim(); if (!name || name.length > 80) fail(400, '项目名称无效'); store.run('UPDATE projects SET name=? WHERE id=? AND user_id=?', name, req.params.id, req.user.id); res.json({ ok: true }); });
  app.get('/api/projects/:id/files', async (req, res) => { const p = store.project(req.user, req.params.id); res.json(await walk(root(req.user, p))); });
  app.get('/api/projects/:id/file', async (req, res) => {
    const p = store.project(req.user, req.params.id), rel = relativePath(req.query.path, false);
    const { handle, stat } = await openSafe(root(req.user, p), rel);
    try {
      if (stat.size > 2 * MB) fail(413, '编辑器支持 2 MB 以内的文本文件，请下载查看');
      const data = await handle.readFile(); if (data.includes(0)) fail(415, '二进制文件，请使用下载功能');
      res.json({ content: data.toString('utf8'), etag: createHash('sha256').update(data).digest('hex') });
    } finally { await handle.close(); }
  });
  app.put('/api/projects/:id/file', async (req, res) => mutation(req.user, async () => {
    const p = store.project(req.user, req.params.id), rel = relativePath(req.body.path, false), content = req.body.content;
    if (typeof content !== 'string' || Buffer.byteLength(content) > 2 * MB) fail(413, '文本文件超过编辑器大小限制');
    let previous = 0;
    try { const target = await safePath(root(req.user, p), rel); previous = (await fs.stat(target)).size; if (!req.body.etag || await etag(root(req.user, p), rel) !== req.body.etag) fail(409, '文件已被 Codex 或其他窗口修改，请重新打开后保存'); }
    catch (e) { if (e.status !== 404) throw e; if (req.body.etag) fail(409, '文件已被删除，请重新打开'); }
    if (uploadLocks.has(`${req.user.id}:${p.id}:${rel}`)) fail(409, '该文件正在上传');
    await quota(req.user, Buffer.byteLength(content) - previous); await userDirs(req.user); await atomicWrite(root(req.user, p), rel, content, uploadsDir(req.user));
    res.json({ etag: createHash('sha256').update(content).digest('hex') });
  }));
  app.post('/api/projects/:id/directory', async (req, res) => mutation(req.user, async () => {
    const p = store.project(req.user, req.params.id), rel = relativePath(req.body.path, false); await makeParents(root(req.user, p), `${rel}/placeholder`); res.status(201).json({ ok: true });
  }));
  app.patch('/api/projects/:id/file', async (req, res) => mutation(req.user, async () => {
    const p = store.project(req.user, req.params.id), from = relativePath(req.body.from, false), to = relativePath(req.body.to, false);
    const prefix = `${req.user.id}:${p.id}:`; for (const key of uploadLocks) if (key.startsWith(prefix + from) || key.startsWith(prefix + to)) fail(409, '该路径下存在上传任务');
    const source = await safePath(root(req.user, p), from), target = await safePath(root(req.user, p), to, { missing: true });
    try { await fs.lstat(target); fail(409, '目标路径已存在'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await safeRename(root(req.user,p),from,to);res.json({ok:true});
  }));
  app.delete('/api/projects/:id/file', async (req, res) => mutation(req.user, async () => {
    const p = store.project(req.user, req.params.id), rel = relativePath(req.body.path, false), target = await safePath(root(req.user, p), rel);
    for (const key of uploadLocks) if (key === `${req.user.id}:${p.id}:${rel}` || key.startsWith(`${req.user.id}:${p.id}:${rel}/`)) fail(409, '该路径下存在上传任务');
    await safeRemove(root(req.user,p),rel);store.audit(req.user.id,'file/delete');res.json({ok:true});
  }));
  app.get('/api/projects/:id/download', async (req, res) => {
    const p = store.project(req.user, req.params.id), rel = relativePath(req.query.path || ''); const projectRoot = root(req.user, p), target = await safePath(projectRoot, rel), st = await fs.lstat(target);
    const filename = (rel ? path.basename(rel) : p.name).replace(/[\r\n"\\]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="download.zip"; filename*=UTF-8''${encodeURIComponent(filename + '.zip')}`);
    {
      res.type('application/zip'); const archive = archiver('zip', { zlib: { level: 3 } }); archive.on('error', () => res.destroy()); res.on('close', () => archive.abort()); archive.pipe(res);
      const entries = st.isFile() ? [{ type: 'file', path: path.basename(rel), source: rel }] : await walk(projectRoot,20000,rel);
      for (const entry of entries) {
        const fullRel = entry.source || (rel ? `${rel}/${entry.path}` : entry.path);
        if (entry.type === 'directory') archive.append('', { name: `${entry.path}/` });
        else archive.append(Readable.from((async function* () {
          const { handle } = await openSafe(projectRoot, fullRel);
          try { for await (const chunk of handle.createReadStream()) yield chunk; } finally { await handle.close().catch(() => {}); }
        })()), { name: entry.path });
      }
      await archive.finalize();
    }
  });
  app.get('/api/threads', (req, res) => res.json(store.all('SELECT * FROM threads WHERE user_id=? AND archived=0 ORDER BY created DESC', req.user.id)));
  app.post('/api/threads', async (req, res) => {
    const p = store.project(req.user, req.body.projectId), s = settings(JSON.parse(req.user.settings));
    const result = await codex.call(req.user, 'thread/start', { cwd: projectCwd(config, req.user, p.id), ...threadSettings(s) });
    const t = { id: result.thread.id, user_id: req.user.id, project_id: p.id, title: req.body.title?.slice(0, 100) || '新对话', created: Date.now(), archived: 0 };
    store.run("INSERT INTO threads(id,user_id,project_id,title,created,title_state) VALUES(?,?,?,?,?,'pending')", t.id, t.user_id, t.project_id, t.title, t.created); codex.instances.get(req.user.id)?.loaded.add(t.id); res.status(201).json(t);
  });
  app.get('/api/threads/:id', async (req, res) => {
    const t = store.thread(req.user, req.params.id), s = settings(JSON.parse(req.user.settings)); await codex.resume(req.user, t, threadSettings(s));
    const result = await codex.call(req.user, 'thread/read', { threadId: t.id, includeTurns: true });
    if (result.thread.name && t.title_state !== 'manual') setTitle(req.user.id, t.id, result.thread.name);
    res.json({ ...result, thread: { ...result.thread, title: store.thread(req.user, t.id).title, tokenUsage: t.token_usage ? JSON.parse(t.token_usage) : result.thread.tokenUsage, turns: result.thread.turns?.map(turn => decorateTurn(req.user.id, t.id, turn)) || [] } });
    if (t.title_state === 'pending' && result.thread.turns?.some(turn => turn.status === 'completed')) void autoTitle(req.user.id, t.id);
  });
  const sendImage = (req, res, image) => {
    res.type(image.mime);
    if (req.query.download === '1') res.attachment(`generated-image.${image.mime.split('/')[1]}`);
    res.send(image.data);
  };
  app.get('/api/threads/:id/turns/:turnId/images/:itemId', async (req, res) => {
    const t = store.thread(req.user, req.params.id);
    const result = await codex.call(req.user, 'thread/read', { threadId: t.id, includeTurns: true });
    const item = result.thread.turns?.find(turn => turn.id === req.params.turnId)?.items?.find(item => item.id === req.params.itemId && item.type === 'imageGeneration');
    if (!item) fail(404, '生成图片不存在');
    let image = imageResult(item.result);
    if (!image && item.savedPath) image = await readMedia(config, req.user, t, item.savedPath);
    if (!image) fail(404, 'Codex 没有返回可读取的图片');
    sendImage(req, res, image);
  });
  app.get('/api/threads/:id/media', async (req, res) => {
    const t = store.thread(req.user, req.params.id);
    sendImage(req, res, await readMedia(config, req.user, t, req.query.path));
  });
  app.patch('/api/threads/:id', async (req, res) => { store.thread(req.user, req.params.id); const title = req.body.title?.trim(); if (!title || title.length > 100) fail(400, '对话标题无效'); store.run("UPDATE threads SET title=?,title_state='manual' WHERE id=? AND user_id=?", title, req.params.id, req.user.id); await codex.call(req.user, 'thread/name/set', { threadId: req.params.id, name: title }).catch(() => {}); emit(req.user.id, {method:'thread/title/updated',params:{threadId:req.params.id,title}}); res.json({ ok: true }); });
  function getAttachment(user, id) {
    const item = store.get('SELECT * FROM attachments WHERE id=? AND user_id=?', id, user.id);
    if (!item) fail(404, '附件不存在'); store.thread(user, item.thread_id); return item;
  }
  app.get('/api/attachments/:id/preview', async (req, res) => {
    const item = getAttachment(req.user, req.params.id), { handle, stat } = await openSafe(attachmentRoot(config, req.user), attachmentRel(item));
    try {
      if (item.mime.startsWith('image/')) return res.json({ ...attachmentPublic(item), kind: 'image' });
      if (stat.size > 2 * MB) return res.json({ ...attachmentPublic(item), kind: 'download' });
      const data = await handle.readFile(); let text;
      try { if (data.includes(0)) throw new Error(); text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { return res.json({ ...attachmentPublic(item), kind: 'download' }); }
      res.json({ ...attachmentPublic(item), kind: 'text', text });
    } finally { await handle.close(); }
  });
  app.get('/api/attachments/:id/content', async (req, res) => {
    const item = getAttachment(req.user, req.params.id), { handle } = await openSafe(attachmentRoot(config, req.user), attachmentRel(item));
    res.setHeader('Content-Type', item.mime);
    res.setHeader('Content-Disposition', `${item.mime.startsWith('image/') && !req.query.download ? 'inline' : 'attachment'}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(item.name)}`);
    const stream = handle.createReadStream(); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  });
  app.delete('/api/attachments/:id', async (req, res) => mutation(req.user, async () => {
    const item = getAttachment(req.user, req.params.id);
    if (item.turn_id || [...attachmentSends.values()].some(ids => ids.includes(item.id))) fail(409, '已发送或正在发送的附件不能删除');
    await safeRemove(attachmentRoot(config, req.user), item.id); store.run('DELETE FROM attachments WHERE id=?', item.id); res.json({ok:true});
  }));
  app.post('/api/threads/:id/archive', async (req, res) => { const t = store.thread(req.user, req.params.id); await codex.call(req.user, 'thread/archive', { threadId: t.id }); store.run('UPDATE threads SET archived=1 WHERE id=?', t.id); res.json({ ok: true }); });
  app.put('/api/settings', async (req, res) => mutation(req.user, async () => {
    const s = settings(req.body), previous = settings(JSON.parse(store.user(req.user.id).settings));
    executionTarget({...req.user, settings:JSON.stringify(s)});
    if (s.executionTarget === 'server' && (!config.enableHostExecution || !s.networkAccess || s.sandbox !== 'dangerFullAccess')) fail(400, '服务器模式需要已配置服务器通道、允许网络和完整文件权限');
    if (!config.nestedSandbox && s.sandbox !== 'dangerFullAccess') fail(400, '本服务器使用独立 Docker 容器隔离，尚不支持 Codex 内层文件沙箱');
    if (s.networkAccess !== previous.networkAccess || s.executionTarget !== previous.executionTarget) {
      const inst = codex.instances.get(req.user.id);
      if (inst?.requests.size || inst?.pending.size || inst?.active.size || inst?.terminals.size) fail(409, '切换执行环境或网络权限前请先停止任务并关闭终端');
      config.changingUsers.add(req.user.id);
      try { await (codex.revoke ? codex.revoke(req.user) : codex.restart(req.user)); }
      finally { config.changingUsers.delete(req.user.id); }
    }
    store.run('UPDATE users SET settings=? WHERE id=?', JSON.stringify(s), req.user.id); store.audit(req.user.id, `settings/execution/${s.executionTarget}`); res.json(s);
  }));
  app.get('/api/config', async (req, res) => { await codex.ensure(req.user); await codex.prepareHome?.(req.user); res.json({ toml: await fs.readFile(path.join(userDir(req.user), 'codex', 'config.toml'), 'utf8') }); });
  app.put('/api/config', async (req, res) => {
    if (typeof req.body.toml !== 'string' || req.body.toml.length > 128000) fail(400, '配置文件无效');
    try { TOML.parse(req.body.toml); } catch (e) { fail(400, `TOML 格式错误：${e.message}`); }
    const inst = codex.instances.get(req.user.id); if (inst?.requests.size || inst?.pending.size || inst?.active.size || inst?.terminals.size) fail(409, '请先停止当前任务并关闭终端后修改配置');
    await userDirs(req.user); await codex.prepareHome?.(req.user); await atomicWrite(path.join(userDir(req.user), 'codex'), 'config.toml', req.body.toml, uploadsDir(req.user)); await codex.restart(req.user); store.audit(req.user.id, 'codex/config'); res.json({ ok: true });
  });
  app.get('/api/usage', async (req, res) => res.json({ used: await used(req.user), quota: config.quota, maxFile: config.maxFile }));
  app.get('/api/dashboard', async (req, res) => res.json(await resources.read(req.user)));
  app.get('/api/codex-usage', async (req, res) => res.json(await resources.readCodex(req.user)));
  app.get('/api/admin/users', (req, res) => { if (!isAdministrator(req.user)) fail(403, '需要管理员权限'); res.json(store.all('SELECT id,username,role,created FROM users ORDER BY created')); });
  app.get('/api/admin/audit', (req, res) => { if (!isAdministrator(req.user)) fail(403, '需要管理员权限'); res.json(store.all('SELECT a.action,a.created,u.username FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100')); });
  const requireOwner = u => { if (store.user(u.id)?.role !== 'superadmin') fail(403, '只有超级管理员可以管理邀请码'); };
  app.get('/api/admin/invites', (req, res) => {
    requireOwner(req.user);
    res.json(store.all('SELECT i.id,i.label,i.created,i.expires,i.revoked,i.used_at,u.username AS usedBy,c.username AS createdBy FROM invites i LEFT JOIN users u ON u.id=i.used_by JOIN users c ON c.id=i.created_by ORDER BY i.created DESC LIMIT 200'));
  });
  app.post('/api/admin/invites', (req, res) => {
    requireOwner(req.user); rate(req, 'invite', 50);
    const label = typeof req.body.label === 'string' ? req.body.label.trim().slice(0,80) : '', days = req.body.days ?? 7;
    if (!Number.isInteger(days) || days < 1 || days > 90) fail(400, '有效期需 1–90 天');
    const code = randomBytes(24).toString('base64url'), id = randomUUID(), created = Date.now(), expires = created + days * 86400000;
    store.run('INSERT INTO invites(id,hash,label,created_by,created,expires) VALUES(?,?,?,?,?,?)', id, digest(code), label, req.user.id, created, expires);
    store.audit(req.user.id, `invite/create/${id}`); res.status(201).json({id,code,label,created,expires});
  });
  app.delete('/api/admin/invites/:id', (req,res) => { requireOwner(req.user); store.run('UPDATE invites SET revoked=1 WHERE id=? AND used_by IS NULL',req.params.id); store.audit(req.user.id,`invite/revoke/${req.params.id}`); res.json({ok:true}); });
  let roleChange = Promise.resolve();
  app.patch('/api/admin/users/:id/role', async (req, res) => {
    const previous = roleChange;
    let release; roleChange = new Promise(resolve => {release=resolve;});
    await previous;
    try {
      if (store.user(req.user.id)?.role !== 'superadmin') fail(403, '只有超级管理员可以修改角色');
      const target = store.user(req.params.id), role = req.body.role;
      if (!target) fail(404, '用户不存在');
      if (!ROLES.includes(role)) fail(400, '角色无效');
      if (target.role === role) return res.json({ok:true});
      if (target.role === 'superadmin' && role !== 'superadmin' && store.get("SELECT COUNT(*) AS n FROM users WHERE role='superadmin'").n <= 1) fail(409, '必须保留至少一名超级管理员');
      config.changingUsers.add(target.id);
      try {
        // Close sessions before stopping the old backend, including active terminals.
        store.run('DELETE FROM sessions WHERE user_id=?', target.id);
        for (const ws of clients.get(target.id) || []) { ws.terminal?.close(); ws.close(4001, '角色已更新，请重新登录'); }
        await (codex.revoke ? codex.revoke(target) : codex.restart(target));
        store.run('UPDATE users SET role=?,settings=? WHERE id=?', role, JSON.stringify({...settings(JSON.parse(target.settings)),executionTarget:'workspace'}),target.id);
        store.audit(req.user.id, `role/change/${target.id}/${target.role}/${role}`);
      } finally { config.changingUsers.delete(target.id); }
      res.json({ok:true});
    } finally { release(); }
  });

  async function uploadBegin(ws, u, params) {
    if (ws.activeUpload) fail(409, '请先完成当前文件');
    const attachment = params.scope === 'attachment';
    const thread = attachment ? store.thread(u, params.threadId) : null;
    const p = attachment ? null : store.project(u, params.projectId), rel = attachment ? attachmentName(params.path) : relativePath(params.path, false), size = params.size;
    if (!Number.isSafeInteger(size) || size < 0 || size > config.maxFile) fail(413, '文件大小超过上限');
    if (attachment && size > 20 * MB) fail(413, '聊天附件大小上限为 20 MB');
    if (attachment && store.get('SELECT COUNT(*) AS n FROM attachments WHERE user_id=? AND thread_id=? AND turn_id IS NULL', u.id, thread.id).n >= 10) fail(413, '每轮最多 10 个附件');
    if (params.extract && (attachment || !rel.toLowerCase().endsWith('.zip'))) fail(400, '自动解压只支持项目 ZIP 文件');
    if ([...uploads.values()].filter(x => x.uid === u.id).length >= 10) fail(429, '上传任务过多，请先完成或取消');
    const key = `${u.id}:${attachment ? `attachment:${randomUUID()}` : p.id}:${rel}`; if (uploadLocks.has(key)) fail(409, '该文件正在上传');
    if (!attachment) await safePath(root(u, p), rel, { missing: true }); await quota(u, size); await userDirs(u);
    const id = randomUUID(), temp = path.join(uploadsDir(u), id), handle = await fs.open(temp, 'wx', 0o600);
    const item = { id, uid: u.id, username: u.username, project: p, thread, attachment, extract: !!params.extract, path: rel, size, offset: 0, temp, handle, key, hash: createHash('sha256'), touched: Date.now(), owner: ws };
    uploads.set(id, item); uploadLocks.add(key); ws.activeUpload = item; return { uploadId: id, offset: 0, chunkSize: MB };
  }
  async function removeUpload(item) { uploads.delete(item.id); uploadLocks.delete(item.key); if (item.owner) item.owner.activeUpload = null; await item.handle.close().catch(() => {}); await fs.rm(item.temp, { force: true }); }
  async function rpc(ws, u, method, params) {
    if (config.changingUsers.has(u.id)) fail(409, '账号权限正在更新，请重新登录');
    executionTarget(u);
    if (method === 'terminal/start') {
      const p = store.project(u, params.projectId); if (ws.terminal) ws.terminal.close();
      const cols = Math.max(20, Math.min(300, Number(params.cols) || 80)), rows = Math.max(5, Math.min(100, Number(params.rows) || 24));
      ws.terminal = await codex.terminal(u, p.id, cols, rows, data => send(ws, { type: 'terminal/data', data: data.toString('base64') }), () => send(ws, { type: 'terminal/closed' }));
      store.audit(u.id, 'terminal/start'); return { ok: true };
    }
    if (method === 'terminal/input') { if (!ws.terminal || typeof params.data !== 'string' || params.data.length > 16384) fail(400, '终端输入无效'); ws.terminal.stream.write(params.data); return { ok: true }; }
    if (method === 'terminal/resize') { if (ws.terminal) await ws.terminal.exec.resize({ h: Math.max(5, Math.min(100, Number(params.rows) || 24)), w: Math.max(20, Math.min(300, Number(params.cols) || 80)) }).catch(() => {}); return { ok: true }; }
    if (method === 'terminal/stop') { ws.terminal?.close(); ws.terminal = null; return { ok: true }; }
    if (method === 'upload/begin') return mutation(u, () => uploadBegin(ws, u, params));
    if (method === 'upload/resume') {
      const item = uploads.get(params.uploadId); if (!item || item.uid !== u.id) fail(404, '上传任务已过期');
      if (ws.activeUpload && ws.activeUpload !== item) fail(409, '请先完成当前文件');
      if (item.owner && item.owner !== ws && item.owner.readyState === WebSocket.OPEN) fail(409, '上传仍在另一个连接中进行');
      item.owner = ws; item.touched = Date.now(); ws.activeUpload = item; return { uploadId: item.id, offset: item.offset, chunkSize: MB };
    }
    if (method === 'upload/cancel') { const item = uploads.get(params.uploadId); if (item?.uid === u.id) await removeUpload(item); return { ok: true }; }
    if (method === 'upload/finish') return mutation(u, async () => {
      const item = ws.activeUpload; if (!item || item.id !== params.uploadId) fail(400, '上传任务无效');
      if (item.offset !== item.size) fail(400, '文件尚未完整上传');
      const checksum = item.hash.digest('hex'); if (params.sha256 && params.sha256 !== checksum) { await removeUpload(item); fail(400, '文件校验失败'); }
      await item.handle.sync(); await item.handle.close();
      if (item.extract) {
        const staging = await fs.mkdtemp(path.join(uploadsDir(u), 'extract-'));
        try {
          const reserved = [...uploads.values()].filter(x => x.uid === u.id && x.id !== item.id).reduce((sum,x)=>sum+x.size,0);
          const { entries } = await stageZip(item.temp, staging, {maxFile:config.maxFile,maxBytes:config.quota - await used(u) - reserved});
          await publishZip(root(u, item.project), staging, entries);
          store.audit(u.id, 'upload/extract'); return {ok:true,extracted:entries.length,sha256:checksum};
        } finally { await fs.rm(staging,{recursive:true,force:true}); await removeUpload(item); }
      }
      if (item.attachment) {
        const attachment = {id:item.id,name:item.path,size:item.size,mime:'application/octet-stream'};
        const probe = await fs.open(item.temp,'r');
        try { const data = Buffer.alloc(16); await probe.read(data,0,16,0); attachment.mime = imageMime(data); } finally {await probe.close();}
        await fs.mkdir(attachmentRoot(config,u),{recursive:true}); await makeParents(attachmentRoot(config,u),attachmentRel(attachment));
        const anchor = await anchored(attachmentRoot(config,u),attachmentRel(attachment));
        try { await fs.link(item.temp,anchor.target); store.run('INSERT INTO attachments(id,user_id,thread_id,name,size,mime,created) VALUES(?,?,?,?,?,?,?)',attachment.id,u.id,item.thread.id,attachment.name,attachment.size,attachment.mime,Date.now()); }
        finally {await anchor.close();await removeUpload(item);}
        return {ok:true,attachment:attachmentPublic(attachment),sha256:checksum};
      }
      await makeParents(root(u, item.project), item.path);
      const anchor=await anchored(root(u,item.project),item.path);
      try { await fs.link(item.temp, anchor.target); } catch (e) { if (e.code === 'EEXIST') { await removeUpload(item); fail(409, '目标文件已存在，请重命名文件后上传'); } throw e; } finally {await anchor.close();}
      await removeUpload(item); store.audit(u.id, 'upload/finish'); return { ok: true, path: item.path, sha256: checksum };
    });
    if (method === 'approval/reply') { await codex.reply(u, params.requestId, params.result); return { ok: true }; }
    if (method === 'codex/start') { await codex.ensure(u); return { ok: true }; }
    if (method === 'codex/restart') { await codex.restart(u); return { ok: true }; }
    if (method === 'turn/start') return mutation(u, async () => {
      const t = store.thread(u, params.threadId), s = settings(JSON.parse(store.user(u.id).settings));
      const ids = params.attachments || [];
      if (!Array.isArray(ids) || ids.length > 10 || new Set(ids).size !== ids.length || ids.some(id=>typeof id!=='string')) fail(400, '附件列表无效');
      if (typeof params.text !== 'string' || (!params.text.trim() && !ids.length) || params.text.length > 100000) fail(400, '请输入消息或选择附件，消息上限 100000 个字符');
      const attachments = ids.map(id => { const a = getAttachment(u,id); if (a.thread_id !== t.id || a.turn_id) fail(400,'附件不属于当前草稿'); return a; });
      const account = await codex.call(u, 'account/read', { refreshToken: false });
      if (account.requiresOpenaiAuth && !account.account) fail(409, '请先在设置 → Codex 账号中完成登录');
      await codex.resume(u, t, threadSettings(s));
      const displayText = params.text.trim() || '请查看这些附件。';
      const input = [{ type: 'text', text: displayText }, ...await attachmentInputs(config,u,attachments)];
      const cwd = projectCwd(config, u, t.project_id), target = executionTarget(u);
      for (const image of params.images || []) { if (typeof image !== 'string') fail(400, '图片路径无效'); const rel = relativePath(image, false); await safePath(root(u, store.project(u, t.project_id)), rel); input.push({ type: 'localImage', path: `${cwd}/${rel}` }); }
      const sandboxPolicy = s.sandbox === 'workspaceWrite' ? { type: 'workspaceWrite', writableRoots: [`/workspace/${t.project_id}`], networkAccess: s.networkAccess } : s.sandbox === 'readOnly' ? { type: 'readOnly', networkAccess: s.networkAccess } : { type: 'externalSandbox', networkAccess: s.networkAccess ? 'enabled' : 'restricted' };
      const args = { threadId: t.id, input, cwd, effort: s.effort, approvalPolicy: s.approvalPolicy, sandboxPolicy: target === 'server' ? {type:'dangerFullAccess'} : sandboxPolicy, ...(s.model ? { model: s.model } : {}) };
      store.audit(u.id, `codex/turn/${target}`);
      if (s.mode === 'plan') { if (!s.model) fail(400, '计划模式需要先选择模型'); args.collaborationMode = { mode: 'plan', settings: { model: s.model, reasoning_effort: s.effort, developer_instructions: null } }; }
      const key = `${u.id}:${t.id}`;
      if (attachmentSends.has(key)) fail(409,'消息正在发送，请稍候');
      attachmentSends.set(key, { ids, text: displayText });
      try { const result = await codex.call(u, method, args); bindAttachments(u.id,t.id,result.turn.id); return {...result,turn:decorateTurn(u.id,t.id,result.turn)}; }
      finally { attachmentSends.delete(key); }
    });
    if (['turn/interrupt', 'turn/steer', 'thread/compact/start', 'thread/fork', 'thread/shellCommand', 'thread/goal/get', 'thread/goal/set', 'thread/goal/clear'].includes(method)) {
      const t = store.thread(u, params.threadId); await codex.resume(u, t, threadSettings(settings(JSON.parse(store.user(u.id).settings))));
      if (method === 'thread/shellCommand' && (typeof params.command !== 'string' || params.command.length > 10000)) fail(400, '命令无效');
      if (method === 'thread/shellCommand') store.audit(u.id, `codex/shell/${executionTarget(u)}`);
      const result = await codex.call(u, method, params);
      if (method === 'thread/fork') store.run('INSERT INTO threads(id,user_id,project_id,title,created) VALUES(?,?,?,?,?)', result.thread.id, u.id, t.project_id, `${t.title} · 分支`, Date.now());
      return result;
    }
    const methods = new Set(['model/list', 'account/read', 'account/login/start', 'account/login/cancel', 'account/logout', 'account/rateLimits/read', 'config/read', 'configRequirements/read', 'skills/list', 'skills/config/write', 'mcpServerStatus/list', 'mcpServer/oauth/login', 'config/mcpServer/reload', 'app/list', 'app/installed', 'permissionProfile/list', 'experimentalFeature/list', 'experimentalFeature/enablement/set']);
    if (!methods.has(method)) fail(400, '不支持的操作，请使用高级配置设置 CLI 功能');
    if (params.threadId) store.thread(u, params.threadId);
    if (method === 'skills/list') params = { ...params, cwds: store.all('SELECT id FROM projects WHERE user_id=?', u.id).map(p => `/workspace/${p.id}`) };
    if (method === 'account/login/start') {
      if (!['apiKey','chatgptDeviceCode'].includes(params.type)) fail(400, '请选择 API Key 或 ChatGPT 设备登录');
      const inst = codex.instances.get(u.id);
      if (inst?.active?.size || inst?.requests?.size) fail(409, '请先停止当前任务再切换 Codex 账号');
      params = params.type === 'chatgptDeviceCode' ? {type:'chatgptDeviceCode'} : {type:'apiKey',apiKey:params.apiKey};
    }
    return codex.call(u, method, params);
  }
  server.on('upgrade', (req, socket, head) => {
    let u, url; try { url = new URL(req.url, config.publicUrl); u = store.auth(req); } catch {}
    if (url?.pathname !== '/ws' || !u || req.headers.origin !== new URL(config.publicUrl).origin || url.searchParams.get('csrf') !== u.csrf) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => { ws.user = u; ws.sessionHash = u.session_hash; wss.emit('connection', ws, req); });
  });
  wss.on('connection', (ws, req) => {
    const u = ws.user; let chain = Promise.resolve(), queued = 0;
    if ((clients.get(u.id)?.size || 0) >= 5) { ws.close(1013, '连接数已达上限'); return; }
    if (!clients.has(u.id)) clients.set(u.id, new Set()); clients.get(u.id).add(ws); ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    const current = eventCounters.get(u.id)||0;
    send(ws, { type: 'ready', seq: current, pending: [...(codex.instances.get(u.id)?.requests.values() || [])] });
    ws.on('message', (data, binary) => {
      if (++queued > 8) { ws.close(1008, '请等待服务器确认后发送'); return; }
      chain = chain.then(async () => {
        if (!store.get('SELECT hash FROM sessions WHERE hash=? AND expires>?', ws.sessionHash, Date.now())) { ws.close(4001, '登录已过期'); return; }
        if (binary) {
          const item = ws.activeUpload; if (!item || item.offset + data.length > item.size || data.length > MB) fail(400, '上传数据块无效');
          const { bytesWritten } = await item.handle.write(data, 0, data.length, item.offset); if (bytesWritten !== data.length) fail(500, '磁盘写入不完整'); item.hash.update(data); item.offset += data.length; item.touched = Date.now(); send(ws, { type: 'upload/ack', uploadId: item.id, offset: item.offset });
        } else {
          let msg; try { msg = JSON.parse(data.toString()); } catch { fail(400, '消息格式无效'); }
          if (!msg || typeof msg.id !== 'number' || typeof msg.method !== 'string' || !msg.params || typeof msg.params !== 'object' || Array.isArray(msg.params)) fail(400, '请求格式无效');
          try { const result = await rpc(ws, store.user(u.id), msg.method, msg.params); send(ws, { id: msg.id, result }); }
          catch (e) { send(ws, { id: msg.id, error: { message: e.status ? e.message : `Codex 操作失败：${e.message}`, status: e.status || 500 } }); }
        }
      }).catch(e => send(ws, { type: 'error', error: e.status ? e.message : '上传失败，请重试' })).finally(() => { queued--; });
    });
    ws.on('close', () => { clients.get(u.id)?.delete(ws); if (!clients.get(u.id)?.size) clients.delete(u.id); if (ws.activeUpload) ws.activeUpload.owner = null; ws.terminal?.close(); });
    ws.on('error', () => {});
  });
  const maintenance = setInterval(async () => {
    for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
    for (const item of uploads.values()) if (!item.owner && Date.now() - item.touched > 30 * 60000) await removeUpload(item).catch(() => {});
    await codex.stopIdle(clients).catch(() => {}); store.prune();
    for (const item of store.all('SELECT * FROM attachments WHERE turn_id IS NULL AND created<?',Date.now()-86400000)) {
      const u = store.user(item.user_id);
      if (!u || [...attachmentSends.values()].some(ids=>ids.includes(item.id))) continue;
      await mutation(u,async()=>{
        const current=store.get('SELECT turn_id FROM attachments WHERE id=?',item.id);
        if(!current||current.turn_id||[...attachmentSends.values()].some(ids=>ids.includes(item.id)))return;
        await safeRemove(attachmentRoot(config,u),item.id).catch(()=>{});store.run('DELETE FROM attachments WHERE id=? AND turn_id IS NULL',item.id);
      });
    }
  }, 30000); maintenance.unref();
  // Interrupted uploads cannot survive process restarts; purge only our own spool directory.
  await fs.mkdir(path.join(config.dataDir, 'uploads'), { recursive: true });
  for (const dir of await fs.readdir(path.join(config.dataDir, 'uploads'))) if (/^[0-9a-f-]{36}$/.test(dir)) await fs.rm(path.join(config.dataDir, 'uploads', dir), { recursive: true, force: true });
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use('/assets', express.static(path.resolve(here, '../dist/assets'), { maxAge: '1y', immutable: true, fallthrough: false, setHeaders: res => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable') }));
  app.use(express.static(path.resolve(here, '../dist'), { index: false, maxAge: 0 }));
  app.get('/{*path}', (req, res) => res.sendFile(path.resolve(here, '../dist/index.html')));
  app.use((e, req, res, next) => { if (res.headersSent) return res.destroy(); res.status(e.status || 500).json({ error: e.status ? e.message : '服务器操作失败，请重试' }); if (!e.status) console.error('Request failed:', e.code || e.name); });
  return { app, server, store, codex, config, close: async () => { clearInterval(maintenance); for (const ws of wss.clients) ws.terminate(); await codex.shutdown(); for (const item of uploads.values()) await removeUpload(item); await new Promise(resolve => server.close(resolve)); store.db.close(); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (process.env.COOKIE_SECURE === 'true' && !process.env.INVITE_CODE) throw new Error('Production requires INVITE_CODE');
  const instance = await createApp(); instance.server.listen(Number(process.env.PORT || 3100), '0.0.0.0', () => console.log(`Starvalley Codex listening on :${process.env.PORT || 3100}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await instance.close(); process.exit(0); });
}
