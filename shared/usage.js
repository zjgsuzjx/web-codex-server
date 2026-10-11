export function remainingPercent(window) {
  return typeof window?.usedPercent === 'number' && Number.isFinite(window.usedPercent)
    ? Math.max(0, Math.min(100, 100 - window.usedPercent)) : null;
}
export function quotaBuckets(snapshot) {
  const buckets = snapshot?.rateLimitsByLimitId;
  return buckets && Object.keys(buckets).length ? Object.entries(buckets).map(([id, value]) => ({ ...value, limitId: value.limitId || id }))
    : snapshot?.rateLimits ? [snapshot.rateLimits] : [];
}
// Notifications are sparse: null account metadata does not erase a known value.
export function mergeQuota(snapshot, update) {
  if (!update?.rateLimits) return snapshot;
  const incoming = update.rateLimits, id = incoming.limitId || snapshot?.rateLimits?.limitId || 'codex';
  const previous = snapshot?.rateLimitsByLimitId?.[id] || (snapshot?.rateLimits?.limitId === id ? snapshot.rateLimits : null) || {};
  const merged = { ...previous, ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value != null)), limitId: id };
  for (const key of ['primary','secondary','credits']) if (incoming[key]) merged[key] = { ...previous[key], ...Object.fromEntries(Object.entries(incoming[key]).filter(([, value]) => value != null)) };
  return { ...snapshot, rateLimits: !snapshot?.rateLimits || snapshot.rateLimits.limitId === id ? merged : snapshot.rateLimits,
    rateLimitsByLimitId: { ...snapshot?.rateLimitsByLimitId, [id]: merged } };
}
export function formatBytes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '暂不可用';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']; let n = Math.max(0, value), i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${i ? n.toFixed(i >= 3 ? 2 : 1) : n} ${units[i]}`;
}
export function windowLabel(minutes, fallback = '额度窗口') {
  if (typeof minutes !== 'number' || minutes <= 0) return fallback;
  if (minutes % 10080 === 0) return `${minutes / 10080} 周窗口`;
  if (minutes % 1440 === 0) return `${minutes / 1440} 天窗口`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时窗口`;
  return `${minutes} 分钟窗口`;
}
