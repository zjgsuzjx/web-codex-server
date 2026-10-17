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
  for (const latency of [Infinity, NaN, -1, '42']) {
    const view = connectionIndicator('connected', latency);
    assert.equal(view.state, 'timeout');
    assert.equal(view.level, 0);
    assert.equal(view.announcement, '已连接服务器');
  }
  for (const [latency, level, label] of [[0, 4, '极佳'], [80, 4, '极佳'], [81, 3, '良好'], [150, 3, '良好'], [151, 2, '一般'], [300, 2, '一般'], [301, 1, '较差'], [3000, 1, '较差']]) {
    const view = connectionIndicator('connected', latency);
    assert.equal(view.state, 'connected');
    assert.equal(view.level, level);
    assert.equal(view.qualityLabel, label);
    assert.equal(view.latency, latency);
    assert.match(view.title, new RegExp(`${latency} ms`));
    assert.equal(view.announcement, '已连接服务器');
  }
});

test('hover details explain transport failures without claiming a healthy or disconnected measurement', () => {
  for (const state of ['connecting', 'reconnecting', 'disconnected', 'expired']) {
    const view = connectionIndicator(state, 42);
    assert.ok(view.heading);
    assert.equal(view.latency, undefined);
    assert.equal(view.qualityLabel, undefined);
  }
  assert.match(connectionIndicator('disconnected', 42).description, /自动重试.*点击/);
  assert.match(connectionIndicator('expired', 42).description, /重新登录/);
  for (const latency of [null, Infinity]) assert.equal(connectionIndicator('connected', latency).heading, '已连接');
});
