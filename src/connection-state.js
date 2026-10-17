import { connectionQuality } from '../shared/connection.js';

const states = {
  connecting: { title: '正在连接服务器', heading: '正在连接…', quality: 'pending', description: '正在建立与服务器的连接。' },
  reconnecting: { title: '正在重新连接', heading: '正在重新连接…', quality: 'mid', description: '正在尝试恢复连接，请稍候。' },
  disconnected: { title: '连接已断开', heading: '连接已断开', quality: 'bad', description: '将自动重试，也可点击立即重连。' },
  expired: { title: '登录已过期', heading: '登录已过期', quality: 'bad', description: '请重新登录以恢复连接。' },
};

export function connectionIndicator(status, latency) {
  if (status !== 'connected') {
    const state = Object.hasOwn(states, status) ? status : 'disconnected';
    return { state, level: 0, ...states[state], announcement: states[state].title };
  }
  const announcement = '已连接服务器';
  if (latency == null) return { state: 'measuring', level: 0, quality: 'pending', heading: '已连接', title: '已连接 · 正在测量延迟', description: '正在测量往返延迟…', announcement };
  const tier = connectionQuality(latency);
  if (!tier) return { state: 'timeout', level: 0, quality: 'mid', heading: '已连接', title: '已连接 · 延迟测量超时', description: '延迟测量超时，连接仍保持。', announcement };
  return { state: 'connected', level: tier.level, quality: tier.quality, qualityLabel: tier.label, latency, heading: '已连接', title: `已连接 · ${latency} ms · ${tier.label}`, description: '与服务器的往返延迟，每分钟更新。', announcement };
}
