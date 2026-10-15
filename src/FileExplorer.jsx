import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, File, Download, MessageSquare, Pencil, Trash2, HardDrive, LoaderCircle, X } from 'lucide-react';
import RowMenu from './RowMenu';
import { formatBytes } from '../shared/usage';
import { topPaths } from '../shared/storage';

export const ExplorerDivider = memo(function ExplorerDivider() {
  const ref = useRef(), [width, setWidth] = useState(() => { const mobile = window.innerWidth <= 800, stored = Number(localStorage.getItem(mobile ? 'explorer-width-mobile' : 'explorer-width')); return stored >= 112 && stored <= 600 ? stored : mobile ? 145 : 190; });
  const [maximum, setMaximum] = useState(600);
  useEffect(() => {
    const body = ref.current.parentElement;
    const resize = () => setMaximum(Math.round(Math.max(112, Math.min(600, body.clientWidth - 170, window.innerWidth <= 800 ? body.clientWidth * .46 : Infinity))));
    resize(); const observer = new ResizeObserver(resize); observer.observe(body); return () => observer.disconnect();
  }, []);
  const current = Math.max(112, Math.min(width, maximum));
  useEffect(() => { ref.current.parentElement.style.setProperty('--explorer-width', `${current}px`); }, [current]);
  function change(value) { const next = Math.round(Math.max(112, Math.min(maximum, value))); setWidth(next); localStorage.setItem(window.innerWidth <= 800 ? 'explorer-width-mobile' : 'explorer-width', String(next)); }
  return <div ref={ref} className="explorer-divider" role="separator" tabIndex={0} aria-label="调整资源管理器宽度" aria-orientation="vertical" aria-valuemin={112} aria-valuemax={maximum} aria-valuenow={current} onKeyDown={e => { const value = e.key === 'Home' ? 112 : e.key === 'End' ? maximum : e.key === 'ArrowLeft' ? current - 10 : e.key === 'ArrowRight' ? current + 10 : null; if (value != null) { e.preventDefault(); change(value); } }} onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.dataset.start = `${e.clientX},${current}`; e.currentTarget.classList.add('dragging'); }} onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const [x, start] = e.currentTarget.dataset.start.split(',').map(Number); change(start + e.clientX - x); }} onLostPointerCapture={e => e.currentTarget.classList.remove('dragging')} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}><i/></div>;
});

export default memo(function FileTree({ entries, selected, onOpen, onAction, onContext, project, api, Dialog, onDeleted, beforeDelete, notify }) {
  const [expanded, setExpanded] = useState(new Set()), [selection, setSelection] = useState(new Set()), [extra, setExtra] = useState([]), [loaded, setLoaded] = useState(new Set());
  const [busy, setBusy] = useState(false), [detail, setDetail] = useState(null), [error, setError] = useState('');
  const pending = useRef(false), projectRef = useRef(project.id); projectRef.current = project.id;
  useEffect(() => { setExpanded(new Set()); setSelection(new Set()); setExtra([]); setLoaded(new Set()); setDetail(null); setError(''); }, [project.id]);
  useEffect(() => { setExtra([]); setLoaded(new Set()); setExpanded(prev => new Set([...prev].filter(path => !entries.some(e => e.path === path && e.lazy)))); setSelection(prev => new Set([...prev].filter(path => entries.some(e => e.path === path)))); }, [entries]);
  const folders = useMemo(() => {
    const map = new Map(), unique = new Map([...entries, ...extra].map(e => [e.path, e]));
    for (const x of unique.values()) { const parent = x.path.includes('/') ? x.path.slice(0, x.path.lastIndexOf('/')) : ''; if (!map.has(parent)) map.set(parent, []); map.get(parent).push(x); }
    for (const rows of map.values()) rows.sort((a, b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
    return map;
  }, [entries, extra]);
  async function toggle(x) {
    if (x.lazy && !loaded.has(x.path)) {
      try { const id = project.id, rows = await api(`/projects/${id}/files?path=${encodeURIComponent(x.path)}`); if (projectRef.current !== id) return; setExtra(prev => [...prev, ...rows]); setLoaded(prev => new Set([...prev, x.path])); }
      catch (e) { notify(e.message, true); return; }
    }
    setExpanded(prev => { const next = new Set(prev); next.has(x.path) ? next.delete(x.path) : next.add(x.path); return next; });
  }
  function activate(event, entry) {
    const pointer = event.nativeEvent.pointerType;
    const desktop = pointer === 'mouse' || pointer !== 'touch' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!desktop) {
      if (event.ctrlKey || event.metaKey) {
        setSelection(prev => { const next = new Set(prev); next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path); return next; });
        return;
      }
      setSelection(new Set([entry.path]));
    }
    if (entry.type === 'file') onOpen(entry.path);
    else void toggle(entry);
  }
  async function inspect(deleting = false) {
    if (pending.current) return; pending.current = true; setBusy(true); setError('');
    const id = project.id;
    try { const result = await api(`/projects/${id}/size`, { method: 'POST', body: { paths: topPaths([...selection]) } }); if (projectRef.current === id) setDetail({ ...result, deleting }); }
    catch (e) { notify(e.message, true); }
    finally { pending.current = false; setBusy(false); }
  }
  async function remove() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); const id = project.id;
    try {
      if (!await beforeDelete(detail.entries.map(e => e.path)) || projectRef.current !== id) return;
      const { results } = await api(`/projects/${id}/delete`, { method: 'POST', body: { paths: detail.entries.map(e => e.path), fingerprints: Object.fromEntries(detail.entries.map(e => [e.path, e.fingerprint])) } });
      onDeleted(id, results); window.dispatchEvent(new Event('storage:refresh'));
      if (projectRef.current === id) { const failures = results.filter(e => !e.deleted); if (failures.length) { setError(failures.map(e => `${e.path}：${e.error}`).join('\n')); setDetail(prev => ({ ...prev, entries: prev.entries.filter(e => failures.some(f => f.rel === e.path)), size: prev.entries.filter(e => failures.some(f => f.rel === e.path)).reduce((n, e) => n + e.size, 0) })); } else { setDetail(null); setSelection(new Set()); } }
    } catch (e) { setError(e.message); } finally { pending.current = false; setBusy(false); }
  }
  function render(parent = '', depth = 0) {
    return (folders.get(parent) || []).map(x => <React.Fragment key={x.path}><div className={`file-row ${selection.has(x.path) ? 'selected multi-selected' : selected === x.path ? 'selected' : ''}`} style={{ paddingLeft: 8 + depth * 13 }}><button aria-expanded={x.type === 'directory' ? expanded.has(x.path) : undefined} title={x.path} onClick={event => activate(event, x)}>{x.type === 'directory' ? <>{expanded.has(x.path) ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}<Folder size={13}/></> : <><span className="file-spacer"/><File size={13}/></>}<span>{x.name}</span></button><input className="file-select" type="checkbox" aria-label={`选择 ${x.name}`} checked={selection.has(x.path)} onChange={e => setSelection(prev => { const next = new Set(prev); e.target.checked ? next.add(x.path) : next.delete(x.path); return next; })}/><RowMenu label={`${x.name} 操作`} size={13}>{x.type === 'file' && <button onClick={() => onContext(x.path)}><MessageSquare size={12}/>加入对话</button>}<a download href={`/api/projects/${project.id}/download?path=${encodeURIComponent(x.path)}`}><Download size={12}/>下载</a><button onClick={() => onAction('rename', x.path)}><Pencil size={12}/>重命名</button><button className="danger-text" onClick={() => onAction('delete', x.path)}><Trash2 size={12}/>删除</button></RowMenu></div>{x.type === 'directory' && expanded.has(x.path) && render(x.path, depth + 1)}</React.Fragment>);
  }
  return <>{selection.size > 0 && <div className="file-selection"><div><span>已选 {selection.size} 项</span><button aria-label="取消文件选择" onClick={() => setSelection(new Set())}><X size={12}/></button></div><div><button disabled={busy} onClick={() => inspect()}>{busy ? <LoaderCircle size={12} className="spin"/> : <HardDrive size={12}/>}查看大小</button><button className="danger-text" disabled={busy} onClick={() => inspect(true)}><Trash2 size={12}/>删除</button></div></div>}<div className="file-tree">{render()}</div>{detail && <Dialog title={detail.deleting ? '强制删除文件' : '所选文件大小'} subtitle="文件夹按内容合计，重复选择的子项只计算一次。" dismissible={!busy} onClose={() => { if (!busy) setDetail(null); }}><div className="file-size-dialog"><div className="cleanup-total"><HardDrive size={20}/><div><span>{detail.entries.length} 个文件或文件夹</span><strong>{formatBytes(detail.size)}</strong></div></div><div className="file-size-list">{detail.entries.map(e => <div key={e.path}><File size={15}/><span>{e.path}<small>{e.files} 个文件 · {e.directories} 个文件夹</small></span><b>{formatBytes(e.size)}</b></div>)}</div>{detail.deleting && <p className="delete-warning">确认后立即永久删除，无法撤销。正在运行的任务可能仍在使用这些文件。</p>}{error && <p className="form-error" role="alert">{error}</p>}<div className="cleanup-actions"><button className="secondary" disabled={busy} onClick={() => setDetail(null)}>取消</button>{detail.deleting ? <button className="primary danger-button" disabled={busy} onClick={remove}>{busy ? <LoaderCircle size={14} className="spin"/> : <Trash2 size={14}/>}确认永久删除</button> : <button className="primary" onClick={() => setDetail(prev => ({ ...prev, deleting: true }))}><Trash2 size={14}/>删除这些文件</button>}</div></div></Dialog>}</>;
});
