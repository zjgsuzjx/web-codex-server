import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.ts';

test('authenticated notification pushes carry cached filters, isolate reads and recover missed changes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-push-'));
  const app = await createApp({ dataDir: dir, inviteCode: 'synthetic-invite', codexFactory: () => ({ instances: new Map(), async shutdown() {}, async stopIdle() {} }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`; app.config.publicUrl = base;
  const sockets = [];
  async function request(url, session, method = 'GET', body) {
    const response = await fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', Origin: base, ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function register(username) {
    const response = await request('/register', null, 'POST', { username, password: 'Synthetic-password-42', inviteCode: 'synthetic-invite' });
    assert.equal(response.status, 200);
    return { ...response.data.user, cookie: response.headers.get('set-cookie').split(';')[0] };
  }
  async function connect(session) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws?csrf=' + session.csrf, { headers: { Cookie: session.cookie, Origin: base } });
    const queue = []; let waiter;
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type !== 'site/notifications') return;
      if (waiter) { const resolve = waiter; waiter = null; resolve(message.snapshot); } else queue.push(message.snapshot);
    });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const client = {
      ws,
      next() { if (queue.length) return Promise.resolve(queue.shift()); return new Promise((resolve, reject) => { const timer = setTimeout(() => { waiter = null; reject(new Error('notification push timeout')); }, 5000); waiter = value => { clearTimeout(timer); resolve(value); }; }); },
      async close() { if (ws.readyState === WebSocket.CLOSED) return; await new Promise(resolve => { ws.once('close', resolve); ws.close(); }); },
    };
    sockets.push(client); return client;
  }
  try {
    const owner = await register('owner'), member = await register('member');
    for (let i = 0; i < 65; i++) app.store.run('INSERT INTO site_notifications(title,body,author_id,created) VALUES(?,?,?,?)', `fixture ${i}`, 'body', owner.id, Date.now()-120000);
    app.store.run('INSERT INTO notification_reads(user_id,notification_id) SELECT ?,id FROM site_notifications WHERE id>30', member.id);
    const a = await connect(owner), b = await connect(member), b2 = await connect(member);
    const [initialA, initialB, initialB2] = await Promise.all([a.next(), b.next(), b2.next()]);
    assert.equal(initialB.all.items.length, 30); assert.equal(initialB.unread.items.length, 30);
    assert.equal(initialB.all.items[0].id, 65); assert.equal(initialB.unread.items[0].id, 30);
    assert.equal(initialB.all.items[0].read, true); assert.equal(initialB.unread.items[0].read, false);
    assert.equal(initialB.all.unread, 30); assert.equal(initialB.version, initialB2.version);
    assert.equal(initialB.all.version, initialB.unread.version);
    const page = (await request('/notifications?cursor=36', member)).data;
    assert.equal(page.version, initialB.version); assert.equal(page.items.length, 30);
    assert.equal((await request('/notifications/snapshot')).status, 401);
    assert.deepEqual((await request('/notifications/snapshot', member)).data, initialB);
    const read = await request('/notifications/read', member, 'POST', { id: 30 });
    const [readB, readB2] = await Promise.all([b.next(), b2.next()]);
    assert.equal(readB.all.unread, 29); assert.notEqual(readB.version, initialB.version);
    assert.deepEqual(read.data.snapshot, readB); assert.deepEqual(readB2, readB);
    assert.equal((await request('/notifications?filter=all', owner)).data.version, initialA.version);
    const published = await request('/admin/notifications', owner, 'POST', { title: 'Pushed announcement', body: 'Delivered over WebSocket' });
    assert.equal(published.status, 201);
    const [newA, newB, newB2] = await Promise.all([a.next(), b.next(), b2.next()]);
    assert.equal(newA.all.latest, published.data.id); // No other user's read-state event may precede it.
    assert.equal(newA.all.unread, 66); assert.equal(newB.all.unread, 30);
    assert.equal(newB.unread.items[0].title, 'Pushed announcement'); assert.deepEqual(newB2, newB);
    const noChange = await request('/notifications/read', member, 'POST', { id: 30 });
    assert.equal(noChange.data.snapshot.version, newB.version);
    await request('/admin/notifications/' + published.data.id, owner, 'DELETE');
    const [deletedA, deletedB, deletedB2] = await Promise.all([a.next(), b.next(), b2.next()]);
    assert.equal(deletedA.all.latest, 65); assert.equal(deletedB.all.unread, 29);
    assert.ok(!deletedB.all.items.some(item => item.id === published.data.id)); assert.deepEqual(deletedB2, deletedB);
    assert.notEqual(deletedB.version, newB.version);
    await b2.close();
    const offline = await request('/admin/notifications', owner, 'POST', { title: 'While disconnected', body: 'Recover on reconnect' });
    await Promise.all([a.next(), b.next()]);
    const reconnected = await connect(member), recovered = await reconnected.next();
    assert.equal(recovered.unread.items[0].id, offline.data.id); assert.equal(recovered.all.unread, 30);
    assert.notEqual(recovered.version, deletedB.version);
    const readonly = await request('/admin/notifications', member, 'POST', { title: 'forbidden', body: 'forbidden' });
    assert.equal(readonly.status, 403);
  } finally { await Promise.all(sockets.map(socket => socket.close())); await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
