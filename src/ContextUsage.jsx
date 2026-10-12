import { contextUsage } from '../shared/context';
export default function ContextUsage({ usage }) {
  const { used, limit, percent } = contextUsage(usage);
  const number = n => n == null ? '未知' : new Intl.NumberFormat('zh-CN').format(n);
  return <div className="context-usage" aria-label="上下文使用量" title="最近一次模型请求的上下文 token 使用量；包含输入和输出，不是历史累计消耗。">
    <span>上下文 <strong>{used == null ? '等待统计' : number(used)} / {number(limit)}</strong><small> tokens</small></span>
    {percent != null && <><div className="context-meter" role="progressbar" aria-label="上下文已使用" aria-valuenow={Math.min(100,percent)} aria-valuemin={0} aria-valuemax={100}><i style={{width:`${Math.min(100,percent)}%`}}/></div><span>{Math.round(percent)}%</span></>}
  </div>;
}
