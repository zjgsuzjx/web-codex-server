import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Gauge, RefreshCw, ChevronRight } from 'lucide-react';
import LoadingPlaceholder from './LoadingPlaceholder';
import Tooltip from './Tooltip';
import { quotaBuckets, remainingPercent, windowLabel, mergeQuota } from '../shared/usage';
const percent = n => n == null ? '暂不可用' : `${Number(n.toFixed(1))}%`;
const resetTime = t => typeof t === 'number' && t > 0 ? new Date(t * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '重置时间暂不可用';
function Meter({ value }) { return <div className="capacity-meter"><i style={{ width: `${value ?? 0}%` }} /></div>; }
export default memo(function UsageOverview({ api, socket, Dialog }) {
  const [data, setData] = useState(null), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const pending = useRef(false), mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return; pending.current = true; setBusy(true);
    try {
      const codex = await api('/codex-usage');
      if (mounted.current) { setData({ codex }); setError(false); }
    }
    catch { if (mounted.current) setError(true); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }, [api]);
  useEffect(() => {
    mounted.current = true; refresh();
    const tick = () => { if (!document.hidden) refresh(); };
    const timer = setInterval(tick, 60000); document.addEventListener('visibilitychange', tick);
    return () => { mounted.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [refresh]);
  useEffect(() => socket?.subscribe(msg => {
    if (msg.event?.method === 'account/rateLimits/updated') setData(prev => prev?.codex?.snapshot ? { ...prev, codex: { status: 'available', snapshot: mergeQuota(prev.codex.snapshot, msg.event.params), updatedAt: Date.now() } } : prev);
    if (['account/updated','account/login/completed'].includes(msg.event?.method)) refresh();
  }), [socket, refresh]);
  const buckets = quotaBuckets(data?.codex?.snapshot), main = buckets.find(x => x.limitId === 'codex') || buckets[0];
  const available = remainingPercent(main?.primary), other = remainingPercent(main?.secondary);
  const label = data?.codex?.status === 'available' ? `${percent(available)}${other == null ? '' : ` / ${percent(other)}`}` : data?.codex?.status === 'unauthenticated' ? '待登录' : data?.codex?.status === 'unsupported' ? '服务商未提供' : busy && !data?.codex?.updatedAt ? '读取中…' : '暂不可用';
  return <>
    <Tooltip title="Codex 额度" description={`额度剩余：${label}。点击查看额度窗口与重置时间。`}>
      <button type="button" className="conversation-tool usage-summary" onClick={() => setOpen(true)} aria-label="查看 Codex 剩余额度"><span><Gauge size={14}/><span className="usage-label">额度</span><b className={busy&&!data?.codex?.updatedAt ? "summary-loading" : ""}>{data?.codex?.status === 'available' ? <>{percent(available)}{other != null && <span className="usage-secondary"> / {percent(other)}</span>}</> : label}</b></span><ChevronRight size={12}/></button>
    </Tooltip>
    {open && <Dialog title="Codex 额度" subtitle="查看账号剩余额度、使用窗口与重置时间。" onClose={() => setOpen(false)} wide><div className="capacity-dialog"><div className="capacity-toolbar"><span>{error ? '刷新失败，请稍后重试' : data?.codex?.stale ? data.codex.message : '额度由当前 Codex 账号共享，每分钟自动更新。'}</span><button type="button" className="secondary" disabled={busy} onClick={refresh}><RefreshCw size={14} className={busy ? 'spin' : ''}/>刷新</button></div>
      <section className="capacity-section"><h3><Gauge size={17}/>Codex 剩余额度</h3>{data?.codex?.status === 'available' && buckets.length ? buckets.map((bucket, index) => <div className="quota-bucket" key={bucket.limitId || index}><h4>{bucket.limitName || bucket.limitId || 'Codex'}</h4><div className="quota-windows">{['primary','secondary'].map((key, i) => { const w = bucket[key]; if (!w) return null; const remaining = remainingPercent(w); return <div className="quota-window" key={key}><div><span>{windowLabel(w.windowDurationMins, `窗口 ${i + 1}`)}</span><strong>{percent(remaining)}<small>剩余</small></strong></div><Meter value={remaining}/><p>{resetTime(w.resetsAt)}{w.resetsAt ? ' 重置' : ''}</p></div>; })}</div>{bucket.credits && <p className="credit-balance">{bucket.credits.unlimited ? '额度余额：无限制' : bucket.credits.balance != null ? `额度余额：${bucket.credits.balance}` : '额度余额：暂不可用'}</p>}</div>) : busy&&!data?.codex?.updatedAt ? <LoadingPlaceholder label="正在读取额度…" rows={3}/> : <p className="capacity-empty">{data?.codex?.message || '额度信息暂不可用'}</p>}{data?.codex?.updatedAt && <p className="capacity-updated">额度更新于 {new Date(data.codex.updatedAt).toLocaleTimeString('zh-CN')}</p>}</section>
    </div></Dialog>}
  </>;
});
