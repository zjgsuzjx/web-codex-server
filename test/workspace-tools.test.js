import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.ts';
import { createStore } from '../server/db/store.ts';
import { memoMarkdown, validateMemo, MEMO_LIMIT } from '../shared/workspace/memo.ts';

test('memo format validation bounds structure and exports safe Markdown', () => {
  const nodes = validateMemo([{ tag: 'div', checked: true, children: [{ tag: 'b', children: [{ text: '完成第一步' }] }] }, { tag: 'p', children: [{ tag: 'i', children: [{ text: '想法' }] }, { tag: 'u', children: [{ text: '<script>alert(1)</script>' }] }] }]);
  assert.match(memoMarkdown(nodes), /- \[x\] \*\*完成第一步\*\*/);
  assert.match(memoMarkdown(nodes), /\*想法\*/);
  assert.ok(!memoMarkdown(nodes).includes('<script>'));
  assert.throws(() => validateMemo([{ tag: 'script', children: [] }]));
  assert.throws(() => validateMemo([{ text: 'x'.repeat(MEMO_LIMIT + 1) }]));
  assert.throws(() => validateMemo([{ tag: 'div', size: 8 }]));
  assert.throws(() => validateMemo([{ tag: 'div', checked: 'true' }]));
  let deep = { text: 'x' }; for (let i = 0; i < 25; i++) deep = { tag: 'div', children: [deep] };
  assert.throws(() => validateMemo([deep]));
  assert.deepEqual(validateMemo([{ tag: 'span', onclick: 'bad', style: 'bad', children: [{ text: 'safe' }] }]), [{ tag: 'span', children: [{ text: 'safe' }] }]);
});

test('memos and website notifications enforce sessions, ownership, concurrency and roles', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-tools-'));
  const instance = await createApp({ dataDir: dir, inviteCode: 'synthetic-invite', codexFactory: () => ({ instances: new Map(), async shutdown() {}, async stopIdle() {} }) });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  instance.config.publicUrl = base;
  async function request(url, session, method = 'GET', body, headers = {}) {
    const response = await fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', Origin: base, ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function register(username) {
    const result = await request('/register', null, 'POST', { username, password: 'Synthetic-password-42', inviteCode: 'synthetic-invite' });
    assert.equal(result.status, 200);
    return { ...result.data.user, cookie: result.headers.get('set-cookie').split(';')[0] };
  }
  try {
    const owner = await register('owner'), user = await register('member'), admin = await register('manager');
    instance.store.run("UPDATE users SET role='admin' WHERE id=?", admin.id);
    await t.test('memo is private, survives reopen and rejects stale or invalid writes', async () => {
      assert.equal((await request('/memo')).status, 401);
      assert.deepEqual((await request('/memo', owner)).data, { nodes: [], version: 0, updated: null });
      assert.equal((await request('/memo', owner, 'PUT', { nodes: [], version: 8 })).status, 409);
      const nodes = [{ tag: 'div', checked: false, children: [{ text: '私人想法' }] }];
      const first = await request('/memo', owner, 'PUT', { nodes, version: 0 });
      assert.equal(first.status, 200); assert.equal(first.data.version, 1);
      assert.equal((await request('/memo', owner, 'PUT', { nodes: [], version: 0 })).status, 409);
      assert.equal((await request('/memo', owner, 'PUT', { nodes: [], version: 1 }, { 'X-CSRF-Token': 'bad' })).status, 403);
      assert.equal((await request('/memo', owner, 'PUT', { nodes: [{ tag: 'script' }], version: 1 })).status, 400);
      assert.deepEqual((await request('/memo', user)).data.nodes, []);
      const otherStore = createStore(dir);
      assert.equal(JSON.parse(otherStore.get('SELECT content FROM user_memos WHERE user_id=?', owner.id).content)[0].children[0].text, '私人想法');
      otherStore.db.close();
      assert.equal((await request('/memo', user, 'PUT', { nodes: [{ text: 'member memo' }], version: 0, userId: owner.id })).status, 200);
      assert.deepEqual((await request('/memo', owner)).data.nodes, first.data.nodes);
      assert.equal((await request('/memo', owner, 'PUT', { nodes: [], version: 1 })).data.version, 2);
    });
    let published;
    await t.test('only persisted administrators publish and delete; content is bounded', async () => {
      assert.equal((await request('/notifications')).status, 401);
      assert.equal((await request('/admin/notifications', user, 'POST', { title: 'bad', body: 'bad', role: 'superadmin' })).status, 403);
      assert.equal((await request('/admin/notifications', owner, 'POST', { title: ' ', body: 'hello' })).status, 400);
      assert.equal((await request('/admin/notifications', owner, 'POST', { title: 'hi', body: 'x'.repeat(10001) })).status, 400);
      const result = await request('/admin/notifications', admin, 'POST', { title: '网站更新', body: '<img src=x onerror=alert(1)>\n第二行' });
      assert.equal(result.status, 201); published = result.data.id;
      assert.equal((await request('/admin/notifications', owner, 'POST', { title: '新公告', body: '欢迎' })).status, 201);
      const page = (await request('/notifications?filter=all', user)).data;
      assert.equal(page.unread, 2); assert.equal(page.items.length, 2);
      assert.equal(page.items[1].body, '<img src=x onerror=alert(1)>\n第二行');
      assert.equal(page.items[1].author, 'manager');
      assert.equal((await request(`/admin/notifications/${published}`, user, 'DELETE')).status, 403);
      instance.store.run("UPDATE users SET role='user' WHERE id=?", admin.id);
      assert.equal((await request('/admin/notifications', admin, 'POST', { title: 'bad', body: 'bad' })).status, 403);
      instance.store.run("UPDATE users SET role='admin' WHERE id=?", admin.id);
    });
    await t.test('read receipts are per user and mark-all respects the displayed snapshot', async () => {
      const snapshot = (await request('/notifications', user)).data;
      assert.equal((await request('/notifications/read', user, 'POST', { id: published })).status, 200);
      assert.equal((await request('/notifications?filter=unread', user)).data.items.length, 1);
      assert.equal((await request('/notifications', owner)).data.unread, 2);
      assert.equal((await request('/admin/notifications', owner, 'POST', { title: '刚收到', body: '不要提前标记这条消息' })).status, 201);
      assert.equal((await request('/notifications/read', user, 'POST', { through: snapshot.latest })).status, 200);
      const unread = (await request('/notifications?filter=unread', user)).data;
      assert.equal(unread.unread, 1); assert.equal(unread.items[0].title, '刚收到');
      assert.equal((await request('/notifications/read', user, 'POST', {})).status, 400);
      assert.equal((await request('/notifications/read', user, 'POST', { through: '999' })).status, 400);
      assert.equal((await request(`/admin/notifications/${published}`, admin, 'DELETE')).status, 200);
      assert.equal(instance.store.get('SELECT COUNT(*) AS n FROM notification_reads WHERE notification_id=?', published).n, 0);
    });
    await t.test('cursor paging does not skip older messages when new ones arrive', async () => {
      const statement = instance.store.db.prepare('INSERT INTO site_notifications(title,body,author_id,created) VALUES(?,?,?,?)');
      for (let i = 0; i < 65; i++) statement.run(`message ${i}`, 'body', owner.id, Date.now());
      const first = (await request('/notifications', user)).data;
      assert.equal(first.items.length, 30); assert.ok(first.nextCursor);
      statement.run('arrived during paging', 'body', owner.id, Date.now());
      const ids = first.items.map(item => item.id); let cursor = first.nextCursor;
      while (cursor) { const page = (await request(`/notifications?cursor=${cursor}`, user)).data; ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor; }
      assert.equal(ids.length, 67); assert.equal(new Set(ids).size, 67);
      assert.equal((await request('/notifications?cursor=bad', user)).status, 400);
    });
  } finally { await instance.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
