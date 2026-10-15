import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.js';
import { measure, requireCodexQuota } from '../server/storage.js';
import { GiB, storageLimit, storagePressure, topPaths } from '../shared/storage.js';
import { CodexManager } from '../server/codex.js';

test('storage limits and pressure distinguish unlimited, full, server disk and unknown capacity', () => {
  assert.equal(storageLimit({ role: 'superadmin' }), null);
  assert.equal(storageLimit({ role: 'admin' }), 5 * GiB);
  assert.equal(storageLimit({ role: 'user' }), GiB);
  assert.equal(storagePressure({ storage: { quota: 100, used: 90 } }).level, 'warning');
  assert.equal(storagePressure({ storage: { quota: 100, used: 101 } }).level, 'full');
  assert.equal(storagePressure({ storage: { quota: null, used: 1e15 } }).level, 'normal');
  assert.equal(storagePressure({ server: { disk: { total: 100, available: 9 } } }).source, '服务器磁盘');
  assert.equal(storagePressure(null).level, 'normal');
  assert.deepEqual(topPaths(['src/a', 'src', 'src/a', 'src2/a']), ['src', 'src2/a']);
  assert.throws(() => requireCodexQuota({ status: 'available', snapshot: { rateLimitsByLimitId: { codex: { primary: { usedPercent: 100 }, credits: { balance: '0' } } } } }), /额度不足/);
  assert.doesNotThrow(() => requireCodexQuota({ status: 'unsupported' }));
  assert.doesNotThrow(() => requireCodexQuota({ status: 'available', snapshot: { rateLimits: { primary: { usedPercent: 100 }, credits: { balance: '10' } } } }));
});

test('usage measurement streams directory contents and never counts linked external files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-storage-'));
  try {
    await fs.mkdir(path.join(dir, 'own')); await fs.writeFile(path.join(dir, 'own', 'a'), '12345');
    await fs.mkdir(path.join(dir, 'external')); await fs.writeFile(path.join(dir, 'external', 'secret'), 'external');
    await fs.symlink(path.join(dir, 'external'), path.join(dir, 'own', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await measure(path.join(dir, 'own'))).size, 5);
    const before = await measure(path.join(dir, 'own'), '', true);
    await fs.writeFile(path.join(dir, 'own', 'a'), 'modified');
    assert.notEqual((await measure(path.join(dir, 'own'), '', true)).fingerprint, before.fingerprint);
    assert.equal((await measure(path.join(dir, 'missing'))).size, 0);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('full-quota recovery, scoped cleanup manifests, live file checks and image endpoints work independently of conversation startup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-storage-api-'));
  let exhausted = false, calls = 0, extraId = false;
  const app = await createApp({ dataDir: dir, quota: 200, inviteCode: 'storage-test-invite', codexFactory: () => ({
    instances: new Map(), async stopIdle() {}, async shutdown() {}, async resume() { throw new Error('ENOSPC'); },
    async call(user, method) { if (method === 'account/read') return { account: { type: 'chatgpt' } }; if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: exhausted ? 100 : 10 } } }; throw new Error('ENOSPC'); },
    async storageTask(user, prompt) { calls++; const entries = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)); return { files: [...entries.filter(e => e.path.includes('cache') || e.path.includes('dist')).map(e => ({ id: e.id, purpose: '构建缓存，可以重新生成。' })), ...(extraId ? [{ id: 'unlisted-outside-id', purpose: 'injected' }] : [])] }; }
  }) });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${app.server.address().port}`; app.config.publicUrl = base;
  async function req(url, session, method = 'GET', body) { const result = await fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await result.json(); return { status: result.status, data, headers: result.headers }; }
  async function register(username) { const r = await req('/register', null, 'POST', { username, password: 'Storage-test-password42', inviteCode: 'storage-test-invite' }); assert.equal(r.status, 200); return { ...r.data.user, cookie: r.headers.get('set-cookie').split(';')[0] }; }
  async function waitJob(user, id) { for (let n = 0; n < 100; n++) { const r = await req(`/storage/jobs/${id}`, user); if (!['scanning', 'deleting'].includes(r.data.phase)) return r.data; await new Promise(r => setTimeout(r, 10)); } throw new Error('job timeout'); }
  try {
    const a = await register('storage_owner'), b = await register('storage_member');
    const p = (await req('/projects', a, 'POST', { name: 'Storage' })).data;
    const root = path.join(dir, 'users', a.username, 'projects', p.id);
    await fs.mkdir(path.join(root, 'dist')); await fs.writeFile(path.join(root, 'dist', 'keep.bundle'), 'keep build');
    await fs.mkdir(path.join(root, 'cache'));  await fs.writeFile(path.join(root, 'cache', 'old.bin'), Buffer.alloc(350, 1)); await fs.writeFile(path.join(root, 'source.js'), 'source');
    await fs.mkdir(path.join(dir, 'users', a.username, 'codex'), { recursive: true }); await fs.writeFile(path.join(dir, 'users', a.username, 'codex', 'auth.json'), 'private-data');
    assert.ok((await req('/dashboard', a)).data.storage.used > 350);
    assert.equal((await req(`/projects/${p.id}/file`, a, 'PUT', { path: 'extra', content: 'x' })).status, 413);
    const size = await req(`/projects/${p.id}/size`, a, 'POST', { paths: ['cache', 'cache/old.bin'] });
    assert.equal(size.data.size, 350); assert.equal(size.data.entries.length, 1);
    assert.equal((await req(`/projects/${p.id}/size`, b, 'POST', { paths: ['cache'] })).status, 404);
    assert.equal((await req('/storage/scan', null, 'POST')).status, 401);
    extraId = true;
    const scan = await req('/storage/scan', a, 'POST'); const ready = await waitJob(a, scan.data.id);
    assert.equal(ready.phase, 'ready'); assert.equal(ready.files.length, 2); assert.equal(ready.files[0].size, 350);
    assert.ok(!JSON.stringify(ready).includes('private-data')); assert.ok(await fs.stat(path.join(root, 'cache')));
    assert.equal((await req(`/storage/jobs/${ready.id}`, b)).status, 404);
    assert.equal((await req(`/storage/jobs/${ready.id}/confirm`, a, 'POST', { ids: ['unlisted-outside-id'] })).status, 400);
    assert.equal((await req(`/storage/jobs/${ready.id}/confirm`, a, 'POST', { ids: [ready.files[0].id] })).status, 200);
    assert.equal((await waitJob(a, ready.id)).phase, 'failed'); // extra model IDs cannot authorize deletion
    assert.ok(await fs.stat(path.join(root, 'cache')));
    extraId = false;
    const second = await req('/storage/scan', a, 'POST'); const secondReady = await waitJob(a, second.data.id);
    await fs.writeFile(path.join(root, 'cache', 'new'), 'new data');
    await req(`/storage/jobs/${secondReady.id}/confirm`, a, 'POST', { ids: secondReady.files.filter(f => f.path.includes('cache')).map(f => f.id) });
    const changed = await waitJob(a, secondReady.id); assert.equal(changed.phase, 'done'); assert.equal(changed.results[0].deleted, false); assert.match(changed.results[0].error, /变化/);
    const third = await req('/storage/scan', a, 'POST'); const thirdReady = await waitJob(a, third.data.id);
    await req(`/storage/jobs/${thirdReady.id}/confirm`, a, 'POST', { ids: thirdReady.files.filter(f => f.path.includes('cache')).map(f => f.id) });
    assert.equal((await waitJob(a, thirdReady.id)).results[0].deleted, true); assert.equal(await fs.readFile(path.join(root, 'dist', 'keep.bundle'), 'utf8'), 'keep build'); assert.equal(await fs.readFile(path.join(root, 'source.js'), 'utf8'), 'source');
    exhausted = true;
    const before = calls, empty = await req('/storage/scan', a, 'POST'), noQuota = await waitJob(a, empty.data.id);
    assert.equal(noQuota.phase, 'failed'); assert.match(noQuota.error, /额度不足/); assert.equal(calls, before);
    await fs.writeFile(path.join(root, 'large'), Buffer.alloc(500));
    const audit = app.store.audit; app.store.audit = () => { throw new Error('database or disk is full'); };
    assert.equal((await req(`/projects/${p.id}/delete`, a, 'POST', { paths: ['large'] })).data.results[0].deleted, true); app.store.audit = audit;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI1sAAAAASUVORK5CYII=', 'base64');
    await fs.writeFile(path.join(root, 'pixel.PNG'), png);
    const meta = await req(`/projects/${p.id}/file?path=pixel.PNG`, a); assert.equal(meta.data.kind, 'image');
    const image = await fetch(base + meta.data.url, { headers: { Cookie: a.cookie } }); assert.equal(image.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    assert.equal((await req(`/projects/${p.id}/image?path=pixel.PNG`, b)).status, 404);
    assert.equal((await req(`/projects/${p.id}/image?path=../auth.json`, a)).status, 400);
    assert.equal((await req(`/projects/${p.id}/image?path=source.js`, a)).status, 415);
    await fs.writeFile(path.join(root, 'unsafe.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const svg = await fetch(base + `/api/projects/${p.id}/image?path=unsafe.svg`, { headers: { Cookie: a.cookie } }); assert.match(svg.headers.get('content-security-policy'), /sandbox/); assert.equal(svg.headers.get('content-type'), 'image/svg+xml'); await svg.arrayBuffer();
    assert.ok((await req('/dashboard', a)).data.storage.used < 500);
    const failedThread = await req('/threads', a, 'POST', { projectId: p.id });
    assert.equal(failedThread.status, 507); assert.equal(failedThread.data.code, 'STORAGE_FULL');
    assert.equal((await req('/session', a)).data.user.id, a.id);
    assert.equal((await req(`/projects/${p.id}/files`, a)).status, 200);
    delete app.config.quota;
    assert.equal((await req('/dashboard', a)).data.storage.quota, null);
    assert.equal((await req('/usage', b)).data.quota, GiB);
    app.store.run('UPDATE users SET role=? WHERE id=?', 'admin', b.id);
    assert.equal((await req('/dashboard', b)).data.storage.quota, 5 * GiB);
    app.store.run('UPDATE users SET role=? WHERE id=?', 'user', b.id);
    assert.equal((await req('/dashboard', b)).data.storage.quota, GiB);
  } finally { await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('background storage tasks use ephemeral structured model turns and release resources on failure', async () => {
  const inst = { titles: new Map(), hidden: new Set() }, calls = [];
  const manager = Object.create(CodexManager.prototype); manager.ensure = async () => inst;
  manager.raw = async (instance, method, params) => { calls.push({ method, params }); if (method === 'thread/start') return { thread: { id: randomUUID() } }; if (method === 'turn/start') { queueMicrotask(() => inst.titles.get(params.threadId).resolve('{"files":[]}')); return { turn: { id: 'turn' } }; } return {}; };
  assert.deepEqual(await manager.storageTask({ settings: '{"model":"selected-model"}' }, 'scan inventory', { type: 'object' }), { files: [] });
  assert.equal(calls[0].params.model, 'selected-model'); assert.equal(calls[0].params.ephemeral, true); assert.equal(calls[0].params.sandbox, 'read-only');
  assert.equal(calls[1].params.input[0].text, 'scan inventory'); assert.equal(calls.at(-1).method, 'thread/unsubscribe'); assert.equal(inst.titles.size, 0);
  manager.raw = async (_, method) => { if (method === 'thread/start') return { thread: { id: 'fail' } }; if (method === 'turn/start') throw new Error('usage_limit_reached'); return {}; };
  await assert.rejects(manager.storageTask({}, 'scan', {}), /usage_limit_reached/); assert.equal(inst.titles.size, 0);
});
