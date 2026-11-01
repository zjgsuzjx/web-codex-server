import type { ProtocolRecord } from '../contracts/protocol.ts';
export const GiB = 1024 ** 3;
export function storageLimit(user: { role: string }, override: number | null | undefined) {
  // Explicit createApp overrides are reserved for isolated tests, never env vars.
  if (override != null) return override;
  return user.role === 'superadmin' ? null : user.role === 'admin' ? 5 * GiB : GiB;
}
export function storagePressure(data: ProtocolRecord | null | undefined) {
  const own = data?.storage,
    disk = data?.server?.disk;
  const quota = own?.quota > 0 ? own.used / own.quota : 0;
  const machine = disk?.total > 0 ? (disk.total - disk.available) / disk.total : 0;
  const ratio = Math.max(quota, machine);
  return {
    ratio,
    level: ratio >= 1 ? 'full' : ratio >= 0.9 ? 'warning' : 'normal',
    source: quota >= machine ? '个人存储' : '服务器磁盘',
  };
}
export function topPaths(paths: string[]) {
  return [...new Set(paths)]
    .sort()
    .filter((p, i, all) => !all.some((parent, j) => j !== i && p.startsWith(parent + '/')));
}
