import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, File, FilePlus, FolderPlus, Download, MessageSquare, Pencil, Trash2, HardDrive, LoaderCircle, X, Copy, MoreHorizontal, RefreshCw, ChevronsUp, ListChecks } from 'lucide-react';
import ContextMenu from './ContextMenu';
import useLongPress from './useLongPress';
import { selectPaths, contextPaths, parentPath } from './file-selection';
import { formatBytes } from '../shared/usage';
import { topPaths } from '../shared/storage';

export const ExplorerDivider = memo(function ExplorerDivider() {
  const ref = useRef(), [width, setWidth] = useState(() => { const mobile = window.innerWidth <= 800, stored = Number(localStorage.getItem(mobile ? 'explorer-width-mobile' : 'explorer-width')); return stored >= (mobile ? 112 : 200) && stored <= 480 ? stored : mobile ? 145 : 268; });
  const [limits, setLimits] = useState({ minimum: window.innerWidth <= 800 ? 112 : 200, maximum: 480 });
  useEffect(() => {
    const body = ref.current.parentElement;
    const resize = () => { const minimum = window.innerWidth <= 800 ? 112 : 200; setLimits({ minimum, maximum: Math.round(Math.max(minimum, Math.min(480, body.clientWidth - 176, window.innerWidth <= 800 ? body.clientWidth * .46 : Infinity))) }); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(body); return () => observer.disconnect();
  }, []);
  const { minimum, maximum } = limits, current = Math.max(minimum, Math.min(width, maximum));
  useEffect(() => { ref.current.parentElement.style.setProperty('--explorer-width', `${current}px`); }, [current]);
  function change(value) { const next = Math.round(Math.max(minimum, Math.min(maximum, value))); setWidth(next); localStorage.setItem(window.innerWidth <= 800 ? 'explorer-width-mobile' : 'explorer-width', String(next)); }
  return <div ref={ref} className="explorer-divider" role="separator" tabIndex={0} aria-label="调整资源管理器宽度" aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={current} onKeyDown={e => { const value = e.key === 'Home' ? minimum : e.key === 'End' ? maximum : e.key === 'ArrowLeft' ? current - 10 : e.key === 'ArrowRight' ? current + 10 : null; if (value != null) { e.preventDefault(); change(value); } }} onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.dataset.start = `${e.clientX},${current}`; e.currentTarget.classList.add('dragging'); }} onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const [x, start] = e.currentTarget.dataset.start.split(',').map(Number); change(start + e.clientX - x); }} onLostPointerCapture={e => e.currentTarget.classList.remove('dragging')} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}><i/></div>;
});

export default memo(function FileTree({ entries, showMeta = false, selected, selectionRequest, onOpen, onAction, onContext, onRefresh, onDownload, onSelectionCountChange, clearSelectionRequest, project, api, Dialog, onDeleted, beforeDelete, notify }) {
  const [expanded, setExpanded] = useState(new Set()), [selection, setSelection] = useState(new Set()), [extra, setExtra] = useState([]), [loaded, setLoaded] = useState(new Set());
  const [busy, setBusy] = useState(false), [detail, setDetail] = useState(null), [error, setError] = useState(''), [menu, setMenu] = useState(null);
  const [treeFocused, setTreeFocused] = useState(false);
  const [activePath, setActivePath] = useState(selected);
  const pending = useRef(false), projectRef = useRef(project.id), tree = useRef(), anchor = useRef(null);
  projectRef.current = project.id;
  useEffect(() => { onSelectionCountChange?.(selection.size); }, [selection.size, onSelectionCountChange]);
  useEffect(() => () => onSelectionCountChange?.(0), [onSelectionCountChange]);
  function clearSelection(blur = false) {
    setSelection(new Set()); setActivePath(null); setTreeFocused(false); anchor.current = null;
    if (blur === true && tree.current?.contains(document.activeElement)) document.activeElement.blur();
  }
  function selectEntry(path) {
    setActivePath(path);
    setSelection(new Set(path && !window.matchMedia('(max-width:800px)').matches ? [path] : []));
    anchor.current = path;
  }
  useEffect(() => {
    // A file finishing its load must not take selection back from a folder.
    if (!tree.current?.contains(document.activeElement)) selectEntry(selected);
  }, [selected]);
  useEffect(() => { if (selectionRequest) selectEntry(selectionRequest.path); }, [selectionRequest]);
  useEffect(() => { clearSelection(); }, [clearSelectionRequest]);
  useEffect(() => {
    if (!selection.size && !treeFocused) return;
    const outside = event => {
      const target = event.target, explorer = tree.current?.closest('.file-explorer');
      if (tree.current?.contains(target) || explorer?.contains(target) && target.closest('.explorer-actions,.file-selection,.explorer-selection-count')) return;
      // Portaled file actions and confirmations still operate on the selected group.
      if (menu && target.closest('.context-menu') || target.closest('.modal-backdrop')) return;
      clearSelection(true);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [selection.size, treeFocused, menu]);
  const allEntries = useMemo(() => [...new Map([...entries, ...extra].map(entry => [entry.path, entry])).values()], [entries, extra]);
  useEffect(() => { if (!showMeta) setSelection(prev => new Set([...prev].filter(path => !allEntries.some(entry => entry.path === path && entry.type === 'file' && entry.name.toLowerCase().endsWith('.meta'))))); }, [showMeta, allEntries]);
  useEffect(() => { setExpanded(new Set()); clearSelection(); setExtra([]); setLoaded(new Set()); setDetail(null); setError(''); setMenu(null); }, [project.id]);
  useEffect(() => { setExtra([]); setLoaded(new Set()); setMenu(null); setExpanded(prev => new Set([...prev].filter(path => !entries.some(entry => entry.path === path && entry.lazy)))); setSelection(prev => new Set([...prev].filter(path => entries.some(entry => entry.path === path)))); }, [entries]);
  const folders = useMemo(() => {
    const map = new Map();
    for (const entry of allEntries) {
      const parent = parentPath(entry.path);
      if (!map.has(parent)) map.set(parent, []);
      map.get(parent).push(entry);
    }
    for (const rows of map.values()) rows.sort((a, b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
    return map;
  }, [allEntries]);
  const visible = useMemo(() => {
    const rows = [];
    function visit(parent = '', depth = 0) {
      for (const entry of folders.get(parent) || []) {
        if (!showMeta && entry.type === 'file' && entry.name.toLowerCase().endsWith('.meta')) continue;
        rows.push({ entry, depth });
        if (entry.type === 'directory' && expanded.has(entry.path)) visit(entry.path, depth + 1);
      }
    }
    visit(); return rows;
  }, [folders, expanded, showMeta]);
  const visiblePaths = visible.map(({ entry }) => entry.path);
  async function toggle(entry) {
    if (entry.lazy && !loaded.has(entry.path)) {
      try {
        const id = project.id, rows = await api(`/projects/${id}/files?path=${encodeURIComponent(entry.path)}`);
        if (projectRef.current !== id) return;
        setExtra(prev => [...prev, ...rows]); setLoaded(prev => new Set([...prev, entry.path]));
      } catch (error) { notify(error.message, true); return; }
    }
    setExpanded(prev => { const next = new Set(prev); next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path); return next; });
  }
  function activate(event, entry) {
    setTreeFocused(true);
    if (event.ctrlKey || event.metaKey) {
      setSelection(prev => selectPaths(visiblePaths, prev, entry.path, { toggle: !event.shiftKey, range: event.shiftKey, anchor: anchor.current, additive: true }));
      if (!event.shiftKey) anchor.current = entry.path;
      if (!event.shiftKey && selection.has(entry.path) && activePath === entry.path) setActivePath(null);
      return;
    }
    if (event.shiftKey) { setSelection(prev => selectPaths(visiblePaths, prev, entry.path, { range: true, anchor: anchor.current })); return; }
    selectEntry(entry.path);
    if (entry.type === 'file') onOpen(entry.path); else void toggle(entry);
  }
  function closeMenu(restoreFocus) {
    if (restoreFocus && menu?.focus?.isConnected) menu.focus.focus({ preventScroll: true });
    setMenu(null);
  }
  function openMenu(entry, point, focus) {
    if (entry) setTreeFocused(true); else clearSelection();
    const paths = contextPaths(selection, entry?.path);
    if (entry && !selection.has(entry.path)) { setSelection(new Set(paths)); setActivePath(entry.path); anchor.current = entry.path; }
    setMenu({ x: point.x, y: point.y, entry, paths, focus, label: '文件操作菜单', heading: paths.length > 1 ? `已选 ${paths.length} 项` : entry?.name || '项目文件' });
  }
  function contextAt(point) {
    const row = point.target.closest('[data-file-path]'), entry = allEntries.find(item => item.path === row?.dataset.filePath);
    const focus = row?.querySelector('.file-entry') || tree.current;
    openMenu(entry, point, focus);
  }
  const longPress = useLongPress(contextAt);
  async function inspect(deleting = false, paths = [...selection]) {
    if (pending.current || !paths.length) return;
    pending.current = true; setBusy(true); setError(''); const id = project.id;
    try {
      const result = await api(`/projects/${id}/size`, { method: 'POST', body: { paths: topPaths(paths) } });
      if (projectRef.current === id) setDetail({ ...result, deleting });
    } catch (error) { notify(error.message, true); }
    finally { pending.current = false; setBusy(false); }
  }
  async function download(paths) {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { await onDownload(topPaths(paths)); } catch (error) { notify(error.message, true); }
    finally { pending.current = false; setBusy(false); }
  }
  async function copyPaths(paths) {
    try { await navigator.clipboard.writeText(paths.join('\n')); notify(paths.length > 1 ? '已复制所选相对路径' : '已复制相对路径'); }
    catch { notify('无法访问剪贴板，请检查浏览器权限', true); }
  }
  async function remove() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); const id = project.id;
    try {
      if (!await beforeDelete(detail.entries.map(entry => entry.path)) || projectRef.current !== id) return;
      const { results } = await api(`/projects/${id}/delete`, { method: 'POST', body: { paths: detail.entries.map(entry => entry.path), fingerprints: Object.fromEntries(detail.entries.map(entry => [entry.path, entry.fingerprint])) } });
      onDeleted(id, results); window.dispatchEvent(new Event('storage:refresh'));
      if (projectRef.current === id) {
        const failures = results.filter(entry => !entry.deleted);
        if (failures.length) {
          setError(failures.map(entry => `${entry.path}：${entry.error}`).join('\n'));
          setDetail(prev => ({ ...prev, entries: prev.entries.filter(entry => failures.some(failure => failure.path === entry.path)), size: prev.entries.filter(entry => failures.some(failure => failure.path === entry.path)).reduce((total, entry) => total + entry.size, 0) }));
        } else { setDetail(null); setSelection(new Set()); }
      }
    } catch (error) { setError(error.message); } finally { pending.current = false; setBusy(false); }
  }
  function keydown(event) {
    const row = event.target.closest('[data-file-path]'), entry = allEntries.find(item => item.path === row?.dataset.filePath);
    const modifier = event.ctrlKey || event.metaKey;
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
      event.preventDefault(); event.stopPropagation();
      const rect = (row || tree.current).getBoundingClientRect();
      openMenu(entry, { x: rect.x + 20, y: rect.bottom }, row?.querySelector('.file-entry') || tree.current);
    } else if (modifier && event.key.toLowerCase() === 'a') {
      event.preventDefault(); event.stopPropagation(); setTreeFocused(true); setSelection(new Set(visiblePaths));
    } else if (event.key === 'Escape' && selection.size) {
      event.preventDefault(); event.stopPropagation(); clearSelection();
    } else if (event.key === 'F2' && entry && selection.size <= 1) {
      event.preventDefault(); onAction('rename', entry.path);
    } else if (event.key === 'Delete' && (entry || selection.size)) {
      event.preventDefault(); void inspect(true, selection.size ? [...selection] : [entry.path]);
    } else if (['ArrowDown', 'ArrowUp'].includes(event.key) && event.target.matches('.file-entry')) {
      event.preventDefault();
      const next = visible[Math.max(0, Math.min(visible.length - 1, visiblePaths.indexOf(entry.path) + (event.key === 'ArrowDown' ? 1 : -1)))]?.entry;
      if (next) {
        if (event.shiftKey) setSelection(prev => selectPaths(visiblePaths, prev, next.path, { range: true, anchor: anchor.current || entry.path, additive: modifier }));
        else if (!modifier) selectEntry(next.path);
        [...tree.current.querySelectorAll('[data-file-path]')].find(row => row.dataset.filePath === next.path)?.querySelector('.file-entry').focus();
      }
    }
  }
  function menuItems() {
    const { entry, paths } = menu, multiple = paths.length > 1;
    const items = [];
    if (entry && !multiple) {
      items.push({ label: entry.type === 'file' ? '打开文件' : expanded.has(entry.path) ? '折叠文件夹' : '展开文件夹', icon: entry.type === 'file' ? File : Folder, action: () => entry.type === 'file' ? onOpen(entry.path) : void toggle(entry) });
    }
    if (paths.length) items.push({ label: '查看大小', icon: HardDrive, disabled: busy, action: () => void inspect(false, paths) });
    if (!multiple) {
      const directory = entry?.type === 'directory' ? entry.path : parentPath(entry?.path || '');
      items.push({ separator: true }, { label: '新建文件', icon: FilePlus, action: () => onAction('newFile', directory) }, { label: '新建文件夹', icon: FolderPlus, action: () => onAction('newFolder', directory) });
    }
    if (paths.length) {
      items.push({ separator: true }, { label: '复制相对路径', icon: Copy, action: () => void copyPaths(paths) });
      if (!multiple) items.push({ label: '重命名', icon: Pencil, shortcut: 'F2', action: () => onAction('rename', entry.path) });
      items.push({ label: multiple ? '下载所选项目（ZIP）' : '下载', icon: Download, disabled: busy, action: () => void download(paths) });
      if (!multiple && entry.type === 'file') items.push({ label: '加入对话', icon: MessageSquare, action: () => onContext(entry.path) });
      items.push({ separator: true }, { label: multiple ? '删除所选项目' : '删除', icon: Trash2, danger: true, shortcut: 'Del', disabled: busy, action: () => void inspect(true, paths) });
    } else {
      items.push({ separator: true }, { label: '刷新文件树', icon: RefreshCw, action: onRefresh }, { label: '全部折叠', icon: ChevronsUp, action: () => setExpanded(new Set()) }, { label: '全选可见项目', icon: ListChecks, disabled: !visible.length, action: () => setSelection(new Set(visiblePaths)) });
    }
    return items;
  }
  return <>
    {selection.size > 0 && <div className="file-selection" data-count={selection.size}><div><span>已选 {selection.size} 项</span><button aria-label="取消文件选择" onClick={clearSelection}><X size={12}/></button></div><div><button disabled={busy} onClick={() => inspect()}>{busy ? <LoaderCircle size={12} className="spin"/> : <HardDrive size={12}/>}查看大小</button><button disabled={busy} onClick={() => download([...selection])}><Download size={12}/>下载</button><button className="danger-text" disabled={busy} onClick={() => inspect(true)}><Trash2 size={12}/>删除</button></div></div>}
    <div ref={tree} className={`file-tree ${selection.size ? 'has-selection' : ''}`} tabIndex={0} aria-label="项目文件" onKeyDown={keydown} onFocusCapture={event => { if (event.target.closest('[data-file-path]')) setTreeFocused(true); }} onClick={event => { if (event.target.closest('[data-file-path]')) return; const rect = tree.current.getBoundingClientRect(); if (event.clientX < rect.left + tree.current.clientWidth && event.clientY < rect.top + tree.current.clientHeight) clearSelection(true); }} {...longPress} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); contextAt({ x: event.clientX, y: event.clientY, target: event.target }); }}>
      {visible.map(({ entry, depth }) => <div key={entry.path} data-file-path={entry.path} className={`file-row ${activePath === entry.path && (!selection.size || selection.has(entry.path)) ? 'selected' : ''} ${selection.has(entry.path) ? 'multi-selected' : ''}`} style={{ paddingLeft: 8 + depth * 16 }}>
        <span className="file-guides" aria-hidden="true">{Array.from({ length: depth }, (_, index) => <i key={index}/>)}</span>
        <button type="button" className="file-entry" aria-current={selected === entry.path ? 'true' : undefined} aria-expanded={entry.type === 'directory' ? expanded.has(entry.path) : undefined} title={entry.path} onClick={event => activate(event, entry)}>{entry.type === 'directory' ? <>{expanded.has(entry.path) ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}<Folder size={13}/></> : <><span className="file-spacer"/><File size={13}/></>}<span>{entry.name}</span></button>
        <input className="file-select" type="checkbox" aria-label={`选择 ${entry.name}`} checked={selection.has(entry.path)} onChange={event => { setTreeFocused(true); anchor.current = entry.path; setSelection(prev => { const next = new Set(prev); event.target.checked ? next.add(entry.path) : next.delete(entry.path); return next; }); }}/>
        <button type="button" className="file-more" data-no-long-press aria-label={`${entry.name} 操作`} aria-haspopup="menu" aria-expanded={menu?.entry?.path === entry.path} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); openMenu(entry, { x: rect.right, y: rect.bottom }, event.currentTarget); }}><MoreHorizontal size={14}/></button>
      </div>)}
    </div>
    {menu && <ContextMenu menu={menu} items={menuItems()} onClose={closeMenu}/>}
    {detail && <Dialog title={detail.deleting ? '删除所选文件' : '所选文件大小'} subtitle="文件夹按内容合计，重复选择的子项只计算一次。" dismissible={!busy} onClose={() => { if (!busy) setDetail(null); }}><div className="file-size-dialog"><div className="cleanup-total"><HardDrive size={20}/><div><span>{detail.entries.length} 个文件或文件夹</span><strong>{formatBytes(detail.size)}</strong></div></div><div className="file-size-list">{detail.entries.map(entry => <div key={entry.path}><File size={15}/><span>{entry.path}<small>{entry.files} 个文件 · {entry.directories} 个文件夹</small></span><b>{formatBytes(entry.size)}</b></div>)}</div>{detail.deleting && <p className="delete-warning">确认后立即永久删除，无法撤销。正在运行的任务可能仍在使用这些文件。</p>}{error && <p className="form-error" role="alert">{error}</p>}<div className="cleanup-actions"><button className="secondary" disabled={busy} onClick={() => setDetail(null)}>取消</button>{detail.deleting ? <button className="primary danger-button" disabled={busy} onClick={remove}>{busy ? <LoaderCircle size={14} className="spin"/> : <Trash2 size={14}/>}确认永久删除</button> : <button className="primary" onClick={() => setDetail(prev => ({ ...prev, deleting: true }))}><Trash2 size={14}/>删除这些文件</button>}</div></div></Dialog>}
  </>;
});
