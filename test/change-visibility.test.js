import test from 'node:test';
import assert from 'node:assert/strict';
import { ignoredChangePath, visibleChanges } from '../src/features/files/lib/change-visibility.ts';

test('ignored folders match descendants with a path boundary', () => {
  assert.equal(ignoredChangePath('build', ['build']), true);
  assert.equal(ignoredChangePath('build/nested/main.js', ['build']), true);
  assert.equal(ignoredChangePath('builder/main.js', ['build']), false);
  assert.equal(ignoredChangePath('src/build/main.js', ['build']), false);
});
test('display filtering recalculates totals and preserves the original changes', () => {
  const summary = { revision: 2, status: 'completed', source: 'snapshot', files: [
    { path: 'build/main.js', kind: 'add', added: 20, removed: 0 },
    { path: 'src/main.ts', kind: 'update', added: 3, removed: 2 },
    { path: 'image.png', kind: 'add', added: null, removed: null },
  ] };
  const result = visibleChanges(summary, ['build']);
  assert.deepEqual(result.files.map(file => file.path), ['src/main.ts', 'image.png']);
  assert.equal(result.added, 3);
  assert.equal(result.removed, 2);
  assert.equal(result.unknown, 1);
  assert.equal(summary.files.length, 3);
  assert.equal(visibleChanges(summary, ['build', 'src', 'image.png']).files.length, 0);
  assert.equal(visibleChanges(undefined, []), undefined);
});
