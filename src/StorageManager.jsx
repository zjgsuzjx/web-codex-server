import { useCallback, useEffect, useRef, useState } from 'react';
import { HardDrive, AlertTriangle, Sparkles, Trash2, Check, LoaderCircle, Folder, File, RefreshCw, ArrowRight } from 'lucide-react';
import { formatBytes } from '../shared/usage';
import { storagePressure } from '../shared/storage';

export default function StorageManager({ api, Dialog, userId, onFiles, onDeleted, beforeDelete }) {
  const [data, setData] = useState(null), [warning, setWarning] = useState(null), [open, setOpen] = useState(false), [job, setJob] = useState(null), [selected, setSelected] = useState(new Set()), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const acknowledged = useRef(new Set()), pending = useRef(false), handled = useRef(null), mounted = useRef(true);
  const pressure = storagePressure(data), running = ['scanning', 'deleting'].includes(job?.phase);
  const refresh = useCallback(async () => {
    try { const result = await api('/dashboard'); if (mounted.current) setData(result); } catch (e) { if (mounted.current) setError(e.message); }
  }, [api]);
  useEffect(() => {
    mounted.current = true; refresh();
    const tick = () => { if (!document.hidden) refresh(); };
    const full = () => setWarning({ level: 'full', source: '存储空间', ratio: 1 });
    const timer = setInterval(tick, 60000); window.addEventListener('storage:refresh', tick); window.addEventListener('storage:full', full); document.addEventListener('visibilitychange', tick);
    const id = sessionStorage.getItem(`cleanup:${userId}`);
    if (id) api(`/storage/jobs/${id}`).then(value => { if (mounted.current) setJob(value); }).catch(() => sessionStorage.removeItem(`cleanup:${userId}`));
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener('storage:refresh', tick); window.removeEventListener('storage:full', full); document.removeEventListener('visibilitychange', tick); };
  }, [refresh, api, userId]);
  useEffect(() => {
    if (!data) return;
    const level = storagePressure(data), key = `${level.source}:${level.level}`;
    if (level.level === 'normal') { acknowledged.current.clear(); return; }
    if (!acknowledged.current.has(key)) setWarning(previous => previous?.level === 'full' && level.level !== 'full' ? previous : level);
  }, [data]);
  useEffect(() => {
    if (!job) return;
    sessionStorage.setItem(`cleanup:${userId}`, job.id);
    if (job.phase === 'ready') setSelected(new Set(job.files.map(file => file.id)));
    if (job.phase === 'done' && handled.current !== job.id) { handled.current = job.id; onDeleted(job.results || []); refresh(); window.dispatchEvent(new Event('storage:refresh')); }
  }, [job?.id, job?.phase]);
  useEffect(() => {
    if (!running) return;
    let cancelled = false, timer;
    const poll = async () => { try { const value = await api(`/storage/jobs/${job.id}`); if (!cancelled) { setError(''); setJob(value); if (['scanning', 'deleting'].includes(value.phase)) timer = setTimeout(poll, 1500); } } catch (e) { if (!cancelled) { if (e.status === 404) { setJob(previous => ({ ...previous, phase: 'failed', error: '清理任务已失效，请重新扫描。' })); sessionStorage.removeItem(`cleanup:${userId}`); return; } setError(e.message); timer = setTimeout(poll, 4000); } } };
    timer = setTimeout(poll, 1000); return () => { cancelled = true; clearTimeout(timer); };
  }, [job?.id, running, api]);
  async function scan() {
    if (pending.current || running) return; pending.current = true; setBusy(true); setError('');
    try { setJob(await api('/storage/scan', { method: 'POST' })); } catch (e) { setError(e.message); } finally { pending.current = false; setBusy(false); }
  }
  async function confirm() {
    if (pending.current || !selected.size || !beforeDelete(job.files.filter(file => selected.has(file.id)))) return;
    pending.current = true; setBusy(true); setError('');
    try { setJob(await api(`/storage/jobs/${job.id}/confirm`, { method: 'POST', body: { ids: [...selected] } })); } catch (e) { setError(e.message); } finally { pending.current = false; setBusy(false); }
  }
  function acknowledge() { acknowledged.current.add(`${warning.source}:${warning.level}`); setWarning(null); }
  const chosen = job?.files?.filter(file => selected.has(file.id)) || [], total = chosen.reduce((n, file) => n + file.size, 0);
  return <><button type="button" className={`conversation-tool storage-entry ${pressure.level !== 'normal' ? 'storage-alert' : ''}`} onClick={() => setOpen(true)} aria-label="管理存储空间"><HardDrive size={14}/><span>空间</span>{pressure.level !== 'normal' && <i/>}</button>
    {warning && <Dialog title={warning.level === 'full' ? '存储空间已满' : '存储空间即将用尽'} subtitle="请及时删除不需要的文件，保持工作区可用。" dismissible={false} onClose={() => {}}><div className="storage-warning-dialog"><div className="storage-warning-icon"><AlertTriangle size={28}/></div><strong>{warning.source}已使用 {Math.min(999, warning.ratio * 100).toFixed(1)}%</strong><p>空间耗尽可能导致会话无法打开、任务失败或文件无法保存。请前往文件管理器强制删除不需要的文件，也可以让 Codex 帮你查找可清理的空间。</p><div className="storage-warning-meter"><i style={{ width: `${Math.min(100, warning.ratio * 100)}%` }}/></div><div className="cleanup-actions"><button className="secondary" onClick={acknowledge}><Check size={14}/>已读</button><button className="primary" onClick={() => { acknowledge(); setOpen(true); }}>已读，管理空间<ArrowRight size={14}/></button></div></div></Dialog>}
    {open && !warning && <Dialog title="存储空间" subtitle="清理不用的文件，为下一次创作留出空间。" wide onClose={() => setOpen(false)}><div className="storage-manager"><div className="storage-overview"><div><HardDrive size={20}/><span>我的工作区</span><strong>{data ? formatBytes(data.storage.used) : '正在读取…'}</strong><small>{data?.storage.quota == null ? '存储上限：无限制' : `上限 ${formatBytes(data.storage.quota)}`}</small></div><div><span>服务器剩余</span><strong>{formatBytes(data?.server.disk.available)}</strong><small>与系统及其他用户共享</small></div></div><div className="storage-recovery"><div><strong>文件管理器</strong><p>查看大小并强制删除文件，无需 Codex 额度。</p></div><button className="secondary" onClick={() => { setOpen(false); onFiles(); }}>管理文件<ArrowRight size={14}/></button></div><section className="smart-cleanup"><header><div><Sparkles size={17}/><h3>Codex 智能清理</h3></div><button className="secondary" disabled={busy || running} onClick={scan}><RefreshCw size={13}/>{job ? '重新扫描' : '查找可清理空间'}</button></header><p>Codex 会分析你的项目，列出文件用途与大小。由你勾选并确认后再清理。</p>{!job && <div className="cleanup-empty"><Sparkles size={26}/><span>找出缓存、构建产物与不再需要的文件</span></div>}{running && <div className="cleanup-progress" role="status"><LoaderCircle size={25} className="spin"/><strong>{job.phase === 'scanning' ? '正在利用 Codex 搜索可清理的空间' : '正在利用 Codex 清理已确认的文件'}</strong><p>可以关闭此窗口，任务会在后台继续。</p></div>}{job?.phase === 'ready' && <>{job.files.length ? <><div className="cleanup-select-all"><label><input type="checkbox" checked={selected.size === job.files.length} onChange={e => setSelected(new Set(e.target.checked ? job.files.map(f => f.id) : []))}/>全选 · {job.files.length} 项</label><span>可释放 {formatBytes(total)}</span></div><div className="cleanup-file-list">{job.files.map(file => <label className="cleanup-file" key={file.id}><input type="checkbox" checked={selected.has(file.id)} onChange={e => setSelected(prev => { const next = new Set(prev); e.target.checked ? next.add(file.id) : next.delete(file.id); return next; })}/>{file.type === 'directory' ? <Folder size={18}/> : <File size={18}/>}<div><strong>{file.path}</strong><p>{file.purpose}</p></div><b>{formatBytes(file.size)}</b></label>)}</div><p className="delete-warning">永久删除无法撤销。请确认用途，取消勾选需要保留的项目；扫描后发生变化的文件会跳过。</p><div className="cleanup-actions"><span>{selected.size} 项 · {formatBytes(total)}</span><button className="primary danger-button" disabled={busy || !selected.size} onClick={confirm}>{busy ? <LoaderCircle size={14} className="spin"/> : <Trash2 size={14}/>}确认清理所选文件</button></div></> : <div className="cleanup-empty"><Check size={26}/><span>暂未找到适合清理的项目文件</span><p>可在文件管理器中自行查看和删除文件。</p></div>}</>}{job?.phase === 'done' && <div className="cleanup-results"><strong><Check size={17}/>已完成清理 · 释放 {formatBytes((job.results || []).filter(r => r.deleted).reduce((n, r) => n + r.size, 0))}</strong>{job.results?.map(result => <p key={result.path} className={result.deleted ? '' : 'danger-text'}>{result.path}<span>{result.deleted ? '已删除' : result.error}</span></p>)}</div>}{(error || job?.error) && <p className="form-error" role="alert">{error || job.error}</p>}</section></div></Dialog>}
  </>;
}
