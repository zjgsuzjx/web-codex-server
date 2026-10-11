import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Gauge, HardDrive, RefreshCw, ChevronRight } from 'lucide-react';
import LoadingPlaceholder from './LoadingPlaceholder';
import { quotaBuckets, remainingPercent, windowLabel, formatBytes, mergeQuota } from '../shared/usage';
const percent = n => n == null ? '暂不可用' : `${Number(n.toFixed(1))}%`;
const resetTime = t => typeof t === 'number' && t > 0 ? new Date(t * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '重置时间暂不可用';
function Meter({ value }) { return <div className="capacity-meter"><i style={{ width: `${value ?? 0}%` }} /></div>; }
export default memo(function UsageOverview({ api, socket, Dialog }) {
  const [data, setData] = useState(null), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const pending = useRef(false), mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return; pending.current = true; setBusy(true);
    try {
      const results = await Promise.allSettled([
        api('/dashboard').then(result => { if(mounted.current)setData(prev => ({ ...result, codex: prev?.codex || result.codex })); }),
        api('/codex-usage').then(codex => { if(mounted.current)setData(prev => ({ ...prev, codex })); })
      ]);
      if(mounted.current)setError(results.some(r => r.status === 'rejected'));
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
    <button type="button" className="usage-summary" onClick={() => setOpen(true)} aria-label="查看剩余额度和服务器容量"><span><Gauge size={13}/><span>Codex 剩余 <b className={busy&&!data?.codex?.updatedAt ? "summary-loading" : ""}>{label}</b></span></span><span><HardDrive size={13}/><span>服务器剩余 <b className={busy&&!data?.server ? "summary-loading" : ""}>{data?.server ? formatBytes(data.server.disk.available) : '读取中…'}</b></span></span><ChevronRight size={12}/></button>
    {open && <Dialog title="用量与容量" subtitle="你的 Codex 额度与工作区资源，自动更新。" onClose={() => setOpen(false)} wide><div className="capacity-dialog"><div className="capacity-toolbar"><span>{error ? '刷新失败，请稍后重试' : data?.codex?.stale ? data.codex.message : '额度按账号共享，磁盘容量为服务器实际可用空间。'}</span><button type="button" className="secondary" disabled={busy} onClick={refresh}><RefreshCw size={14} className={busy ? 'spin' : ''}/>刷新</button></div>
      <section className="capacity-section"><h3><Gauge size={17}/>Codex 剩余额度</h3>{data?.codex?.status === 'available' && buckets.length ? buckets.map((bucket, index) => <div className="quota-bucket" key={bucket.limitId || index}><h4>{bucket.limitName || bucket.limitId || 'Codex'}</h4><div className="quota-windows">{['primary','secondary'].map((key, i) => { const w = bucket[key]; if (!w) return null; const remaining = remainingPercent(w); return <div className="quota-window" key={key}><div><span>{windowLabel(w.windowDurationMins, `窗口 ${i + 1}`)}</span><strong>{percent(remaining)}<small>剩余</small></strong></div><Meter value={remaining}/><p>{resetTime(w.resetsAt)}{w.resetsAt ? ' 重置' : ''}</p></div>; })}</div>{bucket.credits && <p className="credit-balance">{bucket.credits.unlimited ? '额度余额：无限制' : bucket.credits.balance != null ? `额度余额：${bucket.credits.balance}` : '额度余额：暂不可用'}</p>}</div>) : busy&&!data?.codex?.updatedAt ? <LoadingPlaceholder label="正在读取额度…" rows={3}/> : <p className="capacity-empty">{data?.codex?.message || '额度信息暂不可用'}</p>}{data?.codex?.updatedAt && <p className="capacity-updated">额度更新于 {new Date(data.codex.updatedAt).toLocaleTimeString('zh-CN')}</p>}</section>
      {busy&&!data?.server&&<LoadingPlaceholder label="正在读取存储与内存…" rows={4}/>}
      {data?.server && data?.storage && <section className="capacity-section"><h3><HardDrive size={17}/>存储与内存</h3><div className="storage-grid">{[
        { label: '服务器磁盘可用', available: data.server.disk.available, total: data.server.disk.total, note: '项目、系统和其他服务共享此磁盘' },
        { label: '我的项目配额剩余', available: data.storage.available, total: data.storage.quota, note: `已用 ${formatBytes(data.storage.used)} · 单文件上限 ${formatBytes(data.storage.maxFile)}` },
        { label: '服务器内存可用', available: data.server.memory.available, total: data.server.memory.total, note: '包含系统可回收缓存的可用内存' }
      ].map(m => <div className="storage-card" key={m.label}><span>{m.label}</span><strong>{formatBytes(m.available)}</strong><Meter value={m.total ? Math.max(0, Math.min(100, m.available / m.total * 100)) : null}/><p>总量 {formatBytes(m.total)}</p><small>{m.note}</small></div>)}</div><p className="capacity-updated">容量更新于 {new Date(data.server.updatedAt).toLocaleTimeString('zh-CN')} · CLI/终端写入不受网页项目配额约束</p></section>}
    </div></Dialog>}
  </>;
});
