import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTurnChanges, projectSnapshot, compareSnapshots } from '../server/turn-changes.js';
import { changesSummary, historicalChanges, hunkRows, projectFilePath, unifiedChanges } from '../shared/file-changes.js';
import { createStore } from '../server/store.js';
import { applyLifecycle, mergeTurns } from '../src/deltas.js';

test('turn snapshots count net changes once, omit preexisting work, and preserve added/deleted line numbers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-turn-diff-'));
  try {
    await fs.writeFile(path.join(root, 'edited.js'), 'already edited before turn\nold line\n');
    await fs.writeFile(path.join(root, 'removed.txt'), 'one\ntwo');
    await fs.mkdir(path.join(root, 'node_modules')); await fs.writeFile(path.join(root, 'node_modules', 'ignored.js'), 'old\n');
    const before = await projectSnapshot(root);
    await fs.writeFile(path.join(root, 'edited.js'), 'already edited before turn\nintermediate\nextra\n');
    await fs.writeFile(path.join(root, 'edited.js'), 'already edited before turn\nfinal line\n');
    await fs.writeFile(path.join(root, 'created.txt'), 'three\nfour\n');
    await fs.unlink(path.join(root, 'removed.txt')); await fs.writeFile(path.join(root, 'node_modules', 'ignored.js'), 'new\n');
    const files = compareSnapshots(before, await projectSnapshot(root)), summary = changesSummary(files);
    assert.deepEqual(files.map(file => file.path), ['created.txt', 'edited.js', 'removed.txt']);
    assert.equal(summary.added, 3); assert.equal(summary.removed, 3);
    const edited = files.find(file => file.path === 'edited.js');
    assert.deepEqual(hunkRows(edited.patches[0].hunks[0]).filter(row => row.type !== 'context').map(row => [row.type, row.oldLine, row.newLine]), [['delete', 2, null], ['add', null, 2]]);
    assert.equal(JSON.stringify(files).includes('intermediate'), false);
    await fs.writeFile(path.join(root, 'edited.js'), 'already edited before turn\nold line\n');
    assert.equal(compareSnapshots(before, await projectSnapshot(root)).some(file => file.path === 'edited.js'), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('binary and oversized files are counted without inventing line counts or following links', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-turn-limits-')), outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-turn-outside-'));
  try {
    await fs.writeFile(path.join(outside, 'secret.txt'), 'outside marker');
    await fs.symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    const before = await projectSnapshot(root);
    await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
    await fs.writeFile(path.join(root, 'large.txt'), 'large text');
    const files = compareSnapshots(before, await projectSnapshot(root, { maxFile: 4 }));
    assert.equal(files.length, 2); assert.ok(files.every(file => file.added == null && !file.patches));
    assert.equal(changesSummary(files).unknown, 2); assert.ok(!JSON.stringify(files).includes('outside marker'));
  } finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});

test('legacy and native patches stay scoped to the project and exclude declined proposals', () => {
  const cwd = '/workspace/project', patch = '--- a/src/file.js\n+++ b/src/file.js\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n';
  const files = unifiedChanges(patch, cwd); assert.equal(files[0].added, 2); assert.equal(files[0].removed, 1);
  const items = [{ type: 'fileChange', status: 'declined', changes: [{ path: cwd + '/declined.js', diff: patch }] }, { type: 'fileChange', status: 'completed', changes: [{ path: cwd + '/src/file.js', diff: patch }, { path: '/workspace/other/private.js', diff: patch }] }];
  assert.deepEqual(historicalChanges({ items }, cwd).map(file => file.path), ['src/file.js']);
  assert.equal(projectFilePath('/workspace/projectevil/private.js', cwd), null);
  assert.equal(projectFilePath('../secret', cwd), null); assert.equal(projectFilePath('node_modules/a.js', cwd), null);
  assert.equal(projectFilePath('/workspace/project/目录/file name.js', cwd), '目录/file name.js');
  assert.equal(hunkRows({ oldStart: 1, newStart: 1, lines: ['+Windows line\r'] })[0].text, 'Windows line');
});

test('renames are one file and use native move information when content also changes', () => {
  const old = { content: 'before\n', hash: 'old' }, changed = { content: 'after\n', hash: 'new' };
  const before = { files: new Map([['old.js', old]]) }, after = { files: new Map([['new.js', changed]]) };
  const renamed = compareSnapshots(before, after, new Map([['old.js', 'new.js']]));
  assert.equal(renamed.length, 1); assert.equal(renamed[0].kind, 'rename'); assert.equal(renamed[0].previousPath, 'old.js'); assert.equal(renamed[0].added, 1); assert.equal(renamed[0].removed, 1);
  const moved = compareSnapshots(before, { files: new Map([['new.js', old]]) }); assert.equal(moved.length, 1); assert.equal(moved[0].added, 0);
});

test('late history and completion snapshots cannot replace newer change summaries or reopen turns', () => {
  let turns = applyLifecycle([], { method: 'turn/changes/updated', params: { turnId: 'one', changes: { revision: 2, status: 'completed', files: [{ path: 'x' }] } } });
  turns = mergeTurns(turns, [{ id: 'one', status: 'inProgress', changes: { revision: 1, files: [] }, items: [] }]);
  assert.equal(turns[0].status, 'completed'); assert.equal(turns[0].changes.files.length, 1);
  turns = applyLifecycle(turns, { method: 'turn/changes/updated', params: { turnId: 'one', changes: { revision: 3, status: 'completed', files: [] } } });
  assert.deepEqual(turns[0].changes.files, []);
});

test('tracker captures shell changes, persists history, forks it and flushes the last concurrent scan', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-turn-store-')), root = path.join(dir, 'project'); await fs.mkdir(root);
  const store = createStore(dir), user = { id: randomUUID(), username: 'fixture', settings: '{}' }, thread = { id: randomUUID(), user_id: user.id, project_id: randomUUID() };
  store.run('INSERT INTO users(id,username,password,created) VALUES(?,?,?,?)', user.id, user.username, 'fixture-hash', Date.now());
  store.run('INSERT INTO projects(id,user_id,name,created) VALUES(?,?,?,?)', thread.project_id, user.id, 'fixture', Date.now());
  const addThread = id => store.run('INSERT INTO threads(id,user_id,project_id,title,created) VALUES(?,?,?,?,?)', id, user.id, thread.project_id, 'fixture', Date.now()); addThread(thread.id);
  const events = []; let release, scanStarted;
  const tracker = createTurnChanges({ store, root: () => root, cwd: () => '/workspace/' + thread.project_id, emit: (uid, event) => events.push(event), delay: 0, snapshot: async project => { if (scanStarted) { const callback = scanStarted; scanStarted = null; callback(); await new Promise(resolve => { release = resolve; }); } return projectSnapshot(project); } });
  try {
    await fs.writeFile(path.join(root, 'app.js'), 'before\n'); await tracker.begin(user, thread);
    tracker.observe(user.id, { method: 'turn/started', params: { threadId: thread.id, turn: { id: 'turn-one' } } });
    await fs.writeFile(path.join(root, 'app.js'), 'during\n');
    const blocked = new Promise(resolve => { scanStarted = resolve; });
    tracker.observe(user.id, { method: 'item/completed', params: { threadId: thread.id, turnId: 'turn-one', item: { type: 'commandExecution' } } }); await blocked;
    assert.equal(tracker.busy(), true);
    await fs.writeFile(path.join(root, 'app.js'), 'after\nextra\n');
    tracker.observe(user.id, { method: 'turn/completed', params: { threadId: thread.id, turn: { id: 'turn-one', status: 'completed' } } }); release();
    for (let i = 0; i < 100 && !events.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const details = tracker.details(thread, 'turn-one'); assert.equal(details.added, 2); assert.equal(details.removed, 1); assert.equal(details.status, 'completed');
    tracker.observe(user.id, { method: 'turn/diff/updated', params: { threadId: thread.id, turnId: 'turn-one', diff: '' } });
    assert.equal(tracker.details(thread, 'turn-one').added, 2);
    assert.equal(JSON.stringify(details).includes('during'), false); assert.equal(tracker.summary(thread, { id: 'turn-one' }).revision, details.revision);
    const fork = randomUUID(); addThread(fork); tracker.fork(thread.id, fork); assert.deepEqual(tracker.details({ id: fork }, 'turn-one'), details);
    await tracker.close(); store.db.close();
    const reopened = createStore(dir), restored = createTurnChanges({ store: reopened, root: () => root, cwd: () => '', emit: () => {} });
    assert.equal(restored.details(thread, 'turn-one').added, 2); await restored.close(); reopened.db.close();
  } finally { await tracker.close(); try { store.db.close(); } catch {} await fs.rm(dir, { recursive: true, force: true }); }
});
