import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';
import { createApp } from '../server/index.js';

test('selected ZIP downloads preserve paths and empty folders with auth, CSRF and safe file boundaries', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-selected-download-'));
  const app = await createApp({ dataDir: directory, inviteCode: 'zip-test-invite', codexFactory: () => ({ instances: new Map(), async stopIdle() {}, async shutdown() {} }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`; app.config.publicUrl = base;
  const request = (url, session, method = 'GET', body, headers = {}) => fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  async function register(username) {
    const response = await request('/register', null, 'POST', { username, password: 'Zip-test-password42', inviteCode: 'zip-test-invite' });
    assert.equal(response.status, 200);
    return { ...(await response.json()).user, cookie: response.headers.get('set-cookie').split(';')[0] };
  }
  try {
    const owner = await register('zipowner'), other = await register('zipother');
    const project = await (await request('/projects', owner, 'POST', { name: '测试工程' })).json();
    const endpoint = `/projects/${project.id}/download`;
    for (const [name, content] of Object.entries({ 'src/a.txt': 'source', 'src/a.txt.meta': 'meta', 'docs/a.txt': 'guide', 'unselected.txt': 'leave out' })) {
      assert.equal((await request(`/projects/${project.id}/file`, owner, 'PUT', { path: name, content })).status, 200);
    }
    assert.equal((await request(`/projects/${project.id}/directory`, owner, 'POST', { path: '空目录' })).status, 201);
    const root = path.join(directory, 'users', owner.username, 'projects', project.id), outside = path.join(directory, 'outside');
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'secret.txt'), 'outside-only');
    await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await fs.symlink(outside, path.join(root, 'src', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

    const response = await request(endpoint, owner, 'POST', { paths: ['src', 'src/a.txt', 'docs/a.txt', '空目录'] });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /application\/zip/);
    assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8''/);
    const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
    assert.deepEqual(Object.keys(zip).sort(), ['docs/a.txt', 'src/', 'src/a.txt', 'src/a.txt.meta', '空目录/'].sort());
    assert.equal(strFromU8(zip['src/a.txt']), 'source'); assert.equal(strFromU8(zip['docs/a.txt']), 'guide');
    assert.equal(zip['空目录/'].length, 0);
    const folder = await request(endpoint + '?path=src', owner);
    assert.equal(folder.status, 200);
    const folderZip = unzipSync(new Uint8Array(await folder.arrayBuffer()));
    assert.deepEqual(Object.keys(folderZip).sort(), ['a.txt', 'a.txt.meta']);

    assert.equal((await request(endpoint, null, 'POST', { paths: ['src'] })).status, 401);
    assert.equal((await request(endpoint, other, 'POST', { paths: ['src'] })).status, 404);
    assert.equal((await request(endpoint, owner, 'POST', { paths: ['src'] }, { 'X-CSRF-Token': 'wrong' })).status, 403);
    for (const paths of [[], 'src', [null], ['../outside'], ['/etc/passwd'], ['src\\a.txt'], Array(201).fill('src')]) {
      assert.equal((await request(endpoint, owner, 'POST', { paths })).status, 400);
    }
    for (const paths of [['linked/secret.txt'], ['linked']]) assert.equal((await request(endpoint, owner, 'POST', { paths })).status, 403);
    const missing = await request(endpoint, owner, 'POST', { paths: ['src', 'missing.txt'] });
    assert.equal(missing.status, 404); assert.match(missing.headers.get('content-type'), /application\/json/);
  } finally { await app.close(); await fs.rm(directory, { recursive: true, force: true }); }
});
