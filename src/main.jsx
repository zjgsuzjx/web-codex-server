import Select from './Select';
import ModelPicker from './ModelPicker';
import ModelControls from './ModelControls';
import { effortTone } from './model-options';
import Tooltip from './Tooltip';
import RowMenu, { useRowMenuDismissal } from './RowMenu';
import { createCompletionNotice } from './completion-notice';
import chatgptLogo from './assets/chatgpt-logo.svg';
import LoadingPlaceholder from './LoadingPlaceholder';
import React, { useState, useEffect, useRef, useCallback, useMemo, memo, startTransition, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, ArrowUp, Square, Settings, PanelLeft, Code2, MessageSquare, Folder, FolderOpen, File, Upload, Download, X, ChevronRight, ChevronDown, Search, LogOut, Check, Copy, Save, Sun, Moon, Terminal, ShieldCheck, Sparkles, ArrowRight, RefreshCw, GitFork, Archive, LoaderCircle, Paperclip, Menu, KeyRound, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { Markdown, GeneratedImage, ToolOutput } from './ChatOutput';
import { contentImage, isProcessItem, reasoningText, toolContent } from '../shared/chat-content.js';
import { LiveSocket } from './socket';
import './style.css';
import '@fontsource-variable/inter';
import PermissionPicker from './PermissionPicker';
import UsageOverview from './UsageOverview';
import UserManagement, { roleName } from './UserManagement';
import { createDeltaBuffer, applyDeltas, applyLifecycle, mergeTurns } from './deltas';
import { AttachmentList, AttachmentPreview } from './Attachments';
import ContextUsage from './ContextUsage';
import ChangeSummary from './ChangeSummary';
import ThinkingStatus from './ThinkingStatus';
import { isRunning, mergeActivity } from '../shared/turn-activity.js';
import InviteManagement from './InviteManagement';
import ChatGPTLogin from './ChatGPTLogin';
import { zipFolder } from './zip-folder';
const CodeEditor = lazy(() => import('./CodeEditor'));
const ChangesReview = lazy(() => import('./ChangesReview'));
const TerminalView = lazy(() => import('./TerminalView'));
let csrfToken = '';
async function api(url, options = {}) {
  const res = await fetch(`/api${url}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, ...options.headers }, body: options.body == null ? undefined : JSON.stringify(options.body) });
  const data = await res.json(); if (!res.ok) { const e = new Error(data.error || '请求失败'); e.status = res.status; throw e; } return data;
}
const bytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
function Logo({ small = false }) { return <div className={`logo ${small ? 'small' : ''}`}><Sparkles size={small ? 16 : 23} strokeWidth={1.6} /></div>; }
function IconButton({ title, children, onClick, disabled, className = '', buttonRef, ...props }) { return <button type="button" className={`icon-button ${className}`} title={title} aria-label={title} onClick={onClick} disabled={disabled} ref={buttonRef} {...props}>{children}</button>; }
function usePresence(open) {
  const [present, setPresent] = useState(open);
  useEffect(() => { if (open) { setPresent(true); return; } const timer = setTimeout(() => setPresent(false), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240); return () => clearTimeout(timer); }, [open]);
  return open || present;
}
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => { const media = window.matchMedia(query), update = () => setMatches(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, [query]);
  return matches;
}
function ConversationTools({ thread, busy, disabledReason, onAction, onTerminal }) {
  const tools = [
    { action: 'fork', title: '创建对话分支', label: '分支', pending: '创建中…', icon: GitFork, description: '复制当前对话历史，在新的分支中继续探索。原对话会保留。' },
    { action: 'compact', title: '压缩上下文', label: '压缩上下文', pending: '压缩中…', icon: RefreshCw, description: '整理并压缩当前上下文，为后续对话腾出空间。' },
    { action: 'terminal', title: '运行终端命令', label: '终端命令', icon: Terminal, description: '在当前执行环境运行 Shell 命令，输出会显示在此对话中。' }
  ];
  return <div className="conversation-tools" role="group" aria-label="对话工具">{tools.map(tool => {
    const pending = busy === tool.action, disabled = !!disabledReason || !!busy;
    return <Tooltip key={tool.action} title={tool.title} description={disabledReason || (busy ? '正在处理对话操作，请稍候。' : tool.description)} disabled={disabled}>
      <button type="button" className={`conversation-tool ${pending ? 'is-busy' : ''}`} aria-label={tool.title} aria-busy={pending} disabled={disabled} onClick={() => tool.action === 'terminal' ? onTerminal() : onAction(tool.action)}>
        {pending ? <LoaderCircle size={14} className="spin"/> : <tool.icon size={14}/>}<span className="conversation-tool-label">{pending ? tool.pending : tool.label}</span>
      </button>
    </Tooltip>;
  })}</div>;
}
function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef(), closeTimer = useRef(), closeCallback = useRef(onClose), closingRef = useRef(false);
  const [closing, setClosing] = useState(false); closeCallback.current = onClose;
  function close() { if (closingRef.current) return; closingRef.current = true; setClosing(true); closeTimer.current = setTimeout(() => closeCallback.current(), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180); }
  useEffect(() => { const previous = document.activeElement; ref.current?.focus(); const fn = e => { if (e.key === 'Escape') close(); if (e.key === 'Tab') { const els = [...ref.current.querySelectorAll('button,input,textarea,select,a[href],[tabindex]')].filter(x => !x.disabled && x.tabIndex >= 0 && x.getClientRects().length); if (!els.length) { e.preventDefault(); ref.current.focus(); } else if (e.shiftKey && (document.activeElement === els[0] || document.activeElement === ref.current)) { e.preventDefault(); els.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === els.at(-1)) { e.preventDefault(); els[0]?.focus(); } } }; document.addEventListener('keydown', fn); return () => { clearTimeout(closeTimer.current); document.removeEventListener('keydown', fn); previous?.focus(); }; }, []);
  return <div className={`modal-backdrop ${closing ? 'is-closing' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton title="关闭" onClick={close}><X size={19}/></IconButton></header>{children}</section></div>;
}
function App() {
  const [user, setUser] = useState(undefined), [inviteRequired, setInvite] = useState(true), [theme, setTheme] = useState(localStorage.getItem('theme-v2') || 'light');
  useEffect(() => { api('/session').then(r => { setUser(r.user); setInvite(r.inviteRequired); }).catch(() => setUser(null)); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('theme-v2', theme); }, [theme]);
  csrfToken = user?.csrf || '';
  if (user === undefined) return <div className="initial-loading"><Logo/><LoadingPlaceholder label="正在连接工作区…" rows={3}/></div>;
  return user ? <Workspace user={user} setUser={setUser} theme={theme} setTheme={setTheme}/> : <Auth onLogin={setUser} inviteRequired={inviteRequired}/>;
}
function Auth({ onLogin, inviteRequired }) {
  const [register, setRegister] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e) { e.preventDefault(); setError(''); setBusy(true); const data = Object.fromEntries(new FormData(e.target)); try { const r = await api(register ? '/register' : '/login', { method: 'POST', body: data }); onLogin(r.user); } catch (err) { setError(err.message); } finally { setBusy(false); } }
  return <main className="auth-layout"><div className="auth-brand"><Logo small/><span>STARVALLEY <b>WORKSPACE</b></span></div><section className="auth-card"><div className="auth-symbol"><Logo/></div><p className="eyebrow">YOUR IDEAS. YOUR WORKSPACE.</p><h1>{register ? '开始创造。' : '欢迎回来。'}</h1><p className="auth-intro">一个安静的空间，让想法变成代码。</p><form onSubmit={submit}><label>用户名<input name="username" autoComplete="username" required minLength={3} maxLength={32} placeholder="你的用户名" pattern="[a-zA-Z][a-zA-Z0-9_\-]{2,31}"/></label><label>密码<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 10 : 1} maxLength={128} placeholder={register ? '至少 10 个字符' : '输入密码'}/></label>{register && inviteRequired && <label>邀请码<input name="inviteCode" required autoComplete="off" placeholder="输入管理员提供的邀请码"/></label>}{error && <p className="form-error" role="alert">{error}</p>}<button className="primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : <>{register ? '创建账号' : '进入工作区'}<ArrowRight size={17}/></>}</button></form><p className="auth-switch">{register ? '已有账号？' : '还没有账号？'} <button onClick={() => { setRegister(!register); setError(''); }}>{register ? '登录' : '使用邀请码注册'}</button></p><div className="auth-assurance"><ShieldCheck size={14}/><span>独立工作区 · 安全文件存储</span></div></section><footer className="auth-footer">Starvalley Workspace · Built for making things.</footer></main>;
}
function Workspace({ user, setUser, theme, setTheme }) {
  useRowMenuDismissal();
  const [projects, setProjects] = useState([]), [threads, setThreads] = useState([]), [project, setProject] = useState(null), [thread, setThread] = useState(null), [turns, setTurns] = useState([]), [activeTurn, setActiveTurn] = useState(null), [sending, setSending] = useState(false);
  const [status, setStatus] = useState('connecting'), [sidebar, setSidebar] = useState(window.innerWidth > 800), [editor, setEditor] = useState(false), [files, setFiles] = useState([]), [tabs, setTabs] = useState([]), [selectedFile, setSelectedFile] = useState(null), [fileBusy, setFileBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [activity, setActivity] = useState({});
  const openReview = useCallback(target => { setReview({ ...target, projectId: projectRef.current?.id }); setEditor(true); }, []);
  const [listsLoading, setListsLoading] = useState(true), [threadLoading, setThreadLoading] = useState(false), [filesLoading, setFilesLoading] = useState(false), [toolBusy, setToolBusy] = useState(null), [commandBusy, setCommandBusy] = useState(false);
  const filesRequest = useRef(0), fileRequest = useRef(0), threadRequest = useRef(0), toolPending = useRef(false), commandPending = useRef(false), sidebarToggle = useRef(), sidebarRoot = useRef(), editorToggle = useRef();
  const mobile = useMediaQuery('(max-width: 800px)');
  const editorPresent = usePresence(editor), scrimPresent = usePresence(sidebar);
  const [previewEffort, setPreviewEffort] = useState(null), [modelSaving, setModelSaving] = useState(false);
  const modelPending = useRef(false);
  const [modal, setModal] = useState(null), [toast, setToast] = useState(null), [input, setInput] = useState(''), [search, setSearch] = useState(''), [progress, setProgress] = useState(null), [requests, setRequests] = useState([]), [models, setModels] = useState([]), [account, setAccount] = useState(null), [settings, setSettings] = useState(user.settings), [contextFile, setContextFile] = useState(null), [command, setCommand] = useState('');
  const socket = useRef(), threadRef = useRef(), projectRef = useRef(), activeRef = useRef(), filesInput = useRef(), folderInput = useRef(), abortUpload = useRef(), scrollRef = useRef(), autoScroll = useRef(true), firstReady = useRef(true), tabRefs = useRef(tabs);
  threadRef.current = thread; projectRef.current = project; activeRef.current = activeTurn; tabRefs.current = tabs;
  const completedTurns = useRef(new Set()), completionNotice = useRef();
  useEffect(() => {
    completionNotice.current = createCompletionNotice(document);
    return () => { completionNotice.current.dispose(); completionNotice.current = null; };
  }, []);
  const [draftAttachments,setDraftAttachments]=useState({}),[attachmentPreview,setAttachmentPreview]=useState(null),[dragging,setDragging]=useState(false);
  const attachmentPicker=useRef(),archiveInput=useRef(),sendPending=useRef(false);
  const draftKey=thread?.id||`new:${project?.id||''}`, attachments=draftAttachments[draftKey]||[];
  const notify = useCallback((message, error = false) => setToast({ message, error, key: Date.now() }), []);
  const selectedFileRef = useRef(), openFileRef = useRef(), fileActionRef = useRef(), saveFileRef = useRef(), capabilityCache = useRef({ time: 0, pending: null });
  selectedFileRef.current = selectedFile; openFileRef.current = openFile; fileActionRef.current = fileAction; saveFileRef.current = saveFile;
  const openCurrentFile = useCallback((...args) => openFileRef.current(...args), []);
  const currentFileAction = useCallback((...args) => fileActionRef.current(...args), []);
  const saveCurrentFile = useCallback(() => saveFileRef.current(), []);
  const codeChange = useCallback(content => setTabs(prev => prev.map(x => x.path === selectedFileRef.current ? { ...x, content: content || '' } : x)), []);
  const contextChange = useCallback(rel => { setContextFile(rel); if(window.innerWidth < 1100)setEditor(false); }, []);
  const messageFile = useCallback(rel => { const id=projectRef.current?.id;let local=rel.replace('/workspace/'+id+'/','');if(user.hostProjectBase)local=local.replace(user.hostProjectBase+'/'+id+'/','');if(local.startsWith('/')){notify('这是服务器目录中的文件，可通过 Codex 或服务器终端查看和修改');return;}setEditor(true);openFileRef.current(local); }, [user.hostProjectBase,notify]);
  const deltaBuffer = useRef();
  if(!deltaBuffer.current)deltaBuffer.current = createDeltaBuffer(batch => setTurns(prev => applyDeltas(prev, batch)));
  async function refreshLists() { const [p, t] = await Promise.all([api('/projects'), api('/threads')]); setProjects(p); setThreads(t); setActivity(prev => mergeActivity(prev, t.filter(thread => thread.activeTurn).map(thread => ({ threadId: thread.id, turn: thread.activeTurn })))); return { projects: p, threads: t }; }
  async function refreshFiles(p = projectRef.current) {
    if (!p) return; const request = ++filesRequest.current; setFilesLoading(true);
    try { const list = await api(`/projects/${p.id}/files`); if (projectRef.current?.id === p.id && request === filesRequest.current) setFiles(list); }
    finally { if (request === filesRequest.current) setFilesLoading(false); }
  }
  async function syncThread(t = threadRef.current) {
    if (!t) return; const request = ++threadRequest.current; setThreadLoading(true);
    try { const r = await api(`/threads/${t.id}`); if (threadRef.current?.id === t.id && request === threadRequest.current) { setActivity(prev => mergeActivity(prev, (r.thread.turns || []).map(turn => ({ threadId: t.id, turn })))); setTurns(prev=>mergeTurns(prev,r.thread.turns||[])); setThread(prev=>({...prev,title:r.thread.title||prev.title,tokenUsage:r.thread.tokenUsage||prev.tokenUsage})); setActiveTurn(current => { const running=r.thread.turns?.find(x=>x.status==='inProgress'&&!completedTurns.current.has(x.id))?.id; if(running)return running; return current&&!completedTurns.current.has(current)&&!r.thread.turns?.some(x=>x.id===current&&x.status!=='inProgress')?current:null; }); } }
    finally { if (request === threadRequest.current) setThreadLoading(false); }
  }
  function event(msg) {
    if (msg.type === 'ready') { setRequests(msg.pending || []); setActivity(prev => { const snapshot = { ...prev }, active = new Set((msg.activeTurns || []).map(entry => entry.threadId)); for (const [id, turn] of Object.entries(snapshot)) if (isRunning(turn) && !active.has(id)) delete snapshot[id]; return mergeActivity(snapshot, msg.activeTurns); }); if (!firstReady.current) { syncThread().catch(e => notify(e.message, true)); refreshFiles().catch(()=>{}); } firstReady.current = false; return; }
    if (msg.type === 'error') { notify(msg.error, true); return; }
    const e = msg.event; if (!e) return; const p = e.params || {};
    if (e.id != null) { setRequests(prev => prev.some(x => x.id === e.id) ? prev : [...prev, e]); return; }
    if (e.method === 'serverRequest/resolved') { setRequests(prev => prev.filter(x => String(x.id) !== String(p.requestId))); return; }
    if (e.method === 'connection/lost') { notify('Codex 进程已断开，下一次操作会重新连接', true); setActivity(prev => mergeActivity(prev, p.stoppedTurns)); deltaBuffer.current.flush(true); setTurns(prev => (p.stoppedTurns || []).filter(entry => entry.threadId === threadRef.current?.id).reduce((turns, entry) => mergeTurns(turns, [entry.turn]), prev)); setActiveTurn(null); return; }
    if (e.method === 'account/updated' || e.method === 'account/login/completed') { socket.current.call('account/read', { refreshToken: false }).then(setAccount).catch(()=>{}); return; }
    if (e.method === 'thread/title/updated') { setThreads(prev=>prev.map(t=>t.id===p.threadId?{...t,title:p.title}:t)); if(threadRef.current?.id===p.threadId)setThread(prev=>({...prev,title:p.title})); return; }
    if (e.method === 'turn/completed') { completionNotice.current?.complete(p); completedTurns.current.add(p.turn.id); if(completedTurns.current.size>100)completedTurns.current.delete(completedTurns.current.values().next().value); }
    if (['turn/started', 'turn/completed'].includes(e.method)) setActivity(prev => mergeActivity(prev, [{ threadId: p.threadId, turn: p.turn }]));
    const tid = p.threadId || p.thread?.id; if (tid !== threadRef.current?.id) return;
    if(e.method === 'item/completed' || e.method === 'turn/completed')deltaBuffer.current.flush(true);
    if (e.method === 'turn/started') { if(!completedTurns.current.has(p.turn.id))setActiveTurn(p.turn.id); setTurns(prev => applyLifecycle(prev,e)); }
    else if (e.method === 'turn/changes/updated') setTurns(prev => applyLifecycle(prev, e));
    else if (e.method === 'turn/plan/updated') setTurns(prev => applyLifecycle(prev, e));
    else if (e.method === 'turn/completed') { setActiveTurn(current=>current===p.turn.id?null:current); setTurns(prev => applyLifecycle(prev,e)); if (p.turn.status === 'failed') notify(p.turn.error?.message || 'Codex 执行失败，请检查账号配置', true); refreshFiles().catch(()=>{}); }
    else if (e.method === 'item/started' || e.method === 'item/completed') {
      setTurns(prev => applyLifecycle(prev,e));
      if (e.method === 'item/completed' && p.item.type === 'fileChange') refreshFiles().catch(()=>{});
    } else if (['item/agentMessage/delta','item/commandExecution/outputDelta','item/reasoning/summaryTextDelta','item/reasoning/textDelta'].includes(e.method)) {
      deltaBuffer.current.push(e);
    } else if (e.method === 'thread/tokenUsage/updated') setThread(prev => prev ? { ...prev, tokenUsage: p.tokenUsage } : prev);
    else if (e.method === 'error') notify(p.error?.message || 'Codex 请求失败', true);
  }
  useEffect(() => {
    socket.current = new LiveSocket(user, event, setStatus);
    refreshLists().then(r => { if (r.projects.length) setProject(r.projects[0]); }).catch(e => notify(e.message, true)).finally(() => setListsLoading(false));
    return () => { deltaBuffer.current.clear(); socket.current.close(); };
  }, [user.id, user.csrf]);
  useEffect(() => { if (status === 'expired') { notify('登录已过期，请重新登录', true); setUser(null); } }, [status]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(null), 7000); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    if (!sidebar || !mobile || modal) return;
    sidebarRoot.current.querySelector('button')?.focus();
    const keydown = e => {
      if (e.key === 'Escape') closeSidebar();
      if (e.key !== 'Tab') return;
      const items = [...sidebarRoot.current.querySelectorAll('button,input,summary,[tabindex]')].filter(x => !x.disabled && x.tabIndex >= 0 && x.getClientRects().length);
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0]?.focus(); }
    };
    document.addEventListener('keydown', keydown); return () => document.removeEventListener('keydown', keydown);
  }, [sidebar, mobile, modal]);
  useEffect(() => { if (project) refreshFiles(project).catch(e => notify(e.message, true)); }, [project?.id]);
  useEffect(() => { if (autoScroll.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'instant' }); }, [turns, activeTurn]);
  useEffect(() => { const fn = e => { if (e.defaultPrevented) return; if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (!review) saveFileRef.current(); } }; window.addEventListener('keydown', fn); return () => window.removeEventListener('keydown', fn); }, [review]);
  async function loadCapabilities(force = false) {
    const cache = capabilityCache.current;
    if(cache.pending)return cache.pending;
    if(force !== true && Date.now() - cache.time < 60000)return true;
    cache.pending = (async () => { try { const [m, a] = await Promise.all([socket.current.call('model/list', { limit: 100 }), socket.current.call('account/read', { refreshToken: false })]); setModels(m.data || []); setAccount(a); cache.time = Date.now(); return true; } catch (e) { notify(e.message, true); return false; } finally {cache.pending = null;} })();
    return cache.pending;
  }
  async function newProject(name) { const p = await api('/projects', { method: 'POST', body: { name } }); setProjects(prev => [p, ...prev]); chooseProject(p); setModal(null); notify('项目已创建'); }
  function hasDirtyTabs() { return tabs.some(t => t.content !== t.original); }
  function resetConversation() { setReview(null); deltaBuffer.current.clear(); threadRef.current = null; ++threadRequest.current; setThreadLoading(false); setThread(null); setTurns([]); setActiveTurn(null); setDragging(false); }
  function closeSidebar() { setSidebar(false); requestAnimationFrame(() => sidebarToggle.current?.focus()); }
  function closeEditor() { setEditor(false); requestAnimationFrame(() => editorToggle.current?.focus()); }
  function chooseProject(p) { if (p.id !== project?.id && hasDirtyTabs() && !window.confirm('有未保存的修改，切换项目会丢弃这些修改。继续？')) return; projectRef.current = p; setProject(p); resetConversation(); ++fileRequest.current; setFileBusy(false); setTabs([]); setSelectedFile(null); setFiles([]); setContextFile(null); if (window.innerWidth < 800) closeSidebar(); }
  async function chooseThread(t) {
    const p = projects.find(x => x.id === t.project_id); if (!p) return;
    if (p.id !== project?.id && hasDirtyTabs() && !window.confirm('有未保存的修改，继续切换？')) return;
    if (p.id !== project?.id) { projectRef.current = p; setProject(p); ++fileRequest.current; setFileBusy(false); setTabs([]); setSelectedFile(null); setFiles([]); }
    setReview(null); deltaBuffer.current.clear(); setThread(t); threadRef.current = t; setTurns([]); setActiveTurn(null); autoScroll.current = true;
    if (window.innerWidth < 800) closeSidebar();
    try { await syncThread(t); } catch (e) { notify(e.message, true); }
  }
  async function sendMessage(e) {
    e?.preventDefault(); if ((!input.trim()&&!attachments.length) || sendPending.current || progress || activeTurn || modelPending.current || threadLoading || toolPending.current || commandPending.current) return; if (!project) { setModal('project'); return; }
    sendPending.current=true;setSending(true);const key=draftKey,selected=[...attachments];const text = contextFile ? `请结合项目文件 ${contextFile}：\n\n${input.trim()}` : input.trim();
    try {
      let t = thread;
      if (!t) { t = await api('/threads', { method: 'POST', body: { projectId: project.id, title: input.trim().slice(0, 50) } }); setThread(t); threadRef.current = t; setThreads(prev => [t, ...prev]); }
      autoScroll.current = true;
      setDraftAttachments(prev=>({...prev,[key]:[],[t.id]:selected}));
      abortUpload.current=new AbortController();
      for (const item of selected) {
        if(item.saved)continue;
        const [result]=await socket.current.upload({scope:'attachment',threadId:t.id},[item.file],setProgress,abortUpload.current.signal);
        item.saved=result.attachment;
        setDraftAttachments(prev=>({...prev,[t.id]:selected.map(x=>({...x}))}));
      }
      setProgress(null);
      const result = await socket.current.call('turn/start', { threadId: t.id, text, attachments:selected.map(x=>x.saved.id) });
      setActivity(prev => mergeActivity(prev, [{ threadId: t.id, turn: result.turn }]));
      setDraftAttachments(prev=>({...prev,[t.id]:[]}));
      if(threadRef.current?.id===t.id) { setTurns(prev=>mergeTurns(prev,[result.turn])); setActiveTurn(result.turn.status==='inProgress'&&!completedTurns.current.has(result.turn.id)?result.turn.id:null); setInput(''); setContextFile(null); }
    } catch (e) { notify(e.message, true); } finally { setSending(false);sendPending.current=false;setProgress(null); }
  }
  function addAttachments(list) {
    if(sending||progress)return;
    if(list.some(file=>file.size>20*1024*1024)){notify('聊天附件大小上限为 20 MB',true);return;}
    if(attachments.length+list.length>10){notify('每轮最多 10 个附件',true);return;}
    setDraftAttachments(prev=>({...prev,[draftKey]:[...(prev[draftKey]||[]),...list.map(file=>({id:crypto.randomUUID(),name:file.name,size:file.size,file}))]}));
  }
  async function removeAttachment(item) {
    try {if(item.saved)await api(`/attachments/${item.saved.id}`,{method:'DELETE'});setDraftAttachments(prev=>({...prev,[draftKey]:(prev[draftKey]||[]).filter(x=>x.id!==item.id)}));}catch(e){notify(e.message,true);}
  }
  async function updateSettings(s) { try { const result = await api('/settings', { method: 'PUT', body: s }); setSettings(result); } catch (e) { notify(e.message, true); throw e; } }
  async function upload(e) {
    const list = [...(e.target.files || [])]; e.target.value = ''; if (!list.length || !project) return;
    if(progress||sendPending.current)return;
    const targetProject = project; abortUpload.current = new AbortController(); setProgress({ name: list[0].name, done: 0, total: list.reduce((n,f)=>n+f.size,0), index: 1, count: list.length });
    try {
      const folder=list.some(file=>file.webkitRelativePath), archive=e.target===archiveInput.current;
      let uploadFiles=list;
      if(folder){setProgress(p=>({...p,phase:'正在压缩文件夹'}));uploadFiles=[await zipFolder(list,abortUpload.current.signal,(index,count)=>setProgress(p=>({...p,index,count,phase:'正在压缩文件夹'})))];}
      const results=await socket.current.upload({projectId:targetProject.id,extract:folder||archive},uploadFiles,setProgress,abortUpload.current.signal);
      notify(folder||archive?`已解压 ${results.reduce((n,r)=>n+(r.extracted||0),0)} 个文件或目录`:`${list.length} 个文件上传完成`);
    } catch (e) { notify(e.message, true); } finally { setProgress(null); await refreshFiles(targetProject).catch(()=>{}); }
  }
  async function openFile(rel, reload = false) {
    setReview(null);
    if (!reload && tabs.find(t => t.path === rel)) { ++fileRequest.current; setFileBusy(false); setSelectedFile(rel); setEditor(true); return; }
    const target = projectRef.current; if (!target) return; const request = ++fileRequest.current; setFileBusy(true); setEditor(true);
    try { const data = await api(`/projects/${target.id}/file?path=${encodeURIComponent(rel)}`); if (target.id !== projectRef.current?.id || request !== fileRequest.current) return; const tab = { path: rel, content: data.content, original: data.content, etag: data.etag }; setTabs(prev => prev.some(x => x.path === rel) ? prev.map(x => x.path === rel ? tab : x) : [...prev, tab]); setSelectedFile(rel); } catch (e) { notify(e.message, true); } finally { if (request === fileRequest.current) setFileBusy(false); }
  }
  async function saveFile() {
    const file = tabRefs.current.find(x => x.path === selectedFile); if (!file || file.content === file.original) return;
    try { const data = await api(`/projects/${project.id}/file`, { method: 'PUT', body: { path: file.path, content: file.content, etag: file.etag } }); setTabs(prev => prev.map(x => x.path === file.path ? { ...x, original: file.content, etag: data.etag } : x)); notify('文件已保存'); } catch (e) { notify(e.message, true); }
  }
  function closeTab(rel) { const tab = tabs.find(x => x.path === rel); if (tab.content !== tab.original && !window.confirm('文件尚未保存，确认关闭？')) return; const next = tabs.filter(x => x.path !== rel); setTabs(next); if (selectedFile === rel) setSelectedFile(next.at(-1)?.path || null); }
  async function fileAction(action, rel) {
    try {
      if (action === 'delete') { if (!window.confirm(`确认删除“${rel}”及其内容？`)) return; await api(`/projects/${project.id}/file`, { method: 'DELETE', body: { path: rel } }); setTabs(prev => prev.filter(t => t.path !== rel && !t.path.startsWith(rel + '/'))); if (selectedFile === rel || selectedFile?.startsWith(rel + '/')) setSelectedFile(null); }
      if (action === 'rename') { const to = window.prompt('输入新路径', rel); if (!to || to === rel) return; if (tabs.some(t => t.path === rel && t.content !== t.original)) throw new Error('请先保存或关闭该文件'); await api(`/projects/${project.id}/file`, { method: 'PATCH', body: { from: rel, to } }); setTabs(prev => prev.map(t => t.path === rel || t.path.startsWith(rel + '/') ? { ...t, path: to + t.path.slice(rel.length) } : t)); if (selectedFile === rel || selectedFile?.startsWith(rel + '/')) setSelectedFile(to + selectedFile.slice(rel.length)); }
      if (action === 'newFile' || action === 'newFolder') { const name = window.prompt(action === 'newFile' ? '文件路径，例如 src/main.py' : '文件夹路径'); if (!name) return; await api(`/projects/${project.id}/${action === 'newFile' ? 'file' : 'directory'}`, { method: action === 'newFile' ? 'PUT' : 'POST', body: { path: name, content: '' } }); if (action === 'newFile') await openFile(name); }
      await refreshFiles();
    } catch (e) { notify(e.message, true); }
  }
  async function threadAction(action, t = thread) {
    if (!t) return;
    const tracked = ['fork', 'compact'].includes(action);
    if (tracked && (toolPending.current || commandPending.current || threadLoading || sending || activeTurn || status !== 'connected')) return;
    if (tracked) { toolPending.current = true; setToolBusy(action); }
    try {
      if (action === 'rename') { const title = window.prompt('对话标题', t.title); if (!title) return; await api(`/threads/${t.id}`, { method: 'PATCH', body: { title } }); }
      if (action === 'archive') { if (!window.confirm('将这个对话归档？')) return; await api(`/threads/${t.id}/archive`, { method: 'POST' }); if (thread?.id === t.id) { setThread(null); setTurns([]); } }
      if (action === 'fork') { const r = await socket.current.call('thread/fork', { threadId: t.id }); const lists = await refreshLists(); const fork = lists.threads.find(x => x.id === r.thread.id); if (fork && threadRef.current?.id === t.id) await chooseThread(fork); notify('对话分支已创建'); return; }
      if (action === 'compact') { await socket.current.call('thread/compact/start', { threadId: t.id }); notify('已开始压缩对话上下文'); }
      await refreshLists();
    } catch (e) { notify(e.message, true); }
    finally { if (tracked) { toolPending.current = false; setToolBusy(null); } }
  }
  const tab = tabs.find(x => x.path === selectedFile), visibleThreads = threads.filter(t => (!project || t.project_id === project.id) && t.title.toLowerCase().includes(search.toLowerCase()));
  return <div className={`workspace ${sidebar ? 'sidebar-open' : ''} ${editor ? 'editor-open' : ''}`}>
    {scrimPresent && <div className={`mobile-scrim ${sidebar ? '' : 'is-closing'}`} aria-hidden="true" onClick={closeSidebar}/>}
    <aside className="sidebar" id="workspace-sidebar" ref={sidebarRoot} role={mobile ? "dialog" : undefined} aria-modal={mobile&&sidebar ? true : undefined} aria-label="工作区侧栏" aria-hidden={!sidebar} inert={!sidebar}><div className="sidebar-content"><div className="sidebar-brand"><Logo small/><span>Starvalley <b>Codex</b></span><IconButton title="收起侧栏" onClick={closeSidebar}><PanelLeft size={17}/></IconButton></div><button className="new-chat" onClick={()=>{resetConversation();if(window.innerWidth<800)closeSidebar();}}><Plus size={18}/>新对话<span>⌘ K</span></button><div className="sidebar-search"><Search size={15}/><input aria-label="搜索对话" placeholder="搜索对话" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <div className="sidebar-section"><span>项目空间</span><IconButton title="新建项目" onClick={()=>setModal('project')}><Plus size={16}/></IconButton></div><nav className="project-list" aria-label="项目列表">{projects.map(p=><button key={p.id} className={`project-item ${p.id===project?.id?'selected':''}`} onClick={()=>chooseProject(p)}><Folder size={16}/><span>{p.name}</span>{p.id===project?.id&&<span className="project-dot"/>}</button>)}{listsLoading&&<LoadingPlaceholder label="正在读取项目…" variant="list" rows={3}/>} {!listsLoading&&!projects.length&&<button className="add-project" onClick={()=>setModal('project')}><Plus size={15}/>创建你的第一个项目</button>}</nav>
      <div className="sidebar-section conversation-label"><span>最近对话</span><span>{visibleThreads.length}</span></div><nav className="conversation-list" aria-label="对话列表">{visibleThreads.map(t=><div key={t.id} className={`thread-row ${t.id===thread?.id?'selected':''}`}><button onClick={()=>chooseThread(t)}><MessageSquare size={14}/><span>{t.title}</span></button>{isRunning(activity[t.id])&&<span className="thread-activity" role="status" aria-label="Codex 正在思考" title="Codex 正在思考"><LoaderCircle size={14} className="spin" aria-hidden="true"/></span>}<RowMenu label="对话操作"><button onClick={()=>threadAction('rename',t)}><Pencil size={13}/>重命名</button><button onClick={()=>threadAction('archive',t)}><Archive size={13}/>归档</button></RowMenu></div>)}{listsLoading&&<LoadingPlaceholder label="正在读取对话…" variant="list" rows={5}/>} {!listsLoading&&!visibleThreads.length&&<p className="sidebar-empty">你的创作，会从这里开始。</p>}</nav>
      <div className="sidebar-bottom"><button className="user-profile" disabled={modelSaving} onClick={()=>{setModal('settings');loadCapabilities();}}><div className="avatar">{user.username.slice(0,1).toUpperCase()}</div><div><strong>{user.username}</strong><span>{roleName(user.role)}</span></div><Settings size={17}/></button></div>
    </div></aside>
    <main className="main" inert={mobile&&sidebar} aria-hidden={mobile&&sidebar}><header className="topbar"><div className="topbar-left"><IconButton title={sidebar ? "收起侧栏" : "展开侧栏"} buttonRef={sidebarToggle} aria-expanded={sidebar} aria-controls="workspace-sidebar" onClick={()=>setSidebar(!sidebar)}><PanelLeft size={19}/></IconButton><span className="workspace-name">{project?.name||'个人工作区'}</span><ChevronRight size={14} className="muted"/><span className="breadcrumb">{thread?.title||'新对话'}</span></div><div className="topbar-right"><span className={`connection ${status}`}><i/>{status==='connected'?'已连接':status==='connecting'?'连接中':'正在重连'}</span><IconButton title="网页终端" disabled={!project} onClick={()=>setModal('liveTerminal')}><Terminal size={17}/></IconButton><button className={`view-toggle ${editor?'active':''}`} aria-expanded={editor} aria-controls="workspace-editor" ref={editorToggle} onClick={()=>setEditor(!editor)}><Code2 size={16}/><span>代码</span></button><IconButton title="设置" disabled={modelSaving} onClick={()=>{setModal('settings');loadCapabilities();}}><Settings size={18}/></IconButton></div></header>
      <div className="work-body"><section className="chat-panel"><div className="chat-scroll" ref={scrollRef} onScroll={e=>{autoScroll.current=e.target.scrollHeight-e.target.scrollTop-e.target.clientHeight<100;}}>
        {threadLoading&&!turns.length?<div className="messages conversation-loading"><LoadingPlaceholder label="正在读取对话…" variant="conversation" rows={6}/></div>:!thread||!turns.length?<div className="welcome"><div className="welcome-symbol"><Logo/></div><div className="welcome-kicker">LET'S BUILD SOMETHING</div><h1>今天，想创造些什么？</h1><p>{project?`在 ${project.name} 中，和 Codex 一起把想法写成代码。`:'创建一个项目，开始你的下一次创作。'}</p><div className="suggestion-grid">{[{icon:Code2,title:'从一个想法开始',text:'帮我梳理项目需求，并制定一个可执行的开发计划。'},{icon:Search,title:'读懂现有代码',text:'请分析项目结构，介绍关键模块及其工作方式。'},{icon:ShieldCheck,title:'发现并修复问题',text:'请检查项目代码中可能存在的 bug，说明原因并给出修复。'},{icon:Sparkles,title:'把体验再打磨一下',text:'请检查项目的用户体验，提出并实现最有价值的改进。'}].map(s=><button key={s.title} onClick={()=>setInput(s.text)}><s.icon size={18}/><strong>{s.title}</strong><span>{s.text}</span><ArrowRight size={14}/></button>)}</div>{!project&&<button className="primary welcome-create" onClick={()=>setModal('project')}><Plus size={16}/>创建项目</button>}</div>:<div className="messages" key={thread?.id}>{turns.map(turn=><div key={turn.id} className="turn"><TurnMessages threadId={thread?.id} turn={turn} onFile={messageFile} notify={notify} onAttachment={setAttachmentPreview} onReview={openReview}/><ThinkingStatus turn={turn}/>{turn.status==='failed'&&<p className="turn-error">{turn.error?.message||'本轮执行失败'}</p>}</div>)}{sending&&!activeTurn&&<ThinkingStatus sending/>}{threadLoading&&<LoadingPlaceholder label="正在同步对话…" variant="list" rows={2}/>}</div>}
      </div>
      <div className="composer-zone">{requests.filter(r=>!r.params?.threadId||r.params.threadId===thread?.id).map(r=><Approval key={r.id} request={r} socket={socket.current} notify={notify} onDone={()=>setRequests(prev=>prev.filter(x=>x.id!==r.id))}/>)}<div className="composer-toolbar">{thread&&<ConversationTools thread={thread} busy={toolBusy} disabledReason={threadLoading ? "正在读取对话，请稍候。" : sending || activeTurn ? "请等待当前任务结束后再操作。" : commandBusy ? "终端命令正在执行，请稍候。" : status!=="connected" ? "连接恢复后即可使用对话工具。" : ""} onAction={threadAction} onTerminal={()=>setModal("terminal")}/>}
        <div className="composer-meters">{thread&&<ContextUsage usage={thread.tokenUsage}/>}<UsageOverview api={api} socket={socket.current} Dialog={Modal}/></div></div>
        <form className={`composer ${dragging?'is-dragging':''}`} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';setDragging(true);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);addAttachments([...e.dataTransfer.files]);}} data-effort={effortTone(previewEffort || settings.effort)} onSubmit={sendMessage}>{dragging&&<div className="attachment-drop-hint"><Paperclip size={18}/>松开文件，添加到此次对话</div>}<AttachmentList items={attachments} onPreview={setAttachmentPreview} onRemove={removeAttachment} disabled={sending}/>{contextFile&&<div className="context-chip"><File size={12}/>{contextFile}<IconButton title="取消文件上下文" onClick={()=>setContextFile(null)}><X size={12}/></IconButton></div>}<textarea onPaste={e=>{const files=[...e.clipboardData.items].filter(x=>x.kind==='file').map(x=>x.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();addAttachments(files);const text=e.clipboardData.getData('text/plain');if(text)setInput(prev=>prev+text);}}} aria-label="发送消息" placeholder={project?'向 Codex 描述你的想法，或输入具体任务…':'先创建一个项目，再开始对话…'} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();sendMessage();}}} rows={Math.min(5,Math.max(2,input.split('\n').length))}/><div className="composer-bottom"><div className="composer-options"><IconButton title="添加对话附件" disabled={!project||!!progress||sending} onClick={()=>attachmentPicker.current.click()}><Plus size={19}/></IconButton><PermissionPicker settings={settings} nestedSandbox={user.nestedSandbox} role={user.role} hostExecution={user.hostExecution} onChange={updateSettings} disabled={sending||!!activeTurn||modelSaving}/><button type="button" disabled={modelSaving} className={`mode-pill ${settings.mode==='plan'?'enabled':''}`} onClick={()=>updateSettings({...settings,mode:settings.mode==='plan'?'default':'plan'}).catch(()=>{})}>{settings.mode==='plan'?'计划模式':'执行模式'}</button></div><div className="composer-actions"><ModelPicker settings={settings} models={models} onLoad={loadCapabilities} onChange={updateSettings} onPreview={setPreviewEffort} onSaving={busy=>{modelPending.current=busy;setModelSaving(busy);}} disabled={sending||!!activeTurn||status!=='connected'}/>{activeTurn?<button type="button" className="send-button stop" aria-label="停止生成" onClick={()=>socket.current.call('turn/interrupt',{threadId:thread.id,turnId:activeTurn}).catch(e=>notify(e.message,true))}><Square size={14} fill="currentColor"/></button>:<button className="send-button" aria-label="发送" disabled={(!input.trim()&&!attachments.length)||sending||!!progress||modelSaving||threadLoading||!!toolBusy||commandBusy||status!=='connected'}>{sending?<LoaderCircle className="spin" size={17}/>:<ArrowUp size={19}/>}</button>}</div></div></form>
      </div></section>
      {editorPresent&&<section className={`editor-panel ${review ? 'editor-review' : ''} ${editor ? '' : 'is-closing'}`} id="workspace-editor" aria-label="项目代码" aria-hidden={!editor} inert={!editor}><div className="editor-title"><Code2 size={16}/><strong>{review ? "变更审阅" : "项目代码"}</strong><span>{project?.name}</span>{review&&<button type="button" className="review-return-files" onClick={()=>setReview(null)}>文件视图</button>}<IconButton title="关闭代码面板" onClick={closeEditor}><X size={17}/></IconButton></div><>{review?<Suspense fallback={<LoadingPlaceholder label="正在加载变更审阅…" variant="code" rows={9}/>}><ChangesReview key={`${review.threadId}:${review.turnId}:${review.path||"all"}`} review={review} summary={turns.find(turn=>turn.id===review.turnId)?.changes} api={api} onSelect={path=>setReview(current=>current?{...current,path}:null)} onFile={openCurrentFile}/></Suspense>:<div className="editor-body"><aside className="file-explorer"><div className="explorer-heading"><span>资源管理器</span><div><IconButton title="新建文件" disabled={!project} onClick={()=>fileAction('newFile')}><Plus size={14}/></IconButton><IconButton title="刷新文件树" disabled={!project||filesLoading} onClick={()=>refreshFiles().catch(e=>notify(e.message,true))}><RefreshCw size={13} className={filesLoading ? 'spin' : ''}/></IconButton></div></div>{project?<>{filesLoading&&!files.length?<LoadingPlaceholder label="正在读取文件…" variant="list" rows={6}/>:<FileTree entries={files} onOpen={openCurrentFile} selected={selectedFile} onAction={currentFileAction} onContext={contextChange} project={project}/>} {!filesLoading&&!files.length&&<div className="files-empty"><FolderOpen size={25}/><p>项目还是空的</p><button onClick={()=>filesInput.current.click()}>上传你的第一个文件</button></div>}</>:<p className="files-empty">先选择一个项目</p>}<div className="explorer-footer"><button disabled={!project||!!progress||sending} onClick={()=>filesInput.current.click()}><Upload size={14}/>上传文件</button><button disabled={!project||!!progress||sending} onClick={()=>folderInput.current.click()}><Upload size={14}/>上传文件夹</button><button disabled={!project||!!progress||sending} onClick={()=>archiveInput.current.click()}><Archive size={14}/>上传 ZIP 并解压</button><button disabled={!project} onClick={()=>fileAction('newFolder')}><Folder size={14}/>新建文件夹</button>{project&&<a href={`/api/projects/${project.id}/download`}><Download size={14}/>下载整个项目</a>}</div></aside><div className="editor-content"><div className="editor-tabs">{tabs.map(t=><div key={t.path} className={`editor-tab ${t.path===selectedFile?'active':''}`}><button onClick={()=>setSelectedFile(t.path)}><File size={13}/>{t.path.split('/').pop()}{t.content!==t.original&&<i/>}</button><IconButton title="关闭文件" onClick={()=>closeTab(t.path)}><X size={12}/></IconButton></div>)}</div>{fileBusy?<LoadingPlaceholder label="正在读取文件内容…" variant="code" rows={9}/>:tab?<><div className="file-toolbar"><span>{tab.path}</span><IconButton title="重新加载（丢弃修改）" onClick={()=>{if(tab.content===tab.original||window.confirm('重新加载将丢弃未保存的修改，继续？'))openFile(tab.path,true);}}><RefreshCw size={14}/></IconButton><IconButton title="添加到对话上下文" onClick={()=>setContextFile(tab.path)}><MessageSquare size={14}/></IconButton><a title="下载文件" className="icon-button" href={`/api/projects/${project.id}/download?path=${encodeURIComponent(tab.path)}`}><Download size={14}/></a><button className="save-file" onClick={saveFile} disabled={tab.content===tab.original}><Save size={13}/>保存</button></div><div className="monaco-container"><Suspense fallback={<LoadingPlaceholder label="正在加载编辑器…" variant="code" rows={9}/>}><CodeEditor file={`${project.id}/${tab.path}`} content={tab.content} onChange={codeChange} onSave={saveCurrentFile} theme={theme}/></Suspense></div><div className="editor-status"><span>{tab.content===tab.original?'所有更改已保存':'有未保存的修改'}</span><span>UTF-8 · {tab.path.split('.').pop()} · Ctrl+S 保存</span></div></>:<div className="editor-placeholder"><Code2 size={40} strokeWidth={1}/><h3>让代码与对话在一起</h3><p>从左侧选择一个文件来查看和编辑。</p><div><kbd>Ctrl</kbd> + <kbd>S</kbd><span>保存更改</span></div></div>}</div></div>}</></section>}
      </div>
    </main>
    {attachmentPreview&&<AttachmentPreview key={attachmentPreview.id || attachmentPreview.url} item={attachmentPreview} api={api} Dialog={Modal} onClose={()=>setAttachmentPreview(null)}/>}<input hidden ref={attachmentPicker} type="file" multiple onChange={e=>{addAttachments([...e.target.files]);e.target.value='';}}/><input hidden ref={archiveInput} type="file" multiple accept=".zip,application/zip" onChange={upload}/><input hidden ref={filesInput} type="file" multiple onChange={upload}/><input hidden ref={folderInput} type="file" multiple webkitdirectory="" onChange={upload}/>
    {progress&&<div className="upload-progress"><Upload size={17}/><div><strong>{progress.phase||'正在上传'} {progress.index}/{progress.count}</strong><span>{progress.name} · {bytes(progress.done)} / {bytes(progress.total)}</span><div className="progress-bar"><i style={{width:`${progress.total?progress.done/progress.total*100:0}%`}}/></div></div><IconButton title="取消上传" onClick={()=>abortUpload.current.abort()}><X size={16}/></IconButton></div>}
    {toast&&<div className={`toast ${toast.error?'error':''}`} role="status">{toast.error?<ShieldCheck size={16}/>:<Check size={16}/>}<span>{toast.message}</span><IconButton title="关闭提示" onClick={()=>setToast(null)}><X size={14}/></IconButton></div>}
    {modal==='project'&&<Modal title="新建项目" subtitle="每个项目都是一个独立的创作空间。" onClose={()=>setModal(null)}><form className="modal-form" onSubmit={async e=>{e.preventDefault();try{await newProject(new FormData(e.target).get('name'));}catch(e){notify(e.message,true);}}}><label>项目名称<input name="name" required autoFocus maxLength={80} placeholder="例如：我的个人网站"/></label><p className="field-hint">创建后，你可以上传现有代码，或让 Codex 从头开始。</p><button className="primary full"><Plus size={16}/>创建项目</button></form></Modal>}
    {modal==='settings'&&<SettingsPanel user={user} settings={settings} onSettings={updateSettings} theme={theme} setTheme={setTheme} socket={socket.current} models={models} account={account} reload={()=>loadCapabilities(true)} notify={notify} onClose={()=>setModal(null)} onLogout={async()=>{await api('/logout',{method:'POST'});setUser(null);}}/>}
    {modal==='liveTerminal'&&project&&<Modal title="网页终端" subtitle={settings.executionTarget==='server'?'服务器 root 终端，可以操作系统文件和服务。':'你的独立项目终端，只能修改自己的工作区。输入 codex 即可启动。'} wide onClose={()=>setModal(null)}><Suspense fallback={<LoadingPlaceholder label="正在加载终端…" variant="code" rows={8}/>}><TerminalView socket={socket.current} project={project} notify={notify} theme={theme}/></Suspense></Modal>}{modal==='terminal'&&<Modal title="项目终端" subtitle={settings.executionTarget==='server'?'命令会以 root 权限在服务器执行，输出显示在对话里。':'命令会在你的独立用户工作区执行，输出显示在对话里。'} onClose={()=>setModal(null)}><form className="modal-form" onSubmit={async e=>{e.preventDefault();if(commandPending.current||!thread||!command.trim())return;commandPending.current=true;setCommandBusy(true);try{await socket.current.call('thread/shellCommand',{threadId:thread.id,command,timeoutMs:60000});setModal(current=>current==='terminal'?null:current);}catch(e){notify(e.message,true);}finally{commandPending.current=false;setCommandBusy(false);}}}><label>Shell 命令<textarea className="code-input" value={command} onChange={e=>setCommand(e.target.value)} placeholder="git status --short" rows={3} required/></label><button className="primary full" disabled={commandBusy||!command.trim()||status!=="connected"}>{commandBusy?<LoaderCircle size={15} className="spin"/>:<Terminal size={15}/>} {commandBusy?"执行中…":"执行命令"}</button></form></Modal>}
  </div>;
}
const Message = memo(function Message({ item, onFile, notify, onAttachment, threadId }) {
  const [expanded,setExpanded]=useState(false);
  if (item.type === 'userMessage') { const text = item.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')||item.text||''; const long=text.length>700||text.split('\n').length>10;return <div className="user-message"><div><div className={long&&!expanded?'user-text is-collapsed':'user-text'}>{text}</div>{long&&<button type="button" className="expand-message" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'收起':'展开全部'}<ChevronDown size={13}/></button>}<AttachmentList items={item.attachments} onPreview={onAttachment}/></div></div>; }
  if (item.type === 'agentMessage') return <article className="agent-message"><div className="message-avatar"><img src={chatgptLogo} alt="ChatGPT" width={29} height={29}/></div><div className="message-body"><div className="message-author">Codex</div><div className="markdown"><Markdown text={item.text} threadId={threadId} onFile={onFile} notify={notify} onPreview={onAttachment}/></div>{item.text&&<div className="message-actions"><IconButton title="复制消息" onClick={()=>navigator.clipboard.writeText(item.text).then(()=>notify('已复制')).catch(()=>notify('复制失败',true))}><Copy size={14}/></IconButton></div>}</div></article>;
  if (item.type === 'imageGeneration') return <GeneratedImage item={item} onPreview={onAttachment}/>;
  if (item.type === 'reasoning') { const text=reasoningText(item); return text?<details className="tool-item reasoning"><summary><Sparkles size={14}/><span>思考过程</span><ChevronDown size={13}/></summary><div className="markdown"><Markdown text={text} threadId={threadId} onFile={onFile} notify={notify} onPreview={onAttachment}/></div></details>:null; }
  if (item.type === 'commandExecution') return <details className="tool-item"><summary><Terminal size={14}/><code>{item.command}</code><span className="tool-status">{item.status==='inProgress'?'执行中':item.exitCode===0?'完成':item.status==='declined'?'已拒绝':`退出 ${item.exitCode??''}`}</span></summary><pre className="terminal-output">{item.aggregatedOutput||'等待命令输出…'}</pre></details>;
  if (item.type === 'fileChange') return <details className="tool-item file-change" open><summary><File size={14}/><span>文件更改</span><span className="tool-status">{item.status==='completed'?'已完成':item.status==='declined'?'已拒绝':'处理中'}</span></summary><div>{item.changes?.map((c,i)=><div key={i}><button onClick={()=>onFile(c.path)}><File size={13}/>{c.path.split('/').slice(-2).join('/')}</button><span>{typeof c.kind==='string'?c.kind:c.kind?.type}</span>{c.diff&&<details><summary>查看差异</summary><pre className="diff-output">{c.diff}</pre></details>}</div>)}</div></details>;
  if (item.type === 'plan') return <div className="plan-item"><Sparkles size={15}/><div className="markdown"><Markdown text={item.text||item.plan||''} threadId={threadId} onFile={onFile} notify={notify} onPreview={onAttachment}/></div></div>;
  if (item.type === 'contextCompaction') return <div className="tool-note"><RefreshCw size={13}/>对话上下文已压缩</div>;
  if (item.type === 'enteredReviewMode' || item.type === 'exitedReviewMode') return <div className="tool-note"><ShieldCheck size={13}/>{item.type==='enteredReviewMode'?'开始审查':'审查完成'}{item.review&&<div className="markdown"><Markdown text={item.review} threadId={threadId} onFile={onFile} notify={notify} onPreview={onAttachment}/></div>}</div>;
  if (item.type === 'sleep') return <div className="tool-note"><LoaderCircle size={13}/>等待 {Math.ceil((item.durationMs||0)/1000)} 秒</div>;
  if (toolContent(item).some(contentImage)) return <div className="visible-tool-output"><ToolOutput item={item} threadId={threadId} onFile={onFile} notify={notify} onPreview={onAttachment}/></div>;
  return <details className="tool-item"><summary><Sparkles size={14}/><span>{item.tool||item.name||item.query||item.type}</span><span className="tool-status">{item.status||''}</span></summary><ToolOutput item={item} threadId={threadId} onFile={onFile} notify={notify} onPreview={onAttachment}/></details>;
});
function TurnMessages({turn,onFile,notify,onAttachment,threadId,onReview}) {
  const items=turn.items||[],done=turn.status!=='inProgress';
  const process=isProcessItem;
  const thoughts=items.filter(process);
  const render=item=><Message key={item.id} item={item} onFile={onFile} notify={notify} onAttachment={onAttachment} threadId={threadId}/>;
  if(!done)return <>{items.map(render)}<ChangeSummary turn={turn} threadId={threadId} onReview={onReview}/></>;
  const before=items.filter(item=>item.type==='userMessage'),after=items.filter(item=>item.type!=='userMessage'&&!process(item));
  return <>{before.map(render)}{thoughts.length>0&&<details className="thought-group"><summary><Sparkles size={14}/><span>思考与执行过程</span><small>{thoughts.length} 项记录</small><ChevronDown size={14}/></summary><div>{thoughts.map(render)}</div></details>}{after.map(render)}<ChangeSummary turn={turn} threadId={threadId} onReview={onReview}/></>;
}
function Approval({ request, socket, notify, onDone }) {
  const [busy,setBusy]=useState(false),[answers,setAnswers]=useState({}),[raw,setRaw]=useState(''); const p=request.params||{};
  const input=request.method.includes('requestUserInput'), permissions=request.method.includes('permissions'), elicitation=request.method.includes('elicitation'), command=request.method.includes('commandExecution');
  async function reply(accept) { setBusy(true); try { let result;
    if(input) result={answers:Object.fromEntries((p.questions||[]).map(q=>[q.id,{answers:[answers[q.id]||q.options?.[0]?.label||'']}]))};
    else if(permissions) result={permissions:accept?p.permissions:{},scope:'turn'};
    else if(elicitation) result={action:accept?'accept':'decline',content:accept&&raw?JSON.parse(raw):null};
    else result={decision:accept?'accept':'decline'};
    await socket.call('approval/reply',{requestId:request.id,result});onDone();
  }catch(e){notify(e.message,true);}finally{setBusy(false);} }
  return <div className="approval"><div className="approval-heading"><ShieldCheck size={16}/><strong>{input?'Codex 需要你的补充':command?'允许执行这条命令？':permissions?'权限请求':elicitation?'工具需要确认':'允许这些文件更改？'}</strong></div>{p.reason&&<p>{p.reason}</p>}{p.command&&<pre>{p.command}</pre>}{input&&(p.questions||[]).map(q=><label key={q.id}>{q.question}{q.options?.length?<Select value={answers[q.id]||q.options[0].label} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}>{q.options.map(o=><option key={o.label} value={o.label}>{o.label} — {o.description}</option>)}</Select>:<input value={answers[q.id]||''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}/>}<input placeholder="或输入你的回答" value={answers[q.id]||''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}/></label>)}{elicitation&&<><p>{p.message}</p>{p.url&&<a href={p.url} target="_blank" rel="noreferrer">打开授权页面</a>}{p.requestedSchema&&<><pre>{JSON.stringify(p.requestedSchema,null,2)}</pre><textarea value={raw} onChange={e=>setRaw(e.target.value)} placeholder='以 JSON 格式填写工具所需内容'/></>}</>}{permissions&&<pre>{JSON.stringify(p.permissions,null,2)}</pre>}<div className="approval-actions">{!input&&<button disabled={busy} onClick={()=>reply(false)}>拒绝</button>}<button className="primary" disabled={busy} onClick={()=>reply(true)}>{busy?'提交中…':input?'提交回答':'允许这一次'}</button></div></div>;
}
const FileTree = memo(function FileTree({ entries, selected, onOpen, onAction, onContext, project }) {
  const [expanded,setExpanded]=useState(new Set());
  useEffect(()=>setExpanded(new Set()),[project.id]);
  const folders = useMemo(() => { const map = new Map(); for(const x of entries){ const parent = x.path.includes('/') ? x.path.slice(0,x.path.lastIndexOf('/')) : ''; if(!map.has(parent))map.set(parent,[]); map.get(parent).push(x); } for(const rows of map.values())rows.sort((a,b)=>a.type!==b.type?(a.type==='directory'?-1:1):a.name.localeCompare(b.name)); return map; }, [entries]);
  function render(parent='',depth=0) { const children=folders.get(parent)||[]; return children.map(x=><React.Fragment key={x.path}><div className={`file-row ${selected===x.path?'selected':''}`} style={{paddingLeft:8+depth*13}}><button onClick={()=>{if(x.type==='file')onOpen(x.path);else setExpanded(prev=>{const n=new Set(prev);n.has(x.path)?n.delete(x.path):n.add(x.path);return n;});}}>{x.type==='directory'?<>{expanded.has(x.path)?<ChevronDown size={12}/>:<ChevronRight size={12}/>}<Folder size={13}/></>:<><span className="file-spacer"/><File size={13}/></>}<span>{x.name}</span></button><RowMenu label={`${x.name} 操作`} size={13}>{x.type==='file'&&<button onClick={()=>onContext(x.path)}><MessageSquare size={12}/>加入对话</button>}<a href={`/api/projects/${project.id}/download?path=${encodeURIComponent(x.path)}`}><Download size={12}/>下载</a><button onClick={()=>onAction('rename',x.path)}><Pencil size={12}/>重命名</button><button className="danger-text" onClick={()=>onAction('delete',x.path)}><Trash2 size={12}/>删除</button></RowMenu></div>{x.type==='directory'&&expanded.has(x.path)&&render(x.path,depth+1)}</React.Fragment>); }
  return <div className="file-tree">{render()}</div>;
});
function SettingsPanel({ user, settings, onSettings, theme, setTheme, socket, models, account, reload, notify, onClose, onLogout }) {
  const [tab,setTab]=useState('general'),[draft,setDraft]=useState(settings),[toml,setToml]=useState(''),[loadedConfig,setLoadedConfig]=useState(false),[configError,setConfigError]=useState(false),[apiKey,setApiKey]=useState(''),[result,setResult]=useState(null),[usage,setUsage]=useState(null),[busy,setBusy]=useState(false);
  useEffect(()=>{api('/usage').then(setUsage).catch(()=>{});},[]);
  useEffect(()=>{let cancelled=false;if(tab==='advanced'&&!loadedConfig){setConfigError(false);api('/config').then(r=>{if(!cancelled){setToml(r.toml);setLoadedConfig(true);}}).catch(e=>{if(!cancelled){setConfigError(true);notify(e.message,true);}});}return()=>{cancelled=true;};},[tab]);
  async function run(fn){setBusy(true);try{await fn();}catch(e){notify(e.message,true);}finally{setBusy(false);}}
  return <Modal title="工作区设置" subtitle="让 Codex 按照你的方式工作。" onClose={onClose} wide><div className="settings-layout"><nav className="settings-nav">{[{id:'general',icon:Settings,name:'通用'},{id:'account',icon:KeyRound,name:'Codex 账号'},{id:'advanced',icon:Code2,name:'高级配置'},{id:'tools',icon:Sparkles,name:'工具与技能'},{id:'profile',icon:ShieldCheck,name:'个人账号'}].map(t=><button key={t.id} className={tab===t.id?'active':''} onClick={()=>{setTab(t.id);setResult(null);}}><t.icon size={16}/>{t.name}</button>)}</nav><div className="settings-content" key={tab}>
    {tab==='general'&&<><h3>模型与执行</h3><ModelControls models={models} value={draft} onChange={setDraft} disabled={busy}/><p className="field-hint">执行审批和文件权限可在聊天输入框旁直接选择。</p><label>对话模式<Select value={draft.mode} onChange={e=>setDraft({...draft,mode:e.target.value})}><option value="default">执行模式</option><option value="plan">计划模式</option></Select></label><label className="checkbox-label"><input type="checkbox" checked={draft.networkAccess} disabled={draft.executionTarget==='server'} onChange={e=>setDraft({...draft,networkAccess:e.target.checked})}/>允许用户容器访问网络</label><p className="field-hint">{draft.executionTarget==='server'?'当前为服务器 root 模式。返回聊天框的执行权限菜单，可切回用户工作区。':'工作区可以操作你自己的全部项目，不能修改服务器系统文件。切换网络权限会重启工作区。'}</p><div className="settings-divider"/><div className="setting-inline"><span>界面主题</span><button className="secondary" onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={15}/>:<Moon size={15}/>}切换到{theme==='dark'?'浅色':'深色'}</button></div>{usage&&<div className="usage-box"><div><span>存储空间</span><span>{bytes(usage.used)} / {bytes(usage.quota)}</span></div><div className="progress-bar"><i style={{width:`${usage.used/usage.quota*100}%`}}/></div><p>单文件上限 {bytes(usage.maxFile)}</p></div>}<button className="primary full" disabled={busy} onClick={()=>run(async()=>{await onSettings(draft);notify('设置已保存');})}>保存设置</button></>}
    {tab==='account'&&<><h3>Codex 账号</h3><div className="account-status"><KeyRound size={22}/><div><strong>{account?.account?.type==='chatgpt'?account.account.email:account?.account?.type==='apiKey'?'API Key 已配置':account?.requiresOpenaiAuth===false?'使用自定义服务商':'尚未连接 Codex 账号'}</strong><span>{account?.account?.planType||'账号凭据仅存储在你的工作区'}</span></div><IconButton title="刷新账号状态" onClick={reload}><RefreshCw size={15}/></IconButton></div><h4>使用 ChatGPT 账号</h4><ChatGPTLogin socket={socket} reload={reload} notify={notify} disabled={busy}/><div className="settings-divider"/><h4>使用 API Key</h4><label>OpenAI API Key<input type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-…"/></label><button className="primary full" disabled={busy||!apiKey} onClick={()=>run(async()=>{await socket.call('account/login/start',{type:'apiKey',apiKey});setApiKey('');reload();notify('API Key 已保存');})}>连接 API Key</button><div className="settings-divider"/><button className="secondary full" disabled={busy} onClick={()=>run(async()=>{const r=await socket.call('account/rateLimits/read');setResult(r);})}>查看 Codex 使用额度</button>{account?.account&&<button className="text-button danger-text" onClick={()=>run(async()=>{await socket.call('account/logout');reload();notify('Codex 账号已退出');})}>退出 Codex 账号</button>}{result&&<pre className="settings-result">{JSON.stringify(result,null,2)}</pre>}</>}
    {tab==='advanced'&&<><h3>完整 Codex CLI 配置</h3><p className="field-hint">这里直接编辑你工作区的 config.toml，支持自定义服务商、MCP、功能开关、配置档案及其他 CLI 设置。保存会重启该用户的 Codex 进程，请先停止运行中的任务。</p>{!loadedConfig&&(configError?<p className="form-error" role="alert">配置读取失败，请切换标签后重试。</p>:<LoadingPlaceholder label="正在读取配置…" variant="code" rows={7}/>)}<textarea hidden={!loadedConfig} className="toml-editor" aria-label="Codex TOML 配置" spellCheck="false" value={toml} onChange={e=>setToml(e.target.value)}/><button className="primary full" disabled={busy||!loadedConfig} onClick={()=>run(async()=>{await api('/config',{method:'PUT',body:{toml}});notify('配置已保存，Codex 将重新连接');reload();})}>保存并重启 Codex</button></>}
    {tab==='tools'&&<><h3>工具与技能</h3><p className="field-hint">MCP 和功能开关可以在高级配置中管理。项目内的 AGENTS.md、技能和代码会被 Codex 自动读取。</p><div className="tool-buttons">{[['skills/list','查看已安装技能'],['mcpServerStatus/list','查看 MCP 工具'],['app/list','查看连接器'],['experimentalFeature/list','查看功能开关']].map(([method,title])=><button className="secondary" disabled={busy} key={method} onClick={()=>run(async()=>{setResult(await socket.call(method,{limit:100}));})}>{title}<ChevronRight size={14}/></button>)}</div><button className="secondary full" disabled={busy} onClick={()=>run(async()=>{await socket.call('config/mcpServer/reload');notify('MCP 配置已重新加载');})}><RefreshCw size={14}/>重新加载 MCP</button>{result&&<pre className="settings-result">{JSON.stringify(result,null,2)}</pre>}</>}
    {tab==='profile'&&<><h3>个人账号</h3><div className="profile-info"><div className="avatar">{user.username[0].toUpperCase()}</div><div><strong>{user.username}</strong><p>{roleName(user.role)}</p></div></div><h4>修改密码</h4><form onSubmit={e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.target));run(async()=>{await api('/password',{method:'POST',body:values});notify('密码已修改，请重新登录');location.reload();});}}><label>原密码<input type="password" name="oldPassword" required autoComplete="current-password"/></label><label>新密码<input type="password" name="newPassword" minLength={10} maxLength={128} required autoComplete="new-password"/></label><button className="secondary full" disabled={busy}>修改密码</button></form>{['admin','superadmin'].includes(user.role)&&<><div className="settings-divider"/><UserManagement api={api} user={user} notify={notify}/>{user.role==='superadmin'&&<><div className="settings-divider"/><InviteManagement api={api} notify={notify}/></>}<button className="secondary full" onClick={()=>run(async()=>setResult(await api('/admin/audit')))}>查看操作记录</button></>}{result&&<pre className="settings-result">{JSON.stringify(result,null,2)}</pre>}<div className="settings-divider"/><button className="secondary full danger-text" onClick={()=>run(onLogout)}><LogOut size={15}/>退出登录</button></>}
  </div></div></Modal>;
}
createRoot(document.getElementById('root')).render(<App/>);
