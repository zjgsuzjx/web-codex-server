export const isRunning = turn => turn?.status === 'inProgress';

// Partial and delayed snapshots must preserve the original clock and its stop time.
export function mergeTiming(previous, incoming) {
  if (!previous) return incoming;
  if (!incoming) return previous;
  return {
    startedAt: previous.startedAt ?? incoming.startedAt,
    completedAt: previous.completedAt ?? incoming.completedAt ?? null
  };
}

export function mergeActivity(previous = {}, entries = []) {
  const next = { ...previous };
  for (const { threadId, turn } of entries) {
    if (!threadId || !turn?.id) continue;
    const old = next[threadId];
    if (old?.id === turn.id) {
      next[threadId] = { ...old, ...turn, timing: mergeTiming(old.timing, turn.timing), status: !isRunning(old) && isRunning(turn) ? old.status : turn.status };
    } else if (!old || (turn.timing?.startedAt ?? 0) >= (old.timing?.startedAt ?? 0)) next[threadId] = turn;
  }
  return next;
}

export function elapsedTime(timing, now = Date.now()) {
  if (!Number.isFinite(timing?.startedAt)) return null;
  return Math.max(0, (timing.completedAt ?? now) - timing.startedAt);
}

export function formatDuration(milliseconds) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分 ${seconds % 60} 秒`;
}
