import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsQueue } from '../shared/settings-save.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('settings respond immediately and serialize/coalesce edits during slow saves', async () => {
  const first = deferred(), second = deferred(), calls = [], pending = [];
  let shown;
  const initial = { model: 'a', effort: 'medium', mode: 'default' };
  const queue = createSettingsQueue(initial, {
    save: next => { calls.push(next); return calls.length === 1 ? first.promise : second.promise; },
    onChange: next => { shown = next; }, onPending: value => pending.push(value), onError: assert.fail
  });
  queue.update({ ...initial, model: 'b' });
  assert.equal(shown.model, 'b');
  queue.update({ ...shown, effort: 'high' });
  queue.update({ ...shown, effort: 'xhigh', mode: 'plan' });
  queue.sync(initial); // A stale parent response must not reset newer input.
  assert.deepEqual(shown, { model: 'b', effort: 'xhigh', mode: 'plan' });
  assert.equal(calls.length, 1);
  first.resolve({ ...calls[0], normalized: true }); await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { model: 'b', effort: 'xhigh', mode: 'plan', normalized: true });
  assert.deepEqual(shown, calls[1]);
  second.resolve(calls[1]); await tick();
  assert.deepEqual(pending, [true, false]);
});

test('failed settings roll back while later edits still save against confirmed values', async () => {
  const first = deferred(), next = deferred(), calls = [], errors = [];
  let shown;
  const initial = { networkAccess: true, effort: 'medium' };
  const queue = createSettingsQueue(initial, {
    save: value => { calls.push(value); return calls.length === 1 ? first.promise : next.promise; },
    onChange: value => { shown = value; }, onPending() {}, onError: error => errors.push(error.message)
  });
  const failed = queue.update({ ...initial, networkAccess: false });
  const rejection = assert.rejects(failed, /请先关闭终端/);
  queue.update({ ...shown, effort: 'high' });
  first.reject(new Error('请先关闭终端')); await tick();
  assert.deepEqual(calls[1], { networkAccess: true, effort: 'high' });
  assert.deepEqual(shown, calls[1]);
  next.resolve(calls[1]); await tick();
  await rejection;
  assert.deepEqual(errors, ['请先关闭终端']);
});

test('shared settings drafts survive reopening and combine edits from stale callers', async () => {
  const first = deferred(), second = deferred(), calls = [];
  const initial = { model: 'a', effort: 'medium', mode: 'default' };
  const queue = createSettingsQueue(initial, { save: next => { calls.push(next); return calls.length === 1 ? first.promise : second.promise; } });
  let renders = 0;
  const unsubscribe = queue.subscribe(() => renders++);
  const one = queue.update({ ...initial, effort: 'high' });
  unsubscribe(); const before = renders;
  const two = queue.update({ ...initial, mode: 'plan' }, initial);
  assert.deepEqual(queue.getSnapshot().value, { ...initial, effort: 'high', mode: 'plan' });
  assert.equal(queue.getSnapshot().pending, true);
  assert.equal(renders, before);
  first.resolve(calls[0]); await tick();
  second.resolve(calls[1]); await Promise.all([one, two]); await tick();
  assert.deepEqual(queue.getSnapshot().value, { ...initial, effort: 'high', mode: 'plan' });
  assert.equal(queue.getSnapshot().pending, false);
});

test('unchanged selections do not save and idle queues accept refreshed settings', async () => {
  const initial = { model: 'a', effort: 'medium' }, calls = [];
  let shown;
  const queue = createSettingsQueue(initial, {
    save: async value => { calls.push(value); return value; },
    onChange: value => { shown = value; }, onPending() {}, onError: assert.fail
  });
  queue.update(initial); assert.equal(calls.length, 0);
  queue.sync({ ...initial, model: 'b' });
  assert.equal(shown.model, 'b');
  queue.update({ ...shown, effort: 'high' }); await tick();
  assert.deepEqual(calls, [{ model: 'b', effort: 'high' }]);
});
