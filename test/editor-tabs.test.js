import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDirtyTab, tabClosePaths, closeTabState, hasUnapprovedTabChanges } from '../src/editor-tabs.js';

const tabs = [
  { path: 'README.md', content: 'saved', original: 'saved' },
  { path: 'src/app.js', content: 'edited', original: 'original' },
  { path: 'photo.png', kind: 'image' },
  { path: 'src/notes.txt', content: 'saved', original: 'saved' },
];

test('tab close commands target the clicked tab and preserve list order', () => {
  assert.deepEqual(tabClosePaths(tabs, 'src/app.js', 'single'), ['src/app.js']);
  assert.deepEqual(tabClosePaths(tabs, 'src/app.js', 'others'), ['README.md', 'photo.png', 'src/notes.txt']);
  assert.deepEqual(tabClosePaths(tabs, 'src/app.js', 'right'), ['photo.png', 'src/notes.txt']);
  assert.deepEqual(tabClosePaths(tabs, 'src/notes.txt', 'right'), []);
  assert.deepEqual(tabClosePaths(tabs, 'gone.txt', 'others'), []);
  assert.deepEqual(tabClosePaths(tabs, 'gone.txt', 'right'), []);
  assert.deepEqual(tabClosePaths(tabs, 'src/app.js', 'all'), tabs.map(file => file.path));
});

test('close saved tabs keeps edited text and treats images as saved', () => {
  assert.equal(isDirtyTab(tabs[1]), true);
  assert.equal(isDirtyTab({ ...tabs[2], content: 'binary', original: undefined }), false);
  assert.deepEqual(tabClosePaths(tabs, 'src/app.js', 'saved'), ['README.md', 'photo.png', 'src/notes.txt']);
});

test('closing active tabs chooses the nearest remaining right then left neighbor', () => {
  const initial = structuredClone(tabs);
  assert.equal(closeTabState(tabs, 'src/app.js', ['README.md']).selectedFile, 'src/app.js');
  assert.equal(closeTabState(tabs, 'src/app.js', ['src/app.js']).selectedFile, 'photo.png');
  assert.equal(closeTabState(tabs, 'src/app.js', ['src/app.js', 'photo.png']).selectedFile, 'src/notes.txt');
  assert.equal(closeTabState(tabs, 'src/notes.txt', ['photo.png', 'src/notes.txt']).selectedFile, 'src/app.js');
  assert.deepEqual(closeTabState(tabs, 'src/app.js', tabs.map(file => file.path)), { tabs: [], selectedFile: null });
  assert.deepEqual(tabs, initial);
});

test('close approval rejects newer edits and newly dirty targets while allowing saves', () => {
  const approved = new Map([['src/app.js', 'edited']]), paths = tabs.map(file => file.path);
  assert.equal(hasUnapprovedTabChanges(tabs, paths, approved), false);
  assert.equal(hasUnapprovedTabChanges(tabs.map(file => file.path === 'src/app.js' ? { ...file, content: 'newer edit' } : file), paths, approved), true);
  assert.equal(hasUnapprovedTabChanges(tabs.map(file => file.path === 'README.md' ? { ...file, content: 'new edit' } : file), paths, approved), true);
  assert.equal(hasUnapprovedTabChanges(tabs.map(file => file.path === 'src/app.js' ? { ...file, content: 'saved', original: 'saved' } : file), paths, approved), false);
  assert.equal(hasUnapprovedTabChanges(tabs, ['README.md'], new Map()), false);
});
