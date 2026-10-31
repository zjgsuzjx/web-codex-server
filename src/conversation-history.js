import { mergeTurn } from './deltas.js';

// HTTP history pages are chronological, even when fetched from newest to oldest.
// Keep live snapshots authoritative and prepend only genuinely older turns.
export function mergeHistoryPage(previous, incoming, prepend = false) {
  const existing = new Set(previous.map(turn => turn.id));
  const updates = new Map(incoming.map(turn => [turn.id, turn]));
  const merged = previous.map(turn => updates.has(turn.id) ? mergeTurn(turn, updates.get(turn.id)) : turn);
  const added = incoming.filter(turn => !existing.has(turn.id));
  return prepend ? [...added, ...merged] : [...merged, ...added];
}

export function historyPause(signal, delay = 100) {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, delay);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}
