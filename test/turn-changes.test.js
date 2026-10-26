import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTurnChanges, projectSnapshot, compareSnapshots } from '../server/turn-changes.js';
import { changesSummary, historicalChanges, hunkRows, projectFilePath, unifiedChanges } from '../shared/file-changes.js';
import { createStore } from '../server/store.js';
import { applyLifecycle, mergeTurns } from '../src/deltas.js';

const execute = promisify(execFile);
async function git(root, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' });
  return execute('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], { env, windowsHide: true });
}

async function trackingFixture(options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-preview-store-'));
  const store = createStore(dir), user = { id: randomUUID(), username: 'fixture', settings: '{}' }, thread = { id: randomUUID(), user_id: null, project_id: randomUUID() }; thread.user_id = user.id;
  store.run('INSERT INTO users(id,username,password,created) VALUES(?,?,?,?)', user.id, user.username, 'fixture-hash', Date.now());
  store.run('INSERT INTO projects(id,user_id,name,created) VALUES(?,?,?,?)', thread.project_id, user.id, 'fixture', Date.now());
  store.run('INSERT INTO threads(id,user_id,project_id,title,created) VALUES(?,?,?,?,?)', thread.id, user.id, thread.project_id, 'fixture', Date.now());
  const tracker = createTurnChanges({ store, root: () => dir, cwd: () => '/workspace/project', emit: () => {}, delay: 0, ...options });
  return { store, tracker, user, thread, close: async () => { await tracker.close(); store.db.close(); await fs.rm(dir, { recursive: true, force: true }); } };
}

async function complete(fixture, turnId) {
  const { tracker, user, thread } = fixture;
  tracker.observe(user.id, { method: 'turn/completed', params: { threadId: thread.id, turn: { id: turnId, status: 'completed' } } });
  for (let index = 0; index < 100 && tracker.busy(); index++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(tracker.busy(), false);
  return tracker.details(thread, turnId);
}

test('project scope respects Git ignores, keeps new source and tracked exceptions, and detects nested repositories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-project-scope-'));
  const repo = path.join(root, 'DT 2.0');
  try {
    await git(root, 'init', '--quiet');
    await fs.writeFile(path.join(root, '.gitignore'), 'ignoredRepo/\n');
    const ignoredRepo = path.join(root, 'ignoredRepo'); await fs.mkdir(ignoredRepo); await git(ignoredRepo, 'init', '--quiet');
    await fs.writeFile(path.join(ignoredRepo, 'hidden.cs'), 'ignored repository\n');
    await fs.mkdir(repo); await git(repo, 'init', '--quiet');
    await fs.writeFile(path.join(repo, '.gitignore'), '.work/\nignored/\n*.generated.cs\n');
    await fs.mkdir(path.join(repo, '.work')); await fs.mkdir(path.join(repo, 'ignored'));
    await fs.writeFile(path.join(repo, '.work', 'versioned.cs'), 'versioned before\n');
    await git(repo, 'add', '--force', '.work/versioned.cs');
    const before = await projectSnapshot(root);
    assert.equal(before.files.has('ignoredRepo/hidden.cs'), false);
    await fs.writeFile(path.join(repo, '.work', 'versioned.cs'), 'versioned after\n');
    await fs.writeFile(path.join(repo, '.work', 'MarkerManager.cs'), 'backup\n');
    await fs.writeFile(path.join(repo, '.work', 'After.dll'), Buffer.from([0, 1, 2]));
    await fs.writeFile(path.join(repo, 'ignored', 'hidden.cs'), 'ignored\n');
    await fs.writeFile(path.join(repo, 'hidden.generated.cs'), 'generated\n');
    await fs.writeFile(path.join(repo, '新的源码.cs'), 'new source\n');
    const files = compareSnapshots(before, await projectSnapshot(root, { baseline: before }));
    assert.deepEqual(files.map(file => file.path), ['DT 2.0/.work/versioned.cs', 'DT 2.0/新的源码.cs']);
    assert.ok(files.every(file => file.patches?.length));
    await fs.writeFile(path.join(repo, '.gitignore'), '*\n');
    const afterIgnore = await projectSnapshot(root, { baseline: before });
    assert.ok(afterIgnore.files.has('DT 2.0/.gitignore'), 'ignore changes must not invent deletions of baseline files');
    assert.ok(afterIgnore.files.has('DT 2.0/.work/versioned.cs'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Git worktree files retain tracked exceptions to ignore and generated-file defaults', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-worktree-scope-')), repo = path.join(root, 'repo'), worktree = path.join(root, 'checkout');
  try {
    await fs.mkdir(repo); await git(repo, 'init', '--quiet');
    await fs.mkdir(path.join(repo, '.work')); await fs.writeFile(path.join(repo, '.work', 'versioned.cs'), 'before\n');
    await fs.writeFile(path.join(repo, '.gitignore'), '.work/\n'); await git(repo, 'add', '--force', '.gitignore', '.work/versioned.cs');
    await git(repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture');
    await git(repo, 'worktree', 'add', '--quiet', '--detach', worktree);
    const before = await projectSnapshot(worktree);
    assert.ok(before.files.has('.work/versioned.cs'));
    await fs.writeFile(path.join(worktree, '.work', 'versioned.cs'), 'after\n');
    await fs.writeFile(path.join(worktree, '.work', 'ignored.cs'), 'backup\n');
    assert.deepEqual(compareSnapshots(before, await projectSnapshot(worktree, { baseline: before })).map(file => file.path), ['.work/versioned.cs']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('uploaded folders apply nested ignore rules and omit scratch and build outputs without hiding Unity metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-upload-scope-'));
  try {
    await fs.mkdir(path.join(root, 'Assets')); await fs.mkdir(path.join(root, '.work'));
    await fs.writeFile(path.join(root, '.gitignore'), '*.generated.cs\n');
    await fs.writeFile(path.join(root, 'Assets', '.gitignore'), '!keep.generated.cs\n');
    for (const name of ['MarkerManager.cs', 'MarkerManager.cs.meta', 'keep.generated.cs', 'After.dll', 'run.log']) await fs.writeFile(path.join(root, 'Assets', name), 'content\n');
    await fs.writeFile(path.join(root, 'hidden.generated.cs'), 'ignored\n');
    await fs.writeFile(path.join(root, '.work', 'Backup.cs'), 'backup\n');
    const snapshot = await projectSnapshot(root);
    assert.deepEqual([...snapshot.files.keys()].sort(), ['.gitignore', 'Assets/.gitignore', 'Assets/MarkerManager.cs', 'Assets/MarkerManager.cs.meta', 'Assets/keep.generated.cs']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('large C# source has a real net preview and binary assets do not exhaust its text budget', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-source-preview-'));
  try {
    const source = Array.from({ length: 50000 }, (_, index) => `// C# source line ${index}\n`).join('');
    assert.ok(Buffer.byteLength(source) > 512 * 1024);
    await fs.writeFile(path.join(root, 'MarkerManager.cs'), source);
    for (let index = 0; index < 6; index++) await fs.writeFile(path.join(root, `asset-${index}.bin`), Buffer.alloc(3 * 1024 * 1024));
    const before = await projectSnapshot(root, { maxBytes: 2 * 1024 * 1024 });
    assert.equal(before.files.get('MarkerManager.cs').content, source);
    await fs.appendFile(path.join(root, 'MarkerManager.cs'), '// changed\n');
    const files = compareSnapshots(before, await projectSnapshot(root, { baseline: before, maxBytes: 2 * 1024 * 1024 }));
    assert.equal(files.length, 1); assert.equal(files[0].path, 'MarkerManager.cs');
    assert.equal(files[0].added, 1); assert.equal(files[0].removed, 0);
    assert.ok(files[0].patches[0].hunks[0].lines.includes('+// changed'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('unchanged source shares the baseline so changed files retain the full follow-up budget', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-shared-baseline-'));
  try {
    await fs.writeFile(path.join(root, 'a.js'), '// unchanged text\n');
    await fs.writeFile(path.join(root, 'z.js'), '// old\n');
    const before = await projectSnapshot(root, { maxBytes: 32 });
    await fs.writeFile(path.join(root, 'z.js'), '// changed with more text\n');
    const after = await projectSnapshot(root, { baseline: before, maxBytes: 32 });
    assert.equal(after.files.get('a.js').content, before.files.get('a.js').content);
    const files = compareSnapshots(before, after);
    assert.equal(files.length, 1); assert.equal(files[0].added, 1); assert.equal(files[0].removed, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('old stored histories hide scratch outputs and recalculate summaries without changing the database', async () => {
  const fixture = await trackingFixture();
  try {
    const files = [{ path: '.work/before/MarkerManager.cs', kind: 'add', added: 1473, removed: 0 }, { path: '.work/tests/After.dll', kind: 'add', added: null, removed: null }, { path: 'Assets/MarkerManager.cs', kind: 'update', added: 3, removed: 1 }];
    fixture.store.run('INSERT INTO turn_changes(thread_id,turn_id,revision,summary,details) VALUES(?,?,?,?,?)', fixture.thread.id, 'old-turn', 1, JSON.stringify(changesSummary(files)), JSON.stringify(files));
    const summary = fixture.tracker.summary(fixture.thread, { id: 'old-turn' }), details = fixture.tracker.details(fixture.thread, 'old-turn');
    assert.deepEqual(summary.files.map(file => file.path), ['Assets/MarkerManager.cs']);
    assert.equal(summary.added, 3); assert.equal(summary.removed, 1); assert.equal(summary.unknown, 0);
    assert.deepEqual(details.files.map(file => file.path), ['Assets/MarkerManager.cs']);
    assert.equal(JSON.parse(fixture.store.get('SELECT details FROM turn_changes WHERE turn_id=?', 'old-turn').details).length, 3);
  } finally { await fixture.close(); }
});

test('recorded native turn patches recover unavailable snapshot previews with an explicit source notice', async () => {
  let scans = 0;
  const fixture = await trackingFixture({ snapshot: async () => ({ files: new Map([['src/file.cs', { size: ++scans, modified: scans, content: null, reason: 'snapshot limit' }]]) }) });
  try {
    await fixture.tracker.begin(fixture.user, fixture.thread); fixture.tracker.bind(fixture.user, fixture.thread, 'native-turn');
    fixture.tracker.observe(fixture.user.id, { method: 'turn/diff/updated', params: { threadId: fixture.thread.id, turnId: 'native-turn', diff: '--- a/src/file.cs\n+++ b/src/file.cs\n@@ -1 +1 @@\n-before\n+after\n' } });
    const details = await complete(fixture, 'native-turn');
    assert.equal(details.files.length, 1); assert.equal(details.added, 1); assert.equal(details.removed, 1);
    assert.ok(details.files[0].patches[0].hunks[0].lines.includes('+after'));
    assert.match(details.files[0].previewWarning, /Codex/); assert.equal(details.files[0].reason, undefined);
  } finally { await fixture.close(); }
});

test('one oversized patch does not prevent later small files from retaining their previews', async () => {
  let scans = 0;
  const fixture = await trackingFixture({ snapshot: async () => ({ files: ++scans === 1 ? new Map() : new Map([['a.cs', { content: '界'.repeat(1500 * 1024), hash: 'a' }], ['z.cs', { content: 'small preview\n', hash: 'z' }]]) }) });
  try {
    await fixture.tracker.begin(fixture.user, fixture.thread); fixture.tracker.bind(fixture.user, fixture.thread, 'budget-turn');
    const details = await complete(fixture, 'budget-turn');
    assert.equal(details.files[0].patches, undefined); assert.match(details.files[0].reason, /大小限制/);
    assert.ok(details.files[1].patches[0].hunks[0].lines.includes('+small preview'));
    assert.equal(details.added, 2); assert.equal(details.unknown, 0);
  } finally { await fixture.close(); }
});

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
