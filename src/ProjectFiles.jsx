import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Check, ChevronRight, Code2, Download, File, FolderOpen, FolderPlus, MessageSquare, MoreHorizontal, Plus, RefreshCw, Save, Upload, X } from 'lucide-react';
import FileTree, { ExplorerDivider } from './FileExplorer';
import FileImage from './FileImage';
import IconButton from './IconButton';
import LoadingPlaceholder from './LoadingPlaceholder';
import Tooltip from './Tooltip';
import EditorTabs from './EditorTabs';
import { UploadProgress } from './UploadFeedback';

const CodeEditor = lazy(() => import('./CodeEditor'));

function ExplorerMenu({ title, icon: Icon, disabled, children }) {
  const root = useRef(), [open, setOpen] = useState(false);
  function keydown(event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || disabled) return;
    event.preventDefault();
    const wasOpen = root.current.open;
    root.current.open = true;
    const items = [...root.current.querySelectorAll('button:not(:disabled),a[href]')];
    const index = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' || !wasOpen && event.key === 'ArrowUp' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  }
  return <details className="row-menu explorer-menu" ref={root} onToggle={event => setOpen(event.currentTarget.open)} onKeyDown={keydown}>
    <summary role="button" title={title} aria-label={title} aria-expanded={open} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : 0} onClick={event => { if (disabled) event.preventDefault(); }}><Icon size={15}/></summary>
    <div onClickCapture={event => {
      const item = event.target.closest('button,a');
      if (item && !item.disabled) { root.current.open = false; root.current.querySelector('summary').focus(); }
    }}>{children}</div>
  </details>;
}

function FileBreadcrumbs({ project, path }) {
  const parts = [project.name, ...path.split('/')], name = parts.pop();
  return <nav className="file-toolbar" aria-label="文件路径" title={`${project.name}/${path}`}>
    <span className="file-parents" dir="rtl"><span dir="ltr">{parts.map((part, index) => <span key={index}>{part}<ChevronRight size={12} aria-hidden="true"/></span>)}</span></span>
    <span className="file-current-name">{name}</span>
  </nav>;
}

export default function ProjectFiles({ project, files, filesLoading, tabs, selectedFile, tab, fileBusy, theme, uploadDisabled, uploadProgress, onCancelUpload, onDropFiles, api, Dialog, notify, onUploadFiles, onUploadFolder, onUploadArchive, onNewFile, onNewFolder, onRefresh, onOpen, onAction, onContext, onFileContext, onDownload, onDeleted, beforeDelete, onSelect, onCloseTabs, onReload, onSave, onEditorSave, onCodeChange }) {
  const [showMeta, setShowMeta] = useState(() => localStorage.getItem('explorer-show-meta') === 'true');
  const [selectionCount, setSelectionCount] = useState(0);
  const [clearSelectionRequest, setClearSelectionRequest] = useState(0);
  const [selectionRequest, setSelectionRequest] = useState(null);
  const editorTabs = useRef();
  const dragDepth = useRef(0), [dropActive, setDropActive] = useState(false);
  const resetDrop = useCallback(() => { dragDepth.current=0; setDropActive(false); }, []);
  useEffect(() => {
    window.addEventListener('dragend',resetDrop); window.addEventListener('drop',resetDrop); window.addEventListener('blur',resetDrop);
    return () => { window.removeEventListener('dragend',resetDrop); window.removeEventListener('drop',resetDrop); window.removeEventListener('blur',resetDrop); };
  }, [resetDrop]);
  useEffect(() => { if (uploadDisabled) resetDrop(); }, [uploadDisabled,resetDrop]);
  const fileDrag = event => [...event.dataTransfer.types].includes('Files');
  const openFile = useCallback(path => { onOpen(path); editorTabs.current?.reveal(path); }, [onOpen]);
  const selectFile = useCallback(path => { setSelectionRequest({ path }); onSelect(path); }, [onSelect]);
  const dirty = !!tab && tab.kind !== 'image' && tab.content !== tab.original;
  return <div className="editor-body" onDragEnterCapture={event=>{if(!fileDrag(event))return;event.preventDefault();event.stopPropagation();if(!uploadDisabled){dragDepth.current++;setDropActive(true);}}} onDragOverCapture={event=>{if(!fileDrag(event))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=uploadDisabled?'none':'copy';}} onDragLeaveCapture={event=>{if(!fileDrag(event))return;event.stopPropagation();if(--dragDepth.current<=0)resetDrop();}} onDropCapture={event=>{if(!fileDrag(event))return;event.preventDefault();event.stopPropagation();resetDrop();if(!uploadDisabled)onDropFiles(event.dataTransfer);}}>
    <aside className="file-explorer">
      <div className={`explorer-heading ${selectionCount > 1 ? 'has-selection' : ''}`}><div className="explorer-heading-label"><span className="explorer-heading-name">资源管理器</span><div className="explorer-selection-count"><button type="button" aria-label="取消文件选择" onClick={() => setClearSelectionRequest(value => value + 1)}><X size={12}/></button><span role="status" aria-live="polite">{selectionCount > 1 ? `已选 ${selectionCount} 项` : ''}</span></div></div><div className="explorer-actions">
        <ExplorerMenu title="上传" icon={Upload} disabled={uploadDisabled}>
          <button type="button" onClick={onUploadFiles}><File size={15}/>上传文件</button>
          <button type="button" onClick={onUploadFolder}><FolderOpen size={15}/>上传文件夹</button>
          <button type="button" onClick={onUploadArchive}><Archive size={15}/>上传 ZIP 并解压</button>
        </ExplorerMenu>
        <IconButton title="新建文件夹" disabled={!project} onClick={onNewFolder}><FolderPlus size={15}/></IconButton>
        <IconButton title="刷新文件树" disabled={!project || filesLoading} onClick={onRefresh}><RefreshCw size={15} className={filesLoading ? 'spin' : ''}/></IconButton>
        <ExplorerMenu title="更多文件操作" icon={MoreHorizontal} disabled={!project}>
          <button type="button" onClick={onNewFile}><Plus size={15}/>新建文件</button>
          {project && <a href={`/api/projects/${project.id}/download`}><Download size={15}/>下载整个项目</a>}
          <hr/>
          <button type="button" role="switch" aria-checked={showMeta} onClick={() => { const next = !showMeta; setShowMeta(next); localStorage.setItem('explorer-show-meta', String(next)); }}><span className="explorer-menu-check">{showMeta && <Check size={14}/>}</span>显示 .meta 文件</button>
        </ExplorerMenu>
      </div></div>
      {project ? <>{filesLoading && !files.length ? <LoadingPlaceholder label="正在读取文件…" variant="list" rows={6}/> : <FileTree entries={files} showMeta={showMeta} onOpen={openFile} selected={selectedFile} selectionRequest={selectionRequest} onAction={onAction} onContext={onContext} onRefresh={onRefresh} onDownload={onDownload} onSelectionCountChange={setSelectionCount} clearSelectionRequest={clearSelectionRequest} project={project} api={api} Dialog={Dialog} onDeleted={onDeleted} beforeDelete={beforeDelete} notify={notify}/>}
        {!filesLoading && !files.length && <div className="files-empty"><FolderOpen size={25}/><p>项目还是空的</p><button onClick={onUploadFiles}>上传你的第一个文件</button></div>}
      </> : <p className="files-empty">先选择一个项目</p>}
    </aside>
    <ExplorerDivider/>
    <div className="editor-content">
      <div className="editor-tabbar"><EditorTabs ref={editorTabs} tabs={tabs} selectedFile={selectedFile} onSelect={selectFile} onCloseTabs={onCloseTabs} notify={notify}/>
      {tab && <div className="editor-file-actions">
        <IconButton title="添加到对话上下文" onClick={() => onFileContext(tab.path)}><MessageSquare size={15}/></IconButton>
        <Tooltip title="下载文件"><a aria-label="下载文件" className="icon-button" download href={`/api/projects/${project.id}/download?path=${encodeURIComponent(tab.path)}`}><Download size={15}/></a></Tooltip>
        <IconButton title="重新加载（丢弃修改）" onClick={() => onReload(tab)}><RefreshCw size={15}/></IconButton>
        {tab.kind !== 'image' && <Tooltip title="保存文件（Ctrl+S / ⌘S）" disabled={!dirty}><button type="button" className={`save-file ${dirty ? 'is-dirty' : ''}`} aria-label="保存文件" onClick={onSave} disabled={!dirty}><Save size={14}/><span>保存</span></button></Tooltip>}
      </div>}</div>
      {fileBusy ? <LoadingPlaceholder label="正在读取文件内容…" variant="code" rows={9}/> : tab ? <>
        <FileBreadcrumbs project={project} path={tab.path}/>
        {tab.kind === 'image' ? <FileImage key={`${project.id}/${tab.path}/${tab.modified}`} file={tab}/> : <div className="monaco-container"><Suspense fallback={<LoadingPlaceholder label="正在加载编辑器…" variant="code" rows={9}/>}><CodeEditor file={`${project.id}/${tab.path}`} content={tab.content} dirty={dirty} onChange={onCodeChange} onSave={onEditorSave} notify={notify} theme={theme}/></Suspense></div>}
      </> : <div className="editor-placeholder"><Code2 size={36} strokeWidth={1}/><h3>让代码与对话在一起</h3><p>从左侧选择一个文件来查看和编辑。</p><p className="editor-drop-hint">拖入文件、文件夹或 ZIP 即可上传</p><div><kbd>Ctrl</kbd> + <kbd>S</kbd><span>保存更改</span></div></div>}
    </div>
    {dropActive&&<div className="editor-drop-overlay"><div><Upload size={32}/><strong>松开即可上传到项目</strong><span>文件夹将先压缩，再上传解压</span></div></div>}
    {uploadProgress&&<UploadProgress progress={uploadProgress} onCancel={onCancelUpload} inline/>}
  </div>;
}
