import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPaths, contextPaths, parentPath } from '../src/file-selection.js';

test('modifier selection toggles without losing earlier files or mutating the previous selection', () => {
  const visible = ['assets', 'docs', 'src', 'README.md'], initial = new Set(['src']);
  const added = selectPaths(visible, initial, 'README.md', { toggle: true });
  assert.deepEqual([...added], ['src', 'README.md']);
  assert.deepEqual([...initial], ['src']);
  assert.deepEqual([...selectPaths(visible, added, 'src', { toggle: true })], ['README.md']);
});

test('shift ranges follow visible order in both directions and recover from a collapsed anchor', () => {
  const visible = ['assets', 'src', 'src/app.js', 'src/theme.css', 'README.md'];
  assert.deepEqual([...selectPaths(visible, new Set(['assets']), 'src', { range: true, anchor: 'README.md' })], ['src', 'src/app.js', 'src/theme.css', 'README.md']);
  assert.deepEqual([...selectPaths(visible, new Set(['assets']), 'src/theme.css', { range: true, anchor: 'src/app.js', additive: true })], ['assets', 'src/app.js', 'src/theme.css']);
  assert.deepEqual([...selectPaths(['src', 'README.md'], new Set(['assets']), 'README.md', { range: true, anchor: 'src/app.js' })], ['README.md']);
});

test('context clicks retain a selected group and scope new files to a folder or file parent', () => {
  const selected = new Set(['src/app.js', 'docs/guide.md']);
  assert.deepEqual(contextPaths(selected, 'src/app.js'), ['src/app.js', 'docs/guide.md']);
  assert.deepEqual(contextPaths(selected, 'README.md'), ['README.md']);
  assert.deepEqual(contextPaths(selected), []);
  assert.equal(parentPath('src/components/Button.jsx'), 'src/components');
  assert.equal(parentPath('README.md'), '');
});
