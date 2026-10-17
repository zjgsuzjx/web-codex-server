import { signalLevel } from '../shared/connection.js';

const states = {
  connecting: { title: '正在连接服务器', description: '正在建立连接，请稍候。' },
  reconnecting: { title: '正在重新连接', description: '正在尝试恢复与服务器的连接。' },
  disconnected: { title: '连接已断开', description: '暂时无法连接服务器，将自动重试。' },
  expired: { title: '登录已过期', description: '请重新登录以恢复连接。' },
};

export function connectionIndicator(status, latency) {
  if (status !== 'connected') {
    const state = Object.hasOwn(states, status) ? status : 'disconnected';
    return { state, level: 0, ...states[state], announcement: states[state].title };
  }
  const announcement = '已连接服务器';
  if (latency == null) return { state: 'measuring', level: 0, title: '已连接 · 正在测量延迟', description: '连接已建立，正在测量与服务器的往返延迟。', announcement };
  if (!Number.isFinite(latency)) return { state: 'timeout', level: 0, title: '已连接 · 延迟测量超时', description: '连接仍在，暂时无法测得往返延迟。', announcement };
  const level = signalLevel(latency);
  return { state: 'connected', level, title: `已连接 · ${latency} ms`, description: `网络延迟${level === 3 ? '低' : level === 2 ? '中等' : '高'} · 与服务器的往返延迟，每分钟更新。`, announcement };
}
