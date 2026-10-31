import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistoryPage, historyPause } from '../src/conversation-history.js';
import { CodexManager } from '../server/codex.js';

const turn = (id, text = id, status = 'completed') => ({ id, status, items: [{ id: `${id}-answer`, type: 'agentMessage', text }] });

test('initial recent history goes before a live turn and older pages keep chronological order', () => {
  const live = turn('live');
  let turns = mergeHistoryPage([live], [turn('recent-1'), turn('recent-2')], true);
  assert.deepEqual(turns.map(t => t.id), ['recent-1', 'recent-2', 'live']);
  assert.equal(turns.at(-1), live);
  turns = mergeHistoryPage(turns, [turn('old-1'), turn('old-2'), turn('recent-1')], true);
  assert.deepEqual(turns.map(t => t.id), ['old-1', 'old-2', 'recent-1', 'recent-2', 'live']);
  turns = mergeHistoryPage(turns, [turn('live'), turn('new-live')]);
  assert.deepEqual(turns.map(t => t.id), ['old-1', 'old-2', 'recent-1', 'recent-2', 'live', 'new-live']);
});

test('delayed overlapping pages cannot duplicate or regress completed live turns', () => {
  const live = turn('live', 'Complete answer');
  const result = mergeHistoryPage([live], [turn('old'), turn('live', 'Complete', 'inProgress')], true);
  assert.equal(result.length, 2);
  assert.equal(result[1].status, 'completed');
  assert.equal(result[1].items[0].text, 'Complete answer');
});

test('cancelling a background page pause settles immediately', async () => {
  const controller = new AbortController();
  const pending = historyPause(controller.signal, 60000);
  controller.abort(); await pending;
  await historyPause(controller.signal, 60000);
});

test('resuming subscribes to a thread without hydrating its full history', async () => {
  const user = { id: 'user', username: 'alice', role: 'user', settings: '{}' };
  const manager = new CodexManager({ hostDataDir: '/app/data' }, () => {}), inst = { loaded: new Set() }, calls = [];
  manager.ensure = async () => inst;
  manager.raw = async (_, method, params) => { calls.push({ method, params }); return {}; };
  await manager.resume(user, { id: 'thread', project_id: 'project' }, { model: 'model' });
  await manager.resume(user, { id: 'thread', project_id: 'project' }, {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.excludeTurns, true);
  assert.equal(calls[0].params.model, 'model');
});
