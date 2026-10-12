import { contextUsage } from '../shared/context';
import Tooltip from './Tooltip';
export default function ContextUsage({ usage }) {
  const { used, limit, percent } = contextUsage(usage);
  const number = n => n == null ? '暂不可用' : `${new Intl.NumberFormat('zh-CN').format(n)} tokens`;
  const ratio = percent == null ? '等待统计' : `${Number(percent.toFixed(1))}%`;
  const value = percent == null ? 0 : Math.min(100, percent);
  const description = <span className="context-tooltip"><span>已使用：{used == null ? '等待统计' : number(used)}</span><span>上下文上限：{number(limit)}</span><span>使用比例：{ratio}</span><span className="context-tooltip-note">最近一次模型请求的上下文用量</span></span>;
  return <Tooltip title="上下文用量" description={description}>
    <button type="button" className="conversation-tool context-usage" aria-label={`上下文用量：${ratio}`} data-level={percent >= 95 ? 'full' : percent >= 80 ? 'high' : 'normal'}>
      <span className="context-ring" role="progressbar" aria-label="上下文使用比例" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent == null ? undefined : value} aria-valuetext={ratio}>
        <svg viewBox="0 0 24 24" width="23" height="23" fill="none" aria-hidden="true"><circle className="context-ring-track" cx="12" cy="12" r="8.5" strokeWidth="2.5" pathLength="100" strokeDasharray={percent == null ? '5 7' : undefined}/>{percent != null && value > 0 && <circle className="context-ring-value" cx="12" cy="12" r="8.5" strokeWidth="2.5" pathLength="100" strokeDasharray={`${value} 100`} transform="rotate(-90 12 12)"/>}</svg>
      </span>
    </button>
  </Tooltip>;
}
