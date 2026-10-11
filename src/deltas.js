export function applyDeltas(turns, events) {
  const updates = new Map();
  for (const { method, params: p } of events) {
    if (!p?.turnId || !p?.itemId || !p.delta) continue;
    const field = method === 'item/agentMessage/delta' ? 'text' : method === 'item/commandExecution/outputDelta' ? 'aggregatedOutput' : 'streamedReasoning';
    const key = `${p.turnId}/${p.itemId}`;
    const item = updates.get(key) || {}; item[field] = (item[field] || '') + p.delta; updates.set(key, item);
  }
  return turns.map(turn => {
    let changed = false;
    const items = turn.items.map(item => {
      const update = updates.get(`${turn.id}/${item.id}`); if (!update) return item;
      changed = true; return { ...item, ...Object.fromEntries(Object.entries(update).map(([key, delta]) => [key, (item[key] || '') + delta])) };
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
      const p = event.params, key = `${event.method}/${p.turnId}/${p.itemId}`;
      const old = queue.get(key);
      queue.set(key, old ? { ...old, params: { ...old.params, delta: old.params.delta + (p.delta || '') } } : event);
      if (timer == null) timer = timers.setTimeout(() => flush(), delay);
    }, flush,
    clear() { if (timer != null) timers.clearTimeout(timer); timer = null; queue.clear(); }
  };
}
