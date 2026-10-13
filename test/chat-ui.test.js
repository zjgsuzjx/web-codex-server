import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompletionNotice } from '../src/completion-notice.js';
import { isFileLineLink, websiteInfo } from '../src/link-info.js';

function fakePage() {
  const events = new EventTarget(), view = new EventTarget();
  const attributes = new Map([['href', 'original-icon.svg']]);
  const icon = { getAttribute: key => attributes.get(key) ?? null, setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) };
  return Object.assign(events, { title: '工作区', visibilityState: 'visible', focused: true, hasFocus() { return this.focused; }, querySelector: () => icon, defaultView: view, icon });
}
const done = (id, threadId = 'thread-a', status = 'completed') => ({ threadId, turn: { id, status } });

test('background completion badges count unique turns across conversations and clear on return', () => {
  const page = fakePage(), notice = createCompletionNotice(page);
  notice.complete(done('already-read'));
  assert.equal(page.title, '工作区');
  page.visibilityState = 'hidden';
  notice.complete(done('already-read'));
  assert.equal(page.title, '工作区');
  notice.complete(done('one')); notice.complete(done('one')); notice.complete(done('two', 'thread-b'));
  assert.equal(page.title, '（2）工作已完成 · 工作区');
  assert.match(decodeURIComponent(page.icon.getAttribute('href')), /<circle.*fill="#e5484d"/);
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.title, '（2）工作已完成 · 工作区');
  page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(page.title, '工作区'); assert.equal(page.icon.getAttribute('href'), 'original-icon.svg');
  page.visibilityState = 'hidden'; notice.complete(done('three'));
  assert.equal(page.title, '（1）工作已完成 · 工作区');
  notice.dispose(); assert.equal(page.title, '工作区');
});

test('unfocused windows get a badge, failed/interrupted turns do not, cleanup removes listeners', () => {
  const page = fakePage(), notice = createCompletionNotice(page);
  page.focused = false;
  notice.complete(done('failure', 'thread-a', 'failed')); notice.complete(done('stop', 'thread-a', 'interrupted')); notice.complete({});
  assert.equal(page.title, '工作区');
  for (let i = 0; i < 12; i++) notice.complete(done(String(i)));
  assert.match(decodeURIComponent(page.icon.getAttribute('href')), />9\+<\/text>/);
  page.focused = true; page.defaultView.dispatchEvent(new Event('focus'));
  assert.equal(page.title, '工作区');
  notice.dispose(); page.title = '新页面'; page.dispatchEvent(new Event('visibilitychange')); page.defaultView.dispatchEvent(new Event('focus'));
  assert.equal(page.title, '新页面');
});

test('link labels use actual registrable domains, including multi-part and private suffixes', () => {
  assert.deepEqual(websiteInfo('https://docs.example.co.uk/path'), { hostname: 'docs.example.co.uk', domain: 'example.co.uk' });
  assert.equal(websiteInfo('https://docs.openai.com:443/path').domain, 'openai.com');
  assert.equal(websiteInfo('//www.example.com/path').domain, 'example.com');
  assert.equal(websiteInfo('https://app.team.github.io/').domain, 'team.github.io');
  assert.equal(websiteInfo('https://openai.com.evil.example/').domain, 'evil.example');
  assert.equal(websiteInfo('http://127.0.0.1:3108').domain, '127.0.0.1');
  assert.equal(websiteInfo('http://[::1]:3108').domain, '[::1]');
  assert.equal(websiteInfo('http://localhost:3108').domain, 'localhost');
  for (const url of ['javascript:alert(1)', 'mailto:test@example.com', 'src/main.jsx:2', '/api/file', '#heading', 'https://', undefined]) assert.equal(websiteInfo(url), null);
  for (const path of ['preview.js:1', 'src/main.jsx:42:3', '/workspace/src/test.js:5#L5']) assert.equal(isFileLineLink(path), true);
  for (const url of ['javascript:1', 'javascript:/fake.js:1', 'https://example.com/file.js:1', 'mailto:user.js:1', 'data:text.js:1', undefined]) assert.equal(isFileLineLink(url), false);
});
