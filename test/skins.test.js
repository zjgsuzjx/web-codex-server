import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { createStore } from '../server/store.js';
import { CodexManager } from '../server/codex.js';
import { pngCrc, validatePng } from '../server/avatar.js';
import { normalizeSkin, skinTokens, contrast, skinDevice, WALLPAPER_MAX_BYTES } from '../shared/skins.js';

const appearance = { name: '林间微光', description: '从森林的松绿中寻找灵感。', mode: 'dark', palette: { background: '#152b24', surface: '#1a352b', accent: '#70b58c' }, wallpaper: { fit: 'cover', x: 63, y: 40, shade: .25 } };
function chunk(type, body) { const data = Buffer.concat([Buffer.from(type), body]), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(body.length); crc.writeUInt32BE(pngCrc(data)); return Buffer.concat([length, data, crc]); }
function png(width = 128, height = 80, metadata = false) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), ...(metadata ? [chunk('tEXt', Buffer.from('untrusted\0metadata'))] : []), chunk('IDAT', deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
test('skins only accept bounded raster uploads and declarative colors/composition', () => {
  assert.deepEqual(validatePng(png(128, 80, true), { wallpaper: true, maxBytes: WALLPAPER_MAX_BYTES }), png());
  assert.throws(() => validatePng(png(2561, 1), { wallpaper: true }), /尺寸/);
  assert.throws(() => validatePng(png().subarray(0, 50), { wallpaper: true }));
  assert.throws(() => normalizeSkin({ ...appearance, palette: { ...appearance.palette, accent: 'url(https://example.com)' } }));
  assert.throws(() => normalizeSkin({ ...appearance, wallpaper: { ...appearance.wallpaper, x: NaN } }));
  const normalized = normalizeSkin({ ...appearance, wallpaper: { fit: 'cover', x: -10, y: 900, shade: 4 } });
  assert.deepEqual(normalized.wallpaper, { fit: 'cover', x: 0, y: 100, shade: .7 });
  assert.deepEqual(normalizeSkin(normalized), normalized, 'persisted normalization must not progressively shift colors');
  assert.equal(skinDevice('Mozilla/5.0 (iPhone; CPU iPhone OS) Mobile'), 'mobile');
  assert.equal(skinDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'desktop');
});
test('derived text and accent tokens remain readable for adversarial palette choices', () => {
  for (const mode of ['light', 'dark']) for (const color of ['#ffffff', '#000000', '#ff00ff', '#ffff00', '#808080', '#0000ff']) {
    const config = normalizeSkin({ ...appearance, mode, palette: { background: color, surface: color, accent: color } }), tokens = skinTokens(config);
    assert.deepEqual(normalizeSkin(config), config);
    for (const bg of ['bg', 'side', 'panel', 'hover']) for (const fg of ['text', 'muted', 'subtle', 'accent']) assert.ok(contrast(tokens[bg], tokens[fg]) >= 4.5, `${mode} ${color} ${bg}/${fg}`);
    assert.ok(contrast(tokens.accent, tokens['accent-ink']) >= 4.5);
  }
});
async function connect(base, user, ua = 'Desktop') {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws?csrf=' + user.csrf, { headers: { Cookie: user.cookie, Origin: base, 'User-Agent': ua } });
  let id = 0; const pending = new Map(), events = [];
  ws.on('message', data => { const msg = JSON.parse(data), waiter = pending.get(msg.id ?? (msg.type === 'error' ? 'ack' : msg.type === 'upload/ack' ? 'ack' : 'event')); if (!waiter) { events.push(msg); return; } pending.delete(waiter.key); clearTimeout(waiter.timer); msg.error ? waiter.reject(new Error(msg.error.message || msg.error)) : waiter.resolve(msg.result || msg); });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const wait = key => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('test socket timeout')), 5000); pending.set(key, { key, resolve, reject, timer }); });
  return { events, async call(method, params = {}) { const seq = ++id, result = wait(seq); ws.send(JSON.stringify({ id: seq, method, params })); return result; }, async chunk(data) { const result = wait('ack'); ws.send(data); return result; }, async close() { if (ws.readyState === WebSocket.CLOSED) return; await new Promise(resolve => { ws.once('close', resolve); ws.close(); }); } };
}
test('wallpapers and presets isolate accounts/devices, survive restart, and recover from model failures', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-skins-')), sockets = [];
  let failModel = false, calls = 0, modelRequest;
  const app = await createApp({ dataDir: dir, inviteCode: 'skin-test', codexFactory: () => ({ instances: new Map(), async stopIdle() {}, async shutdown() {}, async skinTask(user, prompt, image, schema) { calls++; modelRequest = { user, prompt, image, schema }; if (failModel) throw new Error('secret provider response'); return appearance; } }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`; app.config.publicUrl = base;
  const request = (url, user, method = 'GET', body, ua = 'Desktop', csrf = user?.csrf) => fetch(base + '/api' + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', 'User-Agent': ua, ...(user ? { Cookie: user.cookie, 'X-CSRF-Token': csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = async (...args) => { const r = await request(...args); const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body)); return body; };
  const register = async username => { const r = await request('/register', null, 'POST', { username, password: 'wallpaper-test-password42', inviteCode: 'skin-test' }); return { ...(await r.json()).user, cookie: r.headers.get('set-cookie').split(';')[0] }; };
  const socket = async (u, ua) => { const s = await connect(base, u, ua); sockets.push(s); return s; };
  let closed = false;
  try {
    const alice = await register('skin_alice'), bob = await register('skin_bob'), a = await socket(alice), b = await socket(bob), mobile = await socket(alice, 'iPhone Mobile');
    assert.equal((await request('/skins')).status, 401);
    await assert.rejects(a.call('upload/begin', { scope: 'wallpaper', device: 'mobile', size: png().length }), /对应设备/);
    await assert.rejects(mobile.call('upload/begin', { scope: 'wallpaper', device: 'desktop', size: png().length }), /对应设备/);
    await assert.rejects(a.call('upload/begin', { scope: 'wallpaper', device: 'desktop', size: WALLPAPER_MAX_BYTES + 1 }), /6 MB/);
    const upload = async (s, device, image = png()) => { const task = await s.call('upload/begin', { scope: 'wallpaper', device, path: '../../ignored', size: image.length }); await s.chunk(image); return s.call('upload/finish', { uploadId: task.uploadId }); };
    const desktopImage = await upload(a, 'desktop'), phoneImage = await upload(mobile, 'mobile');
    assert.equal((await request(`/skins/wallpapers/${desktopImage.wallpaperId}`, bob)).status, 404);
    const bytes = await request(`/skins/wallpapers/${desktopImage.wallpaperId}`, alice);
    assert.equal(bytes.headers.get('content-type'), 'image/png'); assert.equal(bytes.headers.get('cache-control'), 'no-store'); assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), png());
    assert.equal((await request('/skins', alice)).status, 200);
    assert.equal((await json('/skins', alice)).drafts.length, 2);
    await assert.rejects(upload(a, 'desktop', Buffer.from('<svg/>')));
    const gen = await json('/skins/generate', alice, 'POST', { device: 'desktop', wallpaperId: desktopImage.wallpaperId, hint: '自然柔和', width: 1440, height: 900 });
    let job;
    for (let n = 0; n < 30; n++) { job = await json(`/skins/jobs/${gen.id}`, alice); if (job.status !== 'running') break; await new Promise(r => setTimeout(r, 10)); }
    assert.equal(job.status, 'completed'); assert.match(modelRequest.image.url, /^data:image\/png;base64,/); assert.match(modelRequest.prompt, /1440×900/); assert.equal(modelRequest.schema.additionalProperties, false);
    assert.equal((await request(`/skins/jobs/${gen.id}`, bob)).status, 404);
    assert.equal((await request('/skins/presets', alice, 'POST', { device: 'desktop', wallpaperId: desktopImage.wallpaperId, config: job.config }, 'Desktop', 'wrong')).status, 403);
    let skins = await json('/skins/presets', alice, 'POST', { device: 'desktop', wallpaperId: desktopImage.wallpaperId, config: job.config });
    const desktopPreset = skins.active.desktop;
    skins = await json('/skins/presets', alice, 'POST', { device: 'mobile', wallpaperId: phoneImage.wallpaperId, config: appearance }, 'iPhone Mobile');
    const mobilePreset = skins.active.mobile;
    assert.equal((await request('/skins/active', alice, 'PUT', { device: 'mobile', presetId: null })).status, 403);
    assert.equal((await request('/skins/active', alice, 'PUT', { device: 'desktop', presetId: mobilePreset })).status, 403);
    assert.equal((await request('/skins/active', bob, 'PUT', { device: 'desktop', presetId: desktopPreset })).status, 404);
    assert.equal((await request(`/skins/presets/${desktopPreset}`, alice, 'DELETE', null, 'iPhone Mobile')).status, 403);
    skins = await json('/skins/active', alice, 'PUT', { device: 'desktop', presetId: null }); assert.equal(skins.active.desktop, null); assert.equal(skins.active.mobile, mobilePreset);
    await json('/skins/active', alice, 'PUT', { device: 'desktop', presetId: desktopPreset }); assert.equal(calls, 1, 'preset switches must not call the model');
    failModel = true;
    const failed = await json('/skins/generate', alice, 'POST', { device: 'desktop', wallpaperId: desktopImage.wallpaperId, hint: '', width: 1440, height: 900 });
    for (let n = 0; n < 30; n++) { job = await json(`/skins/jobs/${failed.id}`, alice); if (job.status !== 'running') break; await new Promise(r => setTimeout(r, 10)); }
    assert.equal(job.status, 'failed'); assert.ok(!job.error.includes('secret')); assert.equal((await json('/skins', alice)).active.desktop, desktopPreset);
    app.config.quota = 1;
    await assert.rejects(a.call('upload/begin', { scope: 'wallpaper', device: 'desktop', size: png().length }), /配额/); delete app.config.quota;
    assert.ok(a.events.some(e => e.type === 'profile/skins')); assert.ok(!b.events.some(e => e.type === 'profile/skins'));
    await json(`/skins/presets/${desktopPreset}`, alice, 'DELETE');
    assert.equal((await request(`/skins/wallpapers/${desktopImage.wallpaperId}`, alice)).status, 404);
    assert.equal((await json('/skins', alice)).active.mobile, mobilePreset);
    const sharedImage = await upload(a, 'desktop');
    let firstShared;
    for (let n = 0; n < 12; n++) { const next = await json('/skins/presets', alice, 'POST', { device: 'desktop', wallpaperId: sharedImage.wallpaperId, config: { ...appearance, name: `Preset ${n}` } }); firstShared ||= next.active.desktop; }
    assert.equal((await request('/skins/presets', alice, 'POST', { device: 'desktop', wallpaperId: sharedImage.wallpaperId, config: appearance })).status, 409);
    await json(`/skins/presets/${firstShared}`, alice, 'DELETE');
    assert.equal((await request(`/skins/wallpapers/${sharedImage.wallpaperId}`, alice)).status, 200, 'deleting one preset must retain an image shared by other presets');
    const oldDraft = await upload(a, 'desktop'), newDraft = await upload(a, 'desktop');
    assert.equal((await request(`/skins/wallpapers/${oldDraft.wallpaperId}`, alice)).status, 404);
    assert.equal((await json('/skins', alice)).drafts.find(d => d.device === 'desktop').wallpaperId, newDraft.wallpaperId);
    for (const s of sockets) await s.close(); await app.close(); closed = true;
    const reopened = createStore(dir);
    try { assert.equal(reopened.get('SELECT preset_id FROM user_skins WHERE user_id=? AND device=?', alice.id, 'mobile').preset_id, mobilePreset); assert.equal(reopened.get('SELECT COUNT(*) AS n FROM skin_presets WHERE user_id=?', bob.id).n, 0); assert.deepEqual(JSON.parse(reopened.get('SELECT config FROM skin_presets WHERE id=?', mobilePreset).config), normalizeSkin(appearance)); }
    finally { reopened.db.close(); }
  } finally { for (const s of sockets) await s.close(); if (!closed) await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('skin analysis uses ephemeral structured image turns and interrupts failed tasks', async () => {
  const inst = { titles: new Map(), hidden: new Set() }, calls = [], manager = Object.create(CodexManager.prototype);
  manager.ensure = async () => inst;
  manager.raw = async (_, method, params) => { calls.push({ method, params }); if (method === 'thread/start') return { thread: { id: 'skin-analysis' } }; if (method === 'turn/start') { queueMicrotask(() => inst.titles.get(params.threadId).resolve(JSON.stringify(appearance))); return { turn: { id: 'turn' } }; } return {}; };
  await manager.skinTask({ settings: '{"model":"selected-model"}' }, 'analyze', { type: 'image', url: 'data:image/png;base64,AAAA' }, { type: 'object' });
  assert.equal(calls[0].params.ephemeral, true); assert.equal(calls[0].params.approvalPolicy, 'never'); assert.equal(calls[0].params.model, 'selected-model'); assert.equal(calls[1].params.input[1].type, 'image'); assert.equal(inst.titles.size, 0);
  manager.raw = async (_, method, params) => { calls.push({ method, params }); if (method === 'thread/start') return { thread: { id: 'broken-skin' } }; if (method === 'turn/start') { queueMicrotask(() => inst.titles.get(params.threadId).reject(new Error('model failed'))); return { turn: { id: 'broken-turn' } }; } return {}; };
  await assert.rejects(manager.skinTask({}, 'analyze', {}, {}), /model failed/); assert.equal(inst.titles.size, 0); assert.ok(calls.some(c => c.method === 'turn/interrupt')); assert.equal(calls.at(-1).method, 'thread/unsubscribe');
});
