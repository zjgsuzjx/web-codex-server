import { useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Copy, File, Files, X } from 'lucide-react';
import ContextMenu from './ContextMenu';
import IconButton from './IconButton';
import useLongPress from './useLongPress';
import { isDirtyTab, tabClosePaths } from './editor-tabs';

const FADE_SPACE = 24;

export default function EditorTabs({ ref, tabs, selectedFile, onSelect, onCloseTabs, notify }) {
  const viewport = useRef(), picker = useRef(), activePath = useRef(selectedFile), gesture = useRef();
  const [edges, setEdges] = useState({ left: false, right: false }), [menu, setMenu] = useState(null);
  activePath.current = selectedFile;
  const paths = JSON.stringify(tabs.map(file => file.path));

  function updateEdges() {
    const node = viewport.current;
    const left = node.scrollLeft > 1, right = node.scrollWidth - node.clientWidth - node.scrollLeft > 1;
    setEdges(prev => prev.left === left && prev.right === right ? prev : { left, right });
  }
  function reveal(path = activePath.current) {
    const node = viewport.current, tab = [...node.children].find(child => child.dataset.path === path);
    if (tab) {
      const start = tab.offsetLeft, end = start + tab.offsetWidth, width = node.clientWidth;
      const padding = Math.max(0, Math.min(FADE_SPACE, (width - tab.offsetWidth) / 2));
      const leftSpace = start > 0 ? padding : 0;
      const rightSpace = end < node.scrollWidth ? padding : 0;
      if (end - start + leftSpace + rightSpace > width || start < node.scrollLeft + leftSpace) node.scrollLeft = start - leftSpace;
      else if (end > node.scrollLeft + width - rightSpace) node.scrollLeft = end - width + rightSpace;
    }
    updateEdges();
  }
  useImperativeHandle(ref, () => ({ reveal }));
  useLayoutEffect(() => { reveal(); }, [selectedFile, paths]);
  useLayoutEffect(() => {
    const node = viewport.current, observer = new ResizeObserver(() => reveal());
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    const wheel = event => {
      if (event.ctrlKey || node.scrollWidth <= node.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const scale = event.deltaMode === 1 ? 30 : event.deltaMode === 2 ? node.clientWidth : 1;
      node.scrollLeft += delta * scale;
      event.preventDefault();
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); node.removeEventListener('wheel', wheel); };
  }, [paths]);

  function select(path) { onSelect(path); reveal(path); }
  function closeMenu(restore) {
    const target = menu?.focus || picker.current;
    if (restore && target?.isConnected) target.focus({ preventScroll: true });
    setMenu(null);
  }
  async function closeFiles(paths) {
    if (!paths.length) return;
    const focused = viewport.current?.contains(document.activeElement) ? document.activeElement : null;
    try { await onCloseTabs(paths); }
    catch (error) { notify(error.message, true); }
    finally {
      requestAnimationFrame(() => {
        const node = viewport.current;
        if (node && document.activeElement === document.body && (focused && !focused.isConnected || !node.children.length)) {
          (node.querySelector('.editor-tab.active>button') || picker.current || node).focus({ preventScroll: true });
        }
      });
    }
  }
  function contextAt(point) {
    const tab = point.target.closest('[data-path]');
    if (!tab) return;
    gesture.current = null;
    setMenu({ x: point.x, y: point.y, kind: 'context', path: tab.dataset.path, focus: tab.querySelector('button'), label: '标签操作菜单', heading: tab.dataset.path });
  }
  const longPress = useLongPress(contextAt);
  async function copyPath(path) {
    try { await navigator.clipboard.writeText(path); notify('已复制相对路径'); }
    catch { notify('无法访问剪贴板，请检查浏览器权限', true); }
  }
  function menuItems() {
    if (menu.kind !== 'context') return tabs.map(file => ({ label: `${file.path}${isDirtyTab(file) ? ' · 未保存' : ''}`, icon: file.path === selectedFile ? Check : File, action: () => select(file.path) }));
    const close = (label, icon, mode) => ({ label, icon, disabled: !tabClosePaths(tabs, menu.path, mode).length, action: () => void closeFiles(tabClosePaths(tabs, menu.path, mode)) });
    return [
      close('关闭标签', X, 'single'),
      close('关闭其他标签', Files, 'others'),
      close('关闭右侧标签', ArrowRight, 'right'),
      close('关闭已保存标签', Check, 'saved'),
      close('关闭所有标签', X, 'all'),
      { separator: true },
      { label: '复制相对路径', icon: Copy, action: () => void copyPath(menu.path) },
    ];
  }
  return <>
    <div className={`editor-tabs-viewport ${edges.left ? 'has-left-overflow' : ''} ${edges.right ? 'has-right-overflow' : ''}`}>
      <div ref={viewport} className="editor-tabs" role="group" aria-label="打开的文件" tabIndex={-1} onScroll={updateEdges} {...longPress}
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); contextAt({ x: event.clientX, y: event.clientY, target: event.target }); }}
        onKeyDown={event => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
          const tab = event.target.closest('[data-path]');
          if (!tab) return;
          event.preventDefault(); event.stopPropagation();
          const rect = tab.getBoundingClientRect();
          contextAt({ x: rect.left + 12, y: rect.bottom, target: event.target });
        }}
        onFocusCapture={event => { const tab = event.target.closest('[data-path]'); if (tab) reveal(tab.dataset.path); }}
        onPointerDown={event => { gesture.current = event.pointerType !== 'mouse' && event.isPrimary ? { id: event.pointerId, x: event.clientX, y: event.clientY, start: viewport.current.scrollLeft, dragged: false } : null; }}
        onPointerMove={event => {
          const drag = gesture.current;
          if (!drag || drag.id !== event.pointerId) return;
          const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
          if (!drag.dragged && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { drag.dragged = true; event.currentTarget.setPointerCapture(event.pointerId); }
          if (drag.dragged) viewport.current.scrollLeft = drag.start - dx;
        }}
        onPointerCancel={() => { gesture.current = null; }}
        onClickCapture={event => { longPress.onClickCapture(event); if (gesture.current?.dragged) { event.preventDefault(); event.stopPropagation(); } gesture.current = null; }}>
        {tabs.map(file => {
          const changed = isDirtyTab(file);
          return <div key={file.path} data-path={file.path} className={`editor-tab ${file.path === selectedFile ? 'active' : ''} ${changed ? 'is-dirty' : ''}`}
            onMouseDown={event => { if (event.button === 1) event.preventDefault(); }}
            onAuxClick={event => { if (event.button === 1) { event.preventDefault(); event.stopPropagation(); void closeFiles([file.path]); } }}>
            <button type="button" aria-pressed={file.path === selectedFile} title={file.path} onClick={() => select(file.path)}><File size={14}/><span>{file.path.split('/').pop()}</span></button>
            <IconButton title={changed ? '关闭文件（有未保存的修改）' : '关闭文件'} className="editor-tab-close" data-no-long-press onClick={() => void closeFiles([file.path])}><X size={12}/></IconButton>
          </div>;
        })}
      </div>
    </div>
    {tabs.length > 0 && <button ref={picker} type="button" className="editor-tabs-picker" title={`打开的文件（${tabs.length}）`} aria-label={`打开的文件（${tabs.length}）`} aria-haspopup="menu" aria-expanded={menu?.kind === 'list'} onClick={() => {
      if (menu?.kind === 'list') { closeMenu(false); return; }
      const rect = picker.current.getBoundingClientRect();
      setMenu({ x: rect.right - 232, y: rect.bottom + 4, kind: 'list', trigger: picker.current, label: '打开的文件', heading: `${tabs.length} 个打开的文件` });
    }}><span>{tabs.length}</span><ChevronDown size={12}/></button>}
    {menu && <ContextMenu menu={menu} onClose={closeMenu} items={menuItems()}/>}
  </>;
}
