import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionIndicator } from '../src/connection-state.js';

test('transport states override stale latency and remain distinct from one another', () => {
  for (const state of ['connecting', 'reconnecting', 'disconnected', 'expired']) {
    for (const latency of [null, 12, 900, Infinity]) {
      const view = connectionIndicator(state, latency);
      assert.equal(view.state, state);
      assert.equal(view.level, 0);
      assert.ok(view.title && view.description && view.announcement);
    }
  }
  assert.equal(connectionIndicator('unknown', 12).state, 'disconnected');
});

test('an established connection distinguishes measuring, timeout and latency levels', () => {
  for (const latency of [null, undefined]) assert.equal(connectionIndicator('connected', latency).state, 'measuring');
  for (const latency of [Infinity, NaN]) {
    const view = connectionIndicator('connected', latency);
    assert.equal(view.state, 'timeout');
    assert.equal(view.level, 0);
    assert.equal(view.announcement, '已连接服务器');
  }
  for (const [latency, level] of [[1, 3], [149, 3], [150, 2], [499, 2], [500, 1], [3000, 1]]) {
    const view = connectionIndicator('connected', latency);
    assert.equal(view.state, 'connected');
    assert.equal(view.level, level);
    assert.match(view.title, new RegExp(`${latency} ms`));
    assert.equal(view.announcement, '已连接服务器');
  }
});
