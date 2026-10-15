import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.js';
import { createStore } from '../server/store.js';
import { pngCrc, validateAvatar } from '../server/avatar.js';
import { AVATAR_MAX_BYTES, avatarCrop, avatarDimensions } from '../shared/avatar.js';

function chunk(type, body) {
  const data = Buffer.concat([Buffer.from(type), body]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(body.length); crc.writeUInt32BE(pngCrc(data));
  return Buffer.concat([length, data, crc]);
}
function png({ width = 256, height = 256, raw, metadata = false } = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), ...(metadata ? [chunk('tEXt', Buffer.from('private\0discard this metadata'))] : []), chunk('IDAT', deflateSync(raw || Buffer.alloc((width * 4 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}

test('avatar validation requires a complete, bounded, square raster and strips metadata', () => {
  const valid = png(); assert.deepEqual(validateAvatar(valid), valid);
  assert.deepEqual(validateAvatar(png({ metadata: true })), valid);
  for (const data of [Buffer.from('<svg onload="alert(1)"/>'), valid.subarray(0, -1), Buffer.concat([valid, Buffer.from('extra')]), png({ width: 255 }), png({ raw: Buffer.alloc(2) }), png({ raw: Buffer.alloc(300000) })]) assert.throws(() => validateAvatar(data));
  const brokenCrc = Buffer.from(valid); brokenCrc[45] ^= 1; assert.throws(() => validateAvatar(brokenCrc));
  const badFilter = Buffer.alloc(1025 * 256); badFilter[0] = 5; assert.throws(() => validateAvatar(png({ raw: badFilter })));
  assert.throws(() => validateAvatar(Buffer.alloc(AVATAR_MAX_BYTES + 1)), /256 KB/);
});

test('avatar source dimensions reject huge or unsupported images before decoding', () => {
  assert.deepEqual(avatarDimensions(png()), { width: 256, height: 256 });
  assert.throws(() => avatarDimensions(png({ width: 9000, height: 1, raw: Buffer.from([0]) })), /8192/);
  assert.throws(() => avatarDimensions(png({ width: 5000, height: 4000, raw: Buffer.from([0]) })), /像素/);
  for (const data of [Buffer.from('GIF89a'), Buffer.from('<svg/>'), Buffer.from([255, 216, 255, 255])]) assert.throws(() => avatarDimensions(data));
  const jpeg = Buffer.from('ffd8ffe000040000ffc2000808006400c800ffd9', 'hex');
  assert.deepEqual(avatarDimensions(jpeg), { width: 200, height: 100 });
  const webp = Buffer.alloc(30); webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12); webp[24] = 199; webp[27] = 99;
  assert.deepEqual(avatarDimensions(webp), { width: 200, height: 100 });
  webp.write('VP8 ', 12); webp[23] = 157; webp[24] = 1; webp[25] = 42; webp.writeUInt16LE(200, 26); webp.writeUInt16LE(100, 28);
  assert.deepEqual(avatarDimensions(webp), { width: 200, height: 100 });
  webp.write('VP8L', 12); webp[20] = 47; webp.writeUInt32LE(199 | 99 << 14, 21);
  assert.deepEqual(avatarDimensions(webp), { width: 200, height: 100 });
});

test('avatar crops remain within landscape and portrait source bounds at every position', () => {
  for (const [width, height] of [[1200, 400], [400, 1200], [100, 100]]) {
    for (const zoom of [1, 1.7, 3]) for (const x of [-2, 0, 2]) for (const y of [-2, 0, 2]) {
      const crop = avatarCrop(width, height, zoom, { x, y });
      assert.ok(crop.x >= 0 && crop.y >= 0);
      assert.ok(crop.x + crop.side <= width + 1e-9 && crop.y + crop.side <= height + 1e-9);
    }
  }
});

async function socket(base, user) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws?csrf=' + user.csrf, { headers: { Cookie: user.cookie, Origin: base } });
  let seq = 0; const pending = new Map(), events = [];
  ws.on('message', data => {
    const msg = JSON.parse(data), key = msg.id ?? (msg.type === 'error' ? 'upload/ack' : msg.type), waiter = pending.get(key);
    if (!waiter) { events.push(msg); return; }
    pending.delete(key); clearTimeout(waiter.timer); msg.error ? waiter.reject(new Error(msg.error.message || msg.error)) : waiter.resolve(msg.result ?? msg);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const wait = key => new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(key); reject(new Error('WebSocket test timeout')); }, 5000); pending.set(key, { resolve, reject, timer }); });
  return { events, async call(method, params = {}) { const id = ++seq, result = wait(id); ws.send(JSON.stringify({ id, method, params })); try { return await result; } catch (e) { e.message = method + ": " + e.message; throw e; } }, async chunk(data) { const ack = wait('upload/ack'); ws.send(data); return ack; }, async close() { if (ws.readyState === WebSocket.CLOSED) return; await new Promise(resolve => { ws.once('close', resolve); ws.close(); }); } };
}

test('account avatars use authenticated binary uploads, survive reconnect/restart and isolate users', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-avatar-'));
  const instance = await createApp({ dataDir: dir, inviteCode: 'avatar-test', codexFactory: () => ({ instances: new Map(), async stopIdle() {}, async shutdown() {} }) });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${instance.server.address().port}`; instance.config.publicUrl = base;
  const sockets = [];
  async function request(url, user, method = 'GET', body, csrf = user?.csrf) {
    return fetch(base + '/api' + url, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...(user ? { Cookie: user.cookie, 'X-CSRF-Token': csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async function register(username) {
    const response = await request('/register', null, 'POST', { username, password: 'Avatar-test-password42', inviteCode: 'avatar-test' });
    assert.equal(response.status, 200); return { ...(await response.json()).user, cookie: response.headers.get('set-cookie').split(';')[0] };
  }
  const connect = async user => { const s = await socket(base, user); sockets.push(s); return s; };
  let closed = false;
  try {
    const alice = await register('avatar_alice'), bob = await register('avatar_bob'), image = png();
    assert.equal(alice.avatarUrl, null);
    assert.equal((await request('/avatar')).status, 401);
    assert.equal((await request('/avatar', alice)).status, 404);
    const a = await connect(alice), a2 = await connect(alice), b = await connect(bob);
    await assert.rejects(a.call('upload/begin', { scope: 'avatar', size: AVATAR_MAX_BYTES + 1 }), /256 KB/);
    await assert.rejects(a.call('upload/begin', { scope: 'avatar', size: -1 }));
    const task = await a.call('upload/begin', { scope: 'avatar', path: '../../ignored.png', size: image.length });
    await a.chunk(image.subarray(0, 40));
    await assert.rejects(a.call('upload/finish', { uploadId: task.uploadId }), /完整/);
    await assert.rejects(b.call('upload/resume', { uploadId: task.uploadId }), /过期/);
    await assert.rejects(a2.call('upload/resume', { uploadId: task.uploadId }), /另一个连接/);
    await a.close();
    assert.equal((await a2.call('upload/resume', { uploadId: task.uploadId })).offset, 40);
    await a2.chunk(image.subarray(40));
    const saved = await a2.call('upload/finish', { uploadId: task.uploadId });
    assert.match(saved.avatarUrl, /^\/api\/avatar\?v=[a-f0-9]{64}$/);
    const response = await request(saved.avatarUrl.slice(4), alice);
    assert.equal(response.headers.get('content-type'), 'image/png'); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
    assert.equal((await request(saved.avatarUrl.slice(4), bob)).status, 404);
    assert.equal((await (await request('/session', alice)).json()).user.avatarUrl, saved.avatarUrl);
    assert.ok(a2.events.some(event => event.type === 'profile/avatar' && event.avatarUrl === saved.avatarUrl));
    assert.ok(!b.events.some(event => event.type === 'profile/avatar'));
    for (const invalid of [Buffer.from('<svg/>'), png({ width: 128 })]) {
      const upload = await a2.call('upload/begin', { scope: 'avatar', size: invalid.length }); await a2.chunk(invalid);
      await assert.rejects(a2.call('upload/finish', { uploadId: upload.uploadId }));
      assert.equal((await (await request('/session', alice)).json()).user.avatarUrl, saved.avatarUrl);
    }
    assert.equal((await request('/avatar', alice, 'DELETE', null, 'wrong')).status, 403);
    assert.equal((await request('/avatar', bob, 'DELETE')).status, 200);
    assert.equal((await request('/avatar', alice)).status, 200);
    assert.equal((await request('/avatar', alice, 'DELETE')).status, 200);
    assert.equal((await request('/avatar', alice)).status, 404);
    const stale = await a2.call('upload/begin', { scope: 'avatar', size: image.length });
    await assert.rejects(b.call('upload/resume', { uploadId: stale.uploadId }), /过期/);
    await a2.close();
    const a3 = await connect(alice);
    const fresh = await a3.call('upload/begin', { scope: 'avatar', size: image.length });
    assert.notEqual(fresh.uploadId, stale.uploadId);
    await assert.rejects(a3.call('upload/resume', { uploadId: stale.uploadId }), /过期/);
    await a3.chunk(image); await a3.call('upload/finish', { uploadId: fresh.uploadId });
    const a4 = await connect(alice); await a4.call('connection/ping');
    assert.equal(a4.events.find(event => event.type === 'ready').avatarUrl, saved.avatarUrl);
    for (const s of sockets) await s.close();
    await instance.close(); closed = true;
    const reopened = createStore(dir);
    try { assert.deepEqual(Buffer.from(reopened.get('SELECT image FROM user_avatars WHERE user_id=?', alice.id).image), image); assert.equal(reopened.get('SELECT * FROM user_avatars WHERE user_id=?', bob.id), undefined); }
    finally { reopened.db.close(); }
  } finally {
    for (const s of sockets) await s.close();
    if (!closed) await instance.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
