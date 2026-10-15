import fs from 'node:fs/promises';
import os from 'node:os';
import { mergeQuota } from '../shared/usage.js';
import { storageLimit } from '../shared/storage.js';

export function createResources(config, codex, used) {
  const quotaCache = new Map(), pending = new Map(), storageCache = new Map();
  let machineCache;
  async function machine() {
    if (machineCache && Date.now() - machineCache.updatedAt < 10000) return machineCache;
    const stat = await fs.statfs(config.dataDir);
    let totalMemory = os.totalmem(), availableMemory = os.freemem();
    try {
      const text = await fs.readFile('/proc/meminfo', 'utf8');
      const total = text.match(/^MemTotal:\s+(\d+)/m), available = text.match(/^MemAvailable:\s+(\d+)/m);
      if (total && available) { totalMemory = Number(total[1]) * 1024; availableMemory = Number(available[1]) * 1024; }
    } catch {}
    machineCache = { disk: { total: stat.blocks * stat.bsize, available: stat.bavail * stat.bsize, used: (stat.blocks - stat.bfree) * stat.bsize },
      memory: { total: totalMemory, available: availableMemory }, updatedAt: Date.now() };
    return machineCache;
  }
  async function quota(user, force = false) {
    const cached = quotaCache.get(user.id);
    if (!force && cached && Date.now() - cached.checkedAt < 30000) return cached;
    if (pending.has(user.id)) return pending.get(user.id);
    const request = (async () => {
      try {
        const account = await codex.call(user, 'account/read', { refreshToken: false }, 8000);
        if (!account.account && account.requiresOpenaiAuth) return { status: 'unauthenticated', message: '登录 ChatGPT 后查看额度', updatedAt: null };
        if (account.account?.type !== 'chatgpt') return { status: 'unsupported', message: 'API Key / 自定义服务商未提供此额度', updatedAt: null };
        const snapshot = await codex.call(user, 'account/rateLimits/read', {}, 8000);
        return { status: 'available', snapshot, updatedAt: Date.now() };
      } catch {
        return cached?.snapshot ? { ...cached, stale: true, message: '暂时无法刷新，显示上次数据' }
          : { status: 'unavailable', message: '额度暂不可用，稍后重试', updatedAt: null };
      }
    })().then(value => { const result = { ...value, checkedAt: Date.now() }; quotaCache.set(user.id, result); return result; }).finally(() => pending.delete(user.id));
    pending.set(user.id, request); return request;
  }
  return {
    invalidateStorage(id) { storageCache.delete(id); },
    readCodex: quota,
    observe(id, event) {
      if (event.method === 'account/updated' || event.method === 'account/login/completed') quotaCache.delete(id);
      if (event.method === 'account/rateLimits/updated') {
        const previous = quotaCache.get(id);
        // A push can be incomplete; fetch a complete snapshot when none exists.
        if (previous?.snapshot) quotaCache.set(id, { status: 'available', snapshot: mergeQuota(previous.snapshot, event.params), updatedAt: Date.now(), checkedAt: Date.now() });
      }
    },
    async read(user) {
      let storage = storageCache.get(user.id);
      const limit = storageLimit(user, config.quota);
      if (!storage || storage.quota !== limit || Date.now() - storage.updatedAt > 30000) {
        const bytes = await used(user); storage = { used: bytes, available: limit == null ? null : Math.max(0, limit - bytes), quota: limit, maxFile: config.maxFile, updatedAt: Date.now() };
        storageCache.set(user.id, storage);
      }
      const server = await machine();
      return { storage, server, codex: quotaCache.get(user.id) || { status: 'loading' } };
    }
  };
}
