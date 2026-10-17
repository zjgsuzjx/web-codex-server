import Tooltip from './Tooltip';
import { signalLevel } from '../shared/connection.js';

export default function ConnectionSignal({ status, latency }) {
  const level = status === 'connected' ? signalLevel(latency) : 0;
  const connection = status === 'connected' ? '已连接' : status === 'connecting' ? '连接中' : '正在重连';
  const title = status !== 'connected' ? '等待连接' : latency == null ? '正在测量延迟…' : Number.isFinite(latency) ? `${latency}ms` : '延迟测量超时';
  return <Tooltip title={`${connection} · ${title}`} description="与服务器的往返延迟 · 已连接时每分钟更新">
    <button type="button" className={`connection-signal signal-${level}`} aria-label={`${connection}，服务器信号：${title}`}>
      <svg className="signal-glyph" width="19" height="17" viewBox="0 0 24 20" aria-hidden="true">
        {[6, 10, 14].map((height, index) => <rect key={height} className={`signal-bar ${index < level ? 'filled' : ''}`} x={3 + index * 6.5} y={17 - height} width="4.5" height={height} rx="1.25"/>) }
      </svg>
      <span className="connection-label" role="status">{connection}</span>
    </button>
  </Tooltip>;
}
