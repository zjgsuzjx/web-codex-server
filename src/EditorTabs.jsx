import { useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, File, X } from 'lucide-react';
import ContextMenu from './ContextMenu';
import IconButton from './IconButton';

const FADE_SPACE = 24;

export default function EditorTabs({ ref, tabs, selectedFile, onSelect, onClose }) {
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
  function closeMenu(restore) { if (restore) picker.current?.focus({ preventScroll: true }); setMenu(null); }
  return <>
    <div className={'editor-tabs-viewport ' + (edges.left ? 'has-left-overflow ' : '') + (edges.right ? 'has-right-overflow' : '')}>
      <div ref={viewport} className="editor-tabs" role="group" aria-label="打开的文件" onScroll={updateEdges}
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
        onClickCapture={event => { if (gesture.current?.dragged) { event.preventDefault(); event.stopPropagation(); } gesture.current = null; }}>
        {tabs.map(file => {
          const changed = file.kind !== 'image' && file.content !== file.original;
          return <div key={file.path} data-path={file.path} className={'editor-tab ' + (file.path === selectedFile ? 'active ' : '') + (changed ? 'is-dirty' : '')}>
            <button type="button" aria-pressed={file.path === selectedFile} title={file.path} onClick={() => select(file.path)}><File size={14}/><span>{file.path.split('/').pop()}</span></button>
            <IconButton title={changed ? '关闭文件（有未保存的修改）' : '关闭文件'} className="editor-tab-close" onClick={() => onClose(file.path)}><X size={12}/></IconButton>
          </div>;
        })}
      </div>
    </div>
    {tabs.length > 0 && <button ref={picker} type="button" className="editor-tabs-picker" title={'打开的文件（' + tabs.length + '）'} aria-label={'打开的文件（' + tabs.length + '）'} aria-haspopup="menu" aria-expanded={!!menu} onClick={() => {
      if (menu) { closeMenu(false); return; }
      const rect = picker.current.getBoundingClientRect();
      setMenu({ x: rect.right - 232, y: rect.bottom + 4, trigger: picker.current, label: '打开的文件', heading: tabs.length + ' 个打开的文件' });
    }}><span>{tabs.length}</span><ChevronDown size={12}/></button>}
    {menu && <ContextMenu menu={menu} onClose={closeMenu} items={tabs.map(file => ({ label: file.path + (file.kind !== 'image' && file.content !== file.original ? ' · 未保存' : ''), icon: file.path === selectedFile ? Check : File, action: () => select(file.path) }))}/>}
  </>;
}
