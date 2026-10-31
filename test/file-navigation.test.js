import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareFileEntries, findFiles, indexLazyFiles } from '../src/file-navigation.js';

const file = (path, modified = 1, created = 1) => ({ path, name: path.split('/').at(-1), type: 'file', modified, created });

test('six tree orders keep folders first, use numeric names and put unknown dates last', () => {
  const entries = [file('file10.js', 30, 10), file('file2.js', 10, 30), file('unknown.js', null, null), { ...file('folder', 100, 100), type: 'directory' }];
  const order = sort => [...entries].sort(compareFileEntries(sort)).map(entry => entry.name);
  assert.deepEqual(order('name-asc'), ['folder', 'file2.js', 'file10.js', 'unknown.js']);
  assert.deepEqual(order('name-desc'), ['folder', 'unknown.js', 'file10.js', 'file2.js']);
  assert.deepEqual(order('modified-asc'), ['folder', 'file2.js', 'file10.js', 'unknown.js']);
  assert.deepEqual(order('modified-desc'), ['folder', 'file10.js', 'file2.js', 'unknown.js']);
  assert.deepEqual(order('created-asc'), ['folder', 'file10.js', 'file2.js', 'unknown.js']);
  assert.deepEqual(order('created-desc'), ['folder', 'file2.js', 'file10.js', 'unknown.js']);
  assert.deepEqual(order('invalid'), order('name-asc'));
  assert.equal(entries[0].name, 'file10.js');
});

test('quick file matching prioritizes names and supports paths, fuzzy input, Unicode and result limits', () => {
  const entries = [file('src/ProjectFiles.jsx'), file('test/ProjectFiles.test.js'), file('src/中文文件.js'), file('lib/index.js'), file('src/index.js'), { path: 'ProjectFiles', name: 'ProjectFiles', type: 'directory' }];
  assert.equal(findFiles(entries, 'projectfiles.jsx').entries[0].path, 'src/ProjectFiles.jsx');
  assert.equal(findFiles(entries, 'PFjsx').entries[0].path, 'src/ProjectFiles.jsx');
  assert.deepEqual(findFiles(entries, 'src\\index').entries.map(entry => entry.path), ['src/index.js']);
  assert.deepEqual(findFiles(entries, 'test projectfiles').entries.map(entry => entry.path), ['test/ProjectFiles.test.js']);
  assert.equal(findFiles(entries, '中文').entries[0].path, 'src/中文文件.js');
  assert.equal(findFiles(entries, 'no-such-file').total, 0);
  assert.equal(findFiles(entries, 'js', 2).entries.length, 2);
  assert.equal(findFiles(entries, 'js').total, 5);
  assert.deepEqual(findFiles(entries, ''), { entries: [], total: 0 });
  assert.deepEqual(findFiles(entries, '  \t '), { entries: [], total: 0 });
});

test('quick search excludes dot folders at every depth while keeping dot files', () => {
  const entries = ['.git/config', 'src/.private/config', 'src/.private/deeper/config', 'node_modules/.cache/config', 'src/config', '.config', 'src/.config', 'dot.folder/config'].map(path => file(path));
  assert.deepEqual(findFiles(entries, 'config').entries.map(entry => entry.path).sort(), ['.config', 'dot.folder/config', 'src/.config', 'src/config']);
});

test('quick file indexing discovers nested lazy folders, retains results after errors and aborts obsolete work', async () => {
  const directory = path => ({ path, name: path.split('/').at(-1), type: 'directory', lazy: true });
  const calls = [], batches = [], controller = new AbortController();
  const failures = await indexLazyFiles([directory('.git'), directory('node_modules'), directory('broken')], async path => {
    calls.push(path);
    if (path === 'broken') throw new Error('unavailable');
    return path === 'node_modules' ? [file('node_modules/a.js'), directory('node_modules/nested'), directory('node_modules/.cache'), file('node_modules/.cache/b.js')] : [file('node_modules/nested/b.js')];
  }, { onBatch: rows => batches.push(...rows) });
  assert.deepEqual(calls, ['node_modules', 'broken', 'node_modules/nested']);
  assert.equal(failures[0].path, 'broken');
  assert.equal(findFiles(batches, 'b.js').entries[0].path, 'node_modules/nested/b.js');
  assert.ok(batches.every(entry => !entry.path.includes('.cache')));
  let delivered = false, requested = 0;
  await indexLazyFiles([directory('first'), directory('second')], async () => {
    requested++; controller.abort(); return [file('stale.js')];
  }, { signal: controller.signal, onBatch: () => { delivered = true; } });
  assert.equal(requested, 1); assert.equal(delivered, false);
});
