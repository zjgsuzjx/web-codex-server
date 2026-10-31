import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { File, LoaderCircle, Search } from 'lucide-react';
import Modal from './Modal';
import { findFiles, indexLazyFiles } from './file-navigation';

export default function QuickFilePicker({ project, files, filesLoading, api, onOpen, onClose }) {
  const input = useRef(), list = useRef(), uid = useId();
  const [query, setQuery] = useState(''), [active, setActive] = useState(0), [extra, setExtra] = useState([]);
  const [indexing, setIndexing] = useState(false), [failures, setFailures] = useState([]), [retry, setRetry] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const allEntries = useMemo(() => [...new Map([...files, ...extra].map(entry => [entry.path, entry])).values()], [files, extra]);
  const results = useMemo(() => findFiles(allEntries, deferredQuery), [allEntries, deferredQuery]);
  const current = Math.min(active, Math.max(0, results.entries.length - 1));
  useEffect(() => {
    const keydown = event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'p' || input.current?.closest('[inert]')) return;
      event.preventDefault(); event.stopPropagation(); input.current.focus(); input.current.select();
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setExtra([]); setFailures([]); setIndexing(true);
    indexLazyFiles(files, (path, signal) => api(`/projects/${project.id}/files?path=${encodeURIComponent(path)}`, { signal }), {
      signal: controller.signal,
      onBatch: rows => setExtra(previous => [...previous, ...rows]),
    }).then(errors => { if (!controller.signal.aborted) { setFailures(errors); setIndexing(false); } });
    return () => controller.abort();
  }, [project.id, files, api, retry]);
  useEffect(() => { setActive(0); }, [deferredQuery]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [current, results]);
  const choose = entry => { if (entry) { onClose(); onOpen(entry.path); } };
  return <Modal title="查找文件" subtitle={project.name} className="quick-file-picker" initialFocus={input} onClose={onClose}>
    <div className="quick-file-input"><Search size={17}/><input ref={input} role="combobox" aria-label="按文件名查找" aria-autocomplete="list" aria-expanded="true" aria-controls={`${uid}-results`} aria-activedescendant={results.entries.length ? `${uid}-${current}` : undefined} autoComplete="off" spellCheck={false} placeholder="输入文件名或路径…" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Enter') { if (query === deferredQuery) choose(results.entries[current]); }
        else setActive(value => (Math.min(value, Math.max(0, results.entries.length - 1)) + (event.key === 'ArrowDown' ? 1 : -1) + results.entries.length) % (results.entries.length || 1));
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); event.stopPropagation(); input.current.select(); }
    }}/>{(indexing || filesLoading || query !== deferredQuery) && <LoaderCircle size={15} className="spin" aria-label="正在查找文件"/>}</div>
    <div ref={list} id={`${uid}-results`} role="listbox" aria-label="匹配文件" className="quick-file-results" aria-busy={filesLoading || indexing}>
      {results.entries.map((entry, index) => <button type="button" role="option" tabIndex={-1} aria-selected={index === current} id={`${uid}-${index}`} key={entry.path} title={entry.path} onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(entry)}><File size={16}/><span><strong>{entry.name}</strong><small>{entry.path}</small></span>{index === current && <kbd>Enter</kbd>}</button>)}
    </div>
    {!results.entries.length && <p className="quick-file-empty" role="status">{filesLoading || indexing ? '正在查找项目文件…' : query.trim() ? '没有匹配的文件' : '项目中还没有文件'}</p>}
    <div className="quick-file-footer"><span role="status">{filesLoading || indexing ? '正在读取其余文件…' : results.total > results.entries.length ? `找到 ${results.total} 个文件，显示前 ${results.entries.length} 个，请继续输入` : `${results.total} 个文件`}</span><span>↑↓ 选择 · Enter 打开 · Esc 关闭</span></div>
    {!!failures.length && <p className="quick-file-error" role="alert">部分目录读取失败，已保留可用结果。<button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></p>}
  </Modal>;
}
