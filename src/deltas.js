import { mergeTiming } from '../shared/turn-activity.js';

// Lifecycle notifications contain partial snapshots. Never replace the item list.
export function mergeItem(previous = {}, incoming = {}) {
  const item = { ...previous, ...incoming };
  for (const field of ['text', 'aggregatedOutput', 'streamedReasoning', 'streamedReasoningContent', 'imageUrl', 'savedPath']) {
    if (previous[field] && (!incoming[field] || previous[field].startsWith(incoming[field]) && previous[field].length > incoming[field].length)) item[field] = previous[field];
  }
  for (const field of ['content', 'summary', 'attachments', 'contentItems']) {
    if (!incoming[field]?.length && previous[field]?.length) item[field] = previous[field];
  }
  if (previous.status && previous.status !== 'inProgress' && incoming.status === 'inProgress') item.status = previous.status;
  return item;
}
export function mergeTurn(previous = {}, incoming = {}) {
  const items = [...(previous.items || [])];
  for (const item of incoming.items || []) {
    const index = items.findIndex(x => x.id === item.id);
    if (index < 0) items.push(item); else items[index] = mergeItem(items[index], item);
  }
  // A delayed start response must not resurrect a completed turn.
  const status = previous.status && previous.status !== 'inProgress' && incoming.status === 'inProgress' ? previous.status : incoming.status || previous.status;
  const changes = previous.changes && (!incoming.changes || previous.changes.revision > incoming.changes.revision) ? previous.changes : incoming.changes;
  const timing = mergeTiming(previous.timing, incoming.timing);
  return { ...previous, ...incoming, status, items, ...(changes ? { changes } : {}), ...(timing ? { timing } : {}) };
}
export function mergeTurns(previous, incoming) {
  const turns = [...previous];
  for (const turn of incoming) {
    const index = turns.findIndex(x => x.id === turn.id);
    if (index < 0) turns.push(mergeTurn({}, turn)); else turns[index] = mergeTurn(turns[index], turn);
  }
  return turns;
}
export function applyLifecycle(turns, event) {
  const p = event.params || {};
  if (event.method === 'turn/changes/updated') return mergeTurns(turns, [{ id: p.turnId, status: turns.find(turn => turn.id === p.turnId)?.status || p.changes.status, changes: p.changes }]);
  if (event.method === 'turn/plan/updated') return mergeTurns(turns, [{ id: p.turnId, status: 'inProgress', plan: p.plan }]);
  if (event.method === 'turn/started' || event.method === 'turn/completed') return mergeTurns(turns, [p.turn]);
  if (event.method === 'item/started' || event.method === 'item/completed') return mergeTurns(turns, [{ id: p.turnId, status: 'inProgress', items: [p.item] }]);
  return turns;
}
export function applyDeltas(turns, events) {
  const updates = new Map();
  for (const { method, params: p } of events) {
    if (!p?.turnId || !p?.itemId || !p.delta) continue;
    const field = method === 'item/agentMessage/delta' ? 'text' : method === 'item/commandExecution/outputDelta' ? 'aggregatedOutput' : method === 'item/reasoning/textDelta' ? 'streamedReasoningContent' : 'streamedReasoning';
    const key = `${p.turnId}/${p.itemId}`;
    const item = updates.get(key) || {}; item[field] = (item[field] || '') + p.delta;
    const parts = method === 'item/reasoning/summaryTextDelta' ? 'streamedSummaryParts' : method === 'item/reasoning/textDelta' ? 'streamedContentParts' : null;
    if (parts) {
      const index = p.summaryIndex ?? p.contentIndex ?? 0;
      if (Number.isInteger(index) && index >= 0 && index < 1000) { item[parts] ||= []; item[parts][index] = (item[parts][index] || '') + p.delta; }
    }
    updates.set(key, item);
  }
  // Deltas can arrive before item/started (or after reconnect).
  for (const { method, params: p } of events) {
    if (!p?.turnId || !p?.itemId || !p.delta) continue;
    if (!turns.some(t => t.id === p.turnId && t.items?.some(i => i.id === p.itemId))) {
      const type = method === 'item/agentMessage/delta' ? 'agentMessage' : method === 'item/commandExecution/outputDelta' ? 'commandExecution' : 'reasoning';
      turns = mergeTurns(turns, [{ id: p.turnId, status: 'inProgress', items: [{ id: p.itemId, type }] }]);
    }
  }
  return turns.map(turn => {
    let changed = false;
    const items = turn.items.map(item => {
      const update = updates.get(`${turn.id}/${item.id}`); if (!update) return item;
      changed = true; return { ...item, ...Object.fromEntries(Object.entries(update).map(([key, delta]) => {
        if (!Array.isArray(delta)) return [key, (item[key] || '') + delta];
        const parts = [...(item[key] || [])]; delta.forEach((text, index) => { parts[index] = (parts[index] || '') + text; }); return [key, parts];
      })) };
    });
    return changed ? { ...turn, items } : turn;
  });
}
export function createDeltaBuffer(deliver, delay = 50, timers = globalThis) {
  const queue = new Map(); let timer;
  function flush(urgent = false) {
    if (timer != null) timers.clearTimeout(timer); timer = null;
    if (!queue.size) return;
    const events = [...queue.values()]; queue.clear(); deliver(events, urgent);
  }
  return {
    push(event) {
      const p = event.params, key = `${event.method}/${p.turnId}/${p.itemId}/${p.summaryIndex ?? p.contentIndex ?? ''}`;
      const old = queue.get(key);
      queue.set(key, old ? { ...old, params: { ...old.params, delta: old.params.delta + (p.delta || '') } } : event);
      if (timer == null) timer = timers.setTimeout(() => flush(), delay);
    }, flush,
    clear() { if (timer != null) timers.clearTimeout(timer); timer = null; queue.clear(); }
  };
}
