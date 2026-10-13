import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createTurnActivity } from '../server/turn-activity.js';
import { currentThought } from '../shared/thinking.js';
import { elapsedTime, formatDuration, mergeActivity } from '../shared/turn-activity.js';
import { applyDeltas, applyLifecycle, mergeTurns } from '../src/deltas.js';

test('live direction follows indexed summaries and public progress, without using raw reasoning', () => {
  let turns = [{ id: 'turn', status: 'inProgress', items: [] }];
  turns = applyDeltas(turns, [
    { method: 'item/reasoning/summaryTextDelta', params: { turnId: 'turn', itemId: 'r', summaryIndex: 0, delta: '**检查界面**\n\n读取当前布局。' } },
    { method: 'item/reasoning/textDelta', params: { turnId: 'turn', itemId: 'r', contentIndex: 0, delta: 'raw content must not become the status' } }
  ]);
  assert.equal(currentThought(turns[0]), '检查界面 · 读取当前布局。');
  turns = applyLifecycle(turns, { method: 'item/started', params: { turnId: 'turn', item: { id: 'r', type: 'reasoning', summary: ['检查界面'] } } });
  turns = applyDeltas(turns, [{ method: 'item/reasoning/summaryTextDelta', params: { turnId: 'turn', itemId: 'r', summaryIndex: 1, delta: '**验证计时**\n\n检查刷新后的状态。' } }]);
  assert.equal(currentThought(turns[0]), '验证计时 · 检查刷新后的状态。');
  turns = applyLifecycle(turns, { method: 'item/completed', params: { turnId: 'turn', item: { id: 'r', type: 'reasoning', summary: ['检查界面', '**完成验证**\n\n所有检查通过。'] } } });
  assert.equal(currentThought(turns[0]), '完成验证 · 所有检查通过。');
  turns = applyLifecycle(turns, { method: 'item/started', params: { turnId: 'turn', item: { id: 'cmd', type: 'commandExecution', status: 'inProgress', command: 'npm test' } } });
  assert.equal(currentThought(turns[0]), '正在运行命令：npm test');
  turns = applyLifecycle(turns, { method: 'item/completed', params: { turnId: 'turn', item: { id: 'msg', type: 'agentMessage', phase: 'commentary', text: '正在核对最后一项检查。' } } });
  assert.equal(currentThought(turns[0]), '正在核对最后一项检查。');
  assert.equal(currentThought({ items: [{ type: 'reasoning', content: ['raw only'] }] }), '正在梳理任务与下一步方向');
  assert.equal(currentThought({ plan: [{ step: '检查数据来源', status: 'inProgress' }] }), '检查数据来源');
});

test('completion freezes elapsed time and delayed snapshots cannot restart either clock or sidebar', () => {
  const running = { id: 'one', status: 'inProgress', timing: { startedAt: 1000, completedAt: null }, items: [] };
  let turns = mergeTurns([], [running]);
  const completed = { id: 'one', status: 'completed', timing: { startedAt: 1000, completedAt: 61200 } };
  turns = mergeTurns(turns, [completed, running]);
  assert.equal(turns[0].status, 'completed');
  assert.equal(elapsedTime(turns[0].timing, 900000), 60200);
  const interrupted = { ...completed, status: 'interrupted' };
  assert.equal(applyLifecycle([interrupted], { method: 'turn/changes/updated', params: { turnId: 'one', changes: { status: 'failed', revision: 2 } } })[0].status, 'interrupted');
  let activity = mergeActivity({}, [{ threadId: 'a', turn: running }, { threadId: 'b', turn: { ...running, id: 'two' } }]);
  activity = mergeActivity(activity, [{ threadId: 'a', turn: completed }, { threadId: 'a', turn: running }]);
  assert.equal(activity.a.status, 'completed'); assert.equal(activity.b.status, 'inProgress');
  activity = mergeActivity(activity, [{ threadId: 'a', turn: { ...running, id: 'next', timing: { startedAt: 70000 } } }, { threadId: 'a', turn: completed }]);
  assert.equal(activity.a.id, 'next');
  assert.equal(formatDuration(0), '0 秒'); assert.equal(formatDuration(60200), '1 分 0 秒');
  assert.equal(formatDuration(3661000), '1 小时 1 分 1 秒'); assert.equal(elapsedTime(null), null);
});

test('turn timing persists, stays user scoped, copies completed forks, and stops on lost process', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-turn-clock-'));
  let store = createStore(dir), now = 1000;
  try {
    for (const uid of ['alice', 'bob']) {
      store.run('INSERT INTO users(id,username,password,created) VALUES(?,?,?,?)', uid, uid, 'synthetic', now);
      store.run('INSERT INTO projects(id,user_id,name,created) VALUES(?,?,?,?)', uid, uid, 'synthetic', now);
      store.run('INSERT INTO threads(id,user_id,project_id,title,created) VALUES(?,?,?,?,?)', uid, uid, uid, 'synthetic', now);
    }
    const clock = createTurnActivity(store, () => now), alice = { id: 'alice' }, bob = { id: 'bob' };
    clock.observe(alice, { id: 'a', status: 'inProgress' }); now = 2000;
    clock.observe(alice, { id: 'a', status: 'inProgress' });
    clock.observe(bob, { id: 'b', status: 'inProgress' });
    assert.equal(clock.active('alice').length, 1); assert.equal(clock.active('alice')[0].turn.id, 'a');
    assert.equal(clock.active('alice')[0].turn.timing.startedAt, 1000);
    assert.equal(clock.decorate(alice, { id: 'legacy', status: 'completed' }).timing, undefined);
    assert.equal(clock.decorate(alice, { id: 'legacy-active', status: 'inProgress' }).timing, undefined);
    now = 6500; clock.observe(alice, { id: 'a', status: 'completed' }); now = 8500;
    clock.observe(alice, { id: 'a', status: 'inProgress' }); clock.observe(alice, { id: 'a', status: 'completed' });
    assert.equal(clock.active('alice').length, 0);
    assert.deepEqual(clock.decorate(alice, { id: 'a', status: 'inProgress' }), { id: 'a', status: 'completed', timing: { startedAt: 1000, completedAt: 6500 } });
    store.run('INSERT INTO threads(id,user_id,project_id,title,created) VALUES(?,?,?,?,?)', 'fork', 'alice', 'alice', 'fork', now);
    clock.fork('alice', 'fork'); assert.equal(clock.decorate({ id: 'fork' }, { id: 'a', status: 'completed' }).timing.completedAt, 6500);
    const stopped = clock.disconnect('bob'); assert.equal(stopped[0].turn.status, 'interrupted');
    assert.equal(stopped[0].turn.timing.completedAt, 8500); assert.equal(clock.active('bob').length, 0);
    clock.observe(alice, { id: 'crashed', status: 'inProgress' });
    store.db.close(); store = createStore(dir); now = 10000;
    const reopened = createTurnActivity(store, () => now);
    assert.equal(reopened.active('alice').length, 0);
    assert.deepEqual(reopened.decorate(alice, { id: 'a', status: 'completed' }).timing, { startedAt: 1000, completedAt: 6500 });
    const crashed = reopened.decorate(alice, { id: 'crashed', status: 'inProgress' });
    assert.equal(crashed.status, 'interrupted'); assert.equal(crashed.timing.completedAt, null);
    assert.equal(reopened.decorate(alice, { id: 'crashed', status: 'completed' }).status, 'completed');
  } finally { store.db.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
