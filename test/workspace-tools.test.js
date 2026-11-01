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

test('private memos enforce sessions, ownership and optimistic concurrency', async t => {
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
  } finally { await instance.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
