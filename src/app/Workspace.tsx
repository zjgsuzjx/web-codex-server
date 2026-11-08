import type { Attachment } from '../../shared/contracts/domain.ts';
interface UploadSelection {
  files?: import('../../shared/contracts/domain.ts').UploadFile[];
  folder?: boolean;
  archive?: boolean;
  directories?: string[];
  dataTransfer?: DataTransfer;
}
import type { Settings } from '../../shared/contracts/domain.ts';
import {
  Archive,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  Code2,
  File,
  Folder,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelLeft,
  Paperclip,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type * as React from 'react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { olderTurnLimit, recentTurnLimit } from '../../shared/chat/history.ts';
import { isRunning, mergeActivity } from '../../shared/chat/turn-activity.ts';
import { isUserInput, keepRequestOnTurn } from '../../shared/chat/user-input.ts';
import type {
  AnswerDrafts,
  DraftAttachment,
  EditorTab,
  FileEntry,
  Project,
  SessionUser,
  Theme,
  Thread,
} from '../../shared/contracts/domain.ts';
import type { AppError } from '../../shared/contracts/errors.ts';
import type {
  ProtocolCallback,
  ProtocolRecord,
  ServerRequest,
  Turn,
} from '../../shared/contracts/protocol.ts';
import { ARCHIVE_ACCEPT, isArchive } from '../../shared/files/archive-formats.ts';
import { fileEntryLimit } from '../../shared/files/file-limits.ts';
import { createSettingsQueue } from '../../shared/settings/settings-save.ts';
import { BrandMark } from '../components/brand/BrandMark.tsx';
import useActionDialog from '../components/ui/ActionDialog.tsx';
import IconButton from '../components/ui/IconButton.tsx';
import LoadingPlaceholder from '../components/ui/LoadingPlaceholder.tsx';
import Modal from '../components/ui/Modal.tsx';
import RowMenu, { useRowMenuDismissal } from '../components/ui/RowMenu.tsx';
import Tooltip from '../components/ui/Tooltip.tsx';
import { useAppearance } from '../features/appearance/components/Appearance.tsx';
import { BrowserGraphicsNotice } from '../features/appearance/components/BrowserGraphics.tsx';
import ApprovalRequests from '../features/chat/components/ApprovalRequests.tsx';
import { AttachmentList, AttachmentPreview } from '../features/chat/components/Attachments.tsx';
import ContextUsage from '../features/chat/components/ContextUsage.tsx';
import ModelPicker from '../features/chat/components/ModelPicker.tsx';
import PermissionPicker from '../features/chat/components/PermissionPicker.tsx';
import ThinkingStatus from '../features/chat/components/ThinkingStatus.tsx';
import UserInputRequests from '../features/chat/components/UserInputRequests.tsx';
import { createCompletionNotice } from '../features/chat/lib/completion-notice.ts';
import { historyPause, mergeHistoryPage } from '../features/chat/lib/conversation-history.ts';
import {
  applyDeltas,
  applyLifecycle,
  createDeltaBuffer,
  mergeTurns,
} from '../features/chat/lib/deltas.ts';
import { effortTone } from '../features/chat/lib/model-options.ts';
import ProjectFiles from '../features/files/components/ProjectFiles.tsx';
import QuickFilePicker from '../features/files/components/QuickFilePicker.tsx';
import { UploadConflict, UploadProgress } from '../features/files/components/UploadFeedback.tsx';
import { droppedFiles } from '../features/files/lib/drop-files.ts';
import {
  closeTabState,
  hasUnapprovedTabChanges,
  isDirtyTab,
  updateTabContent,
} from '../features/files/lib/editor-tabs.ts';
import { zipFolder } from '../features/files/lib/zip-folder.ts';
import StorageManager from '../features/resources/components/StorageManager.tsx';
import UsageOverview from '../features/resources/components/UsageOverview.tsx';
import SettingsPanel from '../features/settings/components/SettingsPanel.tsx';
import SidebarUser from '../features/workspace/components/SidebarUser.tsx';
import WorkspaceToolbar from '../features/workspace/components/WorkspaceToolbar.tsx';
import MemoPanel from '../features/memo/components/MemoPanel.tsx';
import type { NotificationSnapshot } from '../../shared/workspace/notifications.ts';
import WorkspaceWelcome from '../features/workspace/components/WorkspaceWelcome.tsx';
import useConversationScroll from '../hooks/useConversationScroll.ts';
import { LiveSocket } from '../lib/socket.ts';
import type { FocusableElement } from '../types/dom.ts';
export interface WorkspaceProps {
  user: SessionUser;
  setUser: React.Dispatch<React.SetStateAction<SessionUser | null | undefined>>;
  theme: Theme;
  setTheme: React.Dispatch<React.SetStateAction<Theme>>;
}

import ConversationTools from '../features/chat/components/ConversationTools.tsx';
import { TurnMessages } from '../features/chat/components/TurnMessages.tsx';
import useMediaQuery from '../hooks/useMediaQuery.ts';
import usePresence from '../hooks/usePresence.ts';
import { api, getCsrfToken } from '../lib/api.ts';
const ChangesReview = lazy(() => import('../features/files/components/ChangesReview.tsx'));
const TerminalView = lazy(() => import('../features/terminal/components/TerminalView.tsx'));
const conversationDate = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
function conversationTime(timestamp?: number | null) {
  if (timestamp == null) return '暂无记录';
  return (
    <time dateTime={new Date(timestamp).toISOString()}>{conversationDate.format(timestamp)}</time>
  );
}
const bytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
export default function Workspace({ user, setUser, theme, setTheme }: WorkspaceProps) {
  const appearance = useAppearance();
  const updateSkins = useCallback(
    (skins: any) => setUser((current) => (current ? { ...current, skins } : current)),
    [setUser],
  );
  useRowMenuDismissal();
  const dialogs = useActionDialog();
  const favoritePending = useRef(new Set<string>());
  const [welcomeVisible, setWelcomeVisible] = useState(true),
    [welcomeError, setWelcomeError] = useState('');
  const enterWorkspace = useCallback(() => setWelcomeVisible(false), []);
  const updateAvatar = useCallback(
    (avatarUrl: any) => setUser((current) => (current ? { ...current, avatarUrl } : current)),
    [setUser],
  );
  const [projects, setProjects] = useState<Project[]>([]),
    [threads, setThreads] = useState<Thread[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [thread, setThread] = useState<Thread | null>(null),
    [turns, setTurns] = useState<Turn[]>([]),
    [activeTurn, setActiveTurn] = useState<string | null>(null),
    [sending, setSending] = useState(false);
  const [status, setStatus] =
      useState<import('../../shared/contracts/domain.ts').ConnectionStatus>('connecting'),
    [sidebar, setSidebar] = useState(window.innerWidth > 800),
    [editor, setEditor] = useState(false),
    [files, setFiles] = useState<FileEntry[]>([]),
    [tabs, setTabs] = useState<EditorTab[]>([]),
    [selectedFile, setSelectedFile] = useState<string | null>(null),
    [fileBusy, setFileBusy] = useState(false);
  const [review, setReview] = useState<ProtocolRecord | null | undefined>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationSnapshot | null>(null);
  const [memoOpen, setMemoOpen] = useState(() => {
      try {
        return localStorage.getItem(`workspace:memo:${user.id}:open`) === 'true';
      } catch {
        return false;
      }
    }),
    [memoMounted, setMemoMounted] = useState(memoOpen);
  useEffect(() => {
    try {
      localStorage.setItem(`workspace:memo:${user.id}:open`, String(memoOpen));
    } catch {
      /* Opening the panel does not require browser storage. */
    }
  }, [memoOpen, user.id]);
  const [quickOpenFocus, setQuickOpenFocus] = useState<string | null>(null);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const editorFullscreenToggle = useRef<HTMLButtonElement>(undefined!);
  const [latency, setLatency] = useState<number | null>(null),
    [answerDrafts, setAnswerDrafts] = useState<Record<string, AnswerDrafts>>({});
  const [activity, setActivity] = useState<Record<string, Turn>>({});
  const openReview = useCallback((target: any) => {
    setReview({ ...target, projectId: projectRef.current?.id });
    setEditor(true);
  }, []);
  const [listsLoading, setListsLoading] = useState(true),
    [threadLoading, setThreadLoading] = useState(false),
    [filesLoading, setFilesLoading] = useState(false),
    [toolBusy, setToolBusy] = useState<string | null>(null),
    [commandBusy, setCommandBusy] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<{ loading?: boolean; error?: string }>({}),
    [visibleFrom, setVisibleFrom] = useState<string | null>(null);
  const historyAbort = useRef<AbortController>(undefined!),
    historyRetry = useRef<(() => Promise<void>) | null>(undefined!),
    messagesRef = useRef<HTMLDivElement>(undefined!);
  const filesRequest = useRef(0),
    fileRequest = useRef(0),
    threadRequest = useRef(0),
    toolPending = useRef(false),
    commandPending = useRef(false),
    sidebarToggle = useRef<HTMLButtonElement>(undefined!),
    sidebarRoot = useRef<HTMLElement>(undefined!),
    editorToggle = useRef<HTMLButtonElement>(undefined!);
  const mobile = useMediaQuery('(max-width: 800px)');
  const editorPresent = usePresence(editor),
    scrimPresent = usePresence(sidebar);
  const [previewEffort, setPreviewEffort] = useState<string | null>(null),
    [modelSaving, setModelSaving] = useState(false);
  const modelPending = useRef(false);
  const [modal, setModal] = useState<string | null>(null),
    [toast, setToast] = useState<{ message: string; error: boolean; key: number } | null>(null),
    [input, setInput] = useState(''),
    [search, setSearch] = useState(''),
    [progress, setProgress] = useState<ProtocolRecord | null | undefined>(null),
    [requests, setRequests] = useState<ServerRequest[]>([]),
    [models, setModels] = useState<ProtocolRecord[]>([]),
    [account, setAccount] = useState<ProtocolRecord | null | undefined>(null),
    [settings, setSettings] = useState(user.settings),
    [contextFile, setContextFile] = useState<string | null>(null),
    [command, setCommand] = useState('');
  const socket = useRef<import('../lib/socket.ts').LiveSocket>(undefined!),
    threadRef = useRef<Thread | null | undefined>(undefined!),
    projectRef = useRef<Project | null | undefined>(undefined!),
    activeRef = useRef<string | null>(undefined!),
    filesInput = useRef<HTMLInputElement>(undefined!),
    folderInput = useRef<HTMLInputElement>(undefined!),
    abortUpload = useRef<AbortController>(undefined!),
    scrollRef = useRef<HTMLDivElement>(undefined!),
    autoScroll = useRef(true),
    firstReady = useRef(true),
    tabRefs = useRef(tabs);
  threadRef.current = thread;
  projectRef.current = project;
  activeRef.current = activeTurn;
  tabRefs.current = tabs;
  const completedTurns = useRef(new Set()),
    completionNotice = useRef<ReturnType<typeof createCompletionNotice> | null>(undefined!);
  useEffect(() => {
    completionNotice.current = createCompletionNotice(document);
    return () => {
      completionNotice.current!.dispose();
      completionNotice.current = null;
    };
  }, []);
  const [draftAttachments, setDraftAttachments] = useState<Record<string, DraftAttachment[]>>({}),
    [attachmentPreview, setAttachmentPreview] = useState<ProtocolRecord | null | undefined>(null),
    [dragging, setDragging] = useState(false);
  const attachmentPicker = useRef<HTMLInputElement>(undefined!),
    archiveInput = useRef<HTMLInputElement>(undefined!),
    sendPending = useRef(false);
  const projectUploadPending = useRef(false);
  const [uploadConflict, setUploadConflict] = useState<ProtocolRecord | null | undefined>(null);
  useEffect(() => () => abortUpload.current?.abort(), []);
  const draftKey = thread?.id || `new:${project?.id || ''}`,
    attachments = draftAttachments[draftKey] || [];
  const notify = useCallback(
    (message: any, error = false) => setToast({ message, error, key: Date.now() }),
    [],
  );
  const settingsQueue = useRef<ReturnType<typeof createSettingsQueue>>(undefined!);
  if (!settingsQueue.current)
    settingsQueue.current = createSettingsQueue(user.settings, { save: persistSettings });
  const selectedFileRef = useRef<string | null | undefined>(undefined!),
    openFileRef = useRef<ProtocolCallback>(undefined!),
    fileActionRef = useRef<ProtocolCallback>(undefined!),
    saveFileRef = useRef<ProtocolCallback>(undefined!),
    capabilityCache = useRef<{ time: number; pending: Promise<unknown> | null }>({
      time: 0,
      pending: null,
    });
  const tabClosePending = useRef(false);
  selectedFileRef.current = selectedFile;
  openFileRef.current = openFile;
  fileActionRef.current = fileAction;
  saveFileRef.current = saveFile;
  const openCurrentFile = useCallback((...args: any[]) => openFileRef.current(...args), []);
  const openQuickFile = useCallback(
    (path: any) => {
      setQuickOpenFocus(path);
      openCurrentFile(path);
    },
    [openCurrentFile],
  );
  const finishQuickFocus = useCallback(() => setQuickOpenFocus(null), []);
  useEffect(() => {
    if (!fileBusy && quickOpenFocus && selectedFile !== quickOpenFocus) setQuickOpenFocus(null);
  }, [fileBusy, selectedFile, quickOpenFocus]);
  const currentFileAction = useCallback((...args: any[]) => fileActionRef.current(...args), []);
  const downloadFiles = useCallback(
    async (paths: any) => {
      const target = projectRef.current;
      if (!target || !paths.length) return;
      if (paths.length === 1) {
        const link = document.createElement('a');
        link.href = `/api/projects/${target.id}/download?path=${encodeURIComponent(paths[0])}`;
        link.download = '';
        document.body.append(link);
        link.click();
        link.remove();
        return;
      }
      notify('正在准备所选项目的 ZIP…');
      const response = await fetch(`/api/projects/${target.id}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({ paths }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '下载失败，请重试');
      }
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement('a');
      link.href = url;
      link.download = `${target.name}-selected.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      notify('所选项目的 ZIP 已准备好');
    },
    [notify],
  );
  const saveCurrentFile = useCallback(() => saveFileRef.current(), []);
  const codeChange = useCallback(
    (content: string | undefined) =>
      setTabs((prev) => updateTabContent(prev, selectedFileRef.current, content)),
    [],
  );
  const filesDeleted = useCallback(
    (projectId: any, results: any) => {
      const removed = results.filter((result: any) => result.deleted);
      if (projectRef.current?.id === projectId) {
        ++fileRequest.current;
        setFileBusy(false);
        const deleted = (rel: string | null) =>
          removed.some((result: any) => rel === result.rel || rel?.startsWith(result.rel + '/'));
        setTabs((prev) => prev.filter((tab) => !deleted(tab.path)));
        setSelectedFile((prev) => (deleted(prev) ? null : prev));
        setContextFile((prev) => (deleted(prev) ? null : prev));
        refreshFiles().catch((e) => notify(e.message, true));
      }
    },
    [notify],
  );
  const cleanupDeleted = useCallback(
    (results: any) => {
      for (const id of new Set(results.map((result: any) => result.projectId)))
        filesDeleted(
          id,
          results.filter((result: any) => result.projectId === id),
        );
    },
    [filesDeleted],
  );
  const beforeFileDelete = useCallback(
    async (paths: any) =>
      !tabRefs.current.some(
        (tab) =>
          tab.content !== tab.original &&
          paths.some((rel: any) => tab.path === rel || tab.path.startsWith(rel + '/')),
      ) ||
      (await dialogs.confirm({
        key: 'discard-delete',
        title: '删除未保存的文件？',
        description: '所选文件包含尚未保存的修改。永久删除会同时丢失这些修改，无法恢复。',
        detail: paths.join('\n'),
        danger: true,
        confirmLabel: '仍然删除',
        cancelLabel: '保留文件',
      })),
    [dialogs.confirm],
  );
  const beforeCleanupDelete = useCallback(
    (entries: any) =>
      beforeFileDelete(
        entries
          .filter((entry: any) => entry.projectId === projectRef.current?.id)
          .map((entry: any) => entry.rel),
      ),
    [beforeFileDelete],
  );
  const contextChange = useCallback((rel: any) => {
    setContextFile(rel!);
    if (window.innerWidth < 1100) setEditor(false);
  }, []);
  const messageFile = useCallback(
    (rel: any) => {
      const id = projectRef.current?.id;
      let local = rel.replace('/workspace/' + id + '/', '');
      if (user.hostProjectBase) local = local.replace(user.hostProjectBase + '/' + id + '/', '');
      if (local.startsWith('/')) {
        notify('这是服务器目录中的文件，可通过 Codex 或服务器终端查看和修改');
        return;
      }
      setEditor(true);
      openFileRef.current(local);
    },
    [user.hostProjectBase, notify],
  );
  const deltaBuffer = useRef<ReturnType<typeof createDeltaBuffer>>(undefined!);
  if (!deltaBuffer.current)
    deltaBuffer.current = createDeltaBuffer((batch) =>
      setTurns((prev) => applyDeltas(prev, batch)),
    );
  async function refreshLists() {
    const [p, t] = await Promise.all([api<Project[]>('/projects'), api<Thread[]>('/threads')]);
    setProjects(p);
    setThreads(t);
    setActivity((prev) =>
      mergeActivity(
        prev,
        t
          .filter((thread) => thread.activeTurn)
          .map((thread) => ({ threadId: thread.id, turn: thread.activeTurn! })),
      ),
    );
    return { projects: p, threads: t };
  }
  async function refreshFiles(p: Project | null | undefined = projectRef.current) {
    if (!p) return;
    const request = ++filesRequest.current;
    setFilesLoading(true);
    try {
      const list = await api<FileEntry[]>(`/projects/${p.id}/files`);
      if (projectRef.current?.id === p.id && request === filesRequest.current) setFiles(list);
    } finally {
      if (request === filesRequest.current) setFilesLoading(false);
    }
  }
  async function syncThread(t: Thread | null | undefined = threadRef.current, initial = false) {
    if (!t) return;
    const request = ++threadRequest.current;
    setThreadLoading(true);
    historyAbort.current?.abort();
    const controller = new AbortController(),
      signal = controller.signal;
    historyAbort.current = controller;
    historyRetry.current = null;
    setHistoryStatus({});
    const current = () =>
      !signal.aborted && threadRef.current?.id === t.id && request === threadRequest.current;
    async function loadOlder(startCursor: any) {
      if (!current()) return;
      historyRetry.current = null;
      setHistoryStatus({ loading: true });
      let cursor = startCursor;
      try {
        while (cursor && current()) {
          await historyPause(signal);
          if (!current()) return;
          const r = await api(
            `/threads/${t!.id}?limit=${olderTurnLimit}&cursor=${encodeURIComponent(cursor)}`,
            { signal },
          );
          if (!current()) return;
          if (r.nextCursor === cursor) throw new Error('历史记录分页未前进，请重试');
          setTurns((prev) => mergeHistoryPage(prev, r.thread.turns || [], true));
          cursor = r.nextCursor;
        }
        if (current()) {
          historyRetry.current = null;
          setHistoryStatus({});
        }
      } catch {
        if (current()) {
          historyRetry.current = () => loadOlder(cursor);
          setHistoryStatus({ error: '较早记录加载失败，已显示的对话可继续使用。' });
        }
      }
    }
    try {
      const r = await api(`/threads/${t.id}?limit=${recentTurnLimit}`, { signal });
      if (!current()) return;
      const recent = r.thread.turns || [];
      if (r.editDraft && !sendPending.current) {
        setInput((prev) => prev || r.editDraft.text);
        setDraftAttachments((prev) =>
          prev[t.id]?.length
            ? prev
            : {
                ...prev,
                [t.id]: r.editDraft.attachments.map((item: Attachment) => ({
                  ...item,
                  saved: item,
                  retained: true,
                })),
              },
        );
      }
      setActivity((prev) =>
        mergeActivity(
          prev,
          recent.map((turn: any) => ({ threadId: t.id, turn })),
        ),
      );
      setTurns((prev) => mergeHistoryPage(prev, recent, initial));
      if (initial) setVisibleFrom(recent[0]?.id || null);
      setThread((prev) => ({
        ...prev!,
        title: r.thread.title || prev!.title,
        tokenUsage: r.thread.tokenUsage || prev!.tokenUsage,
      }));
      setActiveTurn((active) => {
        const running = recent.find(
          (turn: any) => turn.status === 'inProgress' && !completedTurns.current.has(turn.id),
        )?.id;
        return (
          running ||
          (active &&
          !completedTurns.current.has(active) &&
          !recent.some((turn: any) => turn.id === active && turn.status !== 'inProgress')
            ? active
            : null)
        );
      });
      if (r.nextCursor) void loadOlder(r.nextCursor);
    } catch (caughtError) {
      const e = caughtError as AppError;
      if (current()) throw e;
    } finally {
      if (request === threadRequest.current) setThreadLoading(false);
    }
  }
  function event(msg: {
    snapshot?: NotificationSnapshot;
    type: string;
    skins: any;
    avatarUrl: any;
    serverTime: any;
    pending: any;
    activeTurns: { threadId: string; turn: Turn }[] | undefined;
    error: string;
    event: any;
  }) {
    if (msg.type === 'site/notifications') {
      if (msg.snapshot) setNotifications(msg.snapshot);
      return;
    }
    if (msg.type === 'profile/skins') {
      updateSkins(msg.skins);
      return;
    }
    if (msg.type === 'ready' && msg.skins) updateSkins(msg.skins);
    if (msg.type === 'profile/avatar') {
      updateAvatar(msg.avatarUrl);
      return;
    }
    if (msg.type === 'ready' && 'avatarUrl' in msg) updateAvatar(msg.avatarUrl);
    if (msg.type === 'storage/full') {
      window.dispatchEvent(new Event('storage:full'));
      return;
    }
    const timedRequest = (r: ServerRequest) => ({
      ...r,
      deadline:
        r.expiresAt == null
          ? null
          : Date.now() + Math.max(0, r.expiresAt - (msg.serverTime || Date.now())),
    });
    if (msg.type === 'ready') {
      setRequests((msg.pending || []).map(timedRequest));
      setActivity((prev) => {
        const snapshot = { ...prev },
          active = new Set((msg.activeTurns || []).map((entry) => entry.threadId));
        for (const [id, turn] of Object.entries(snapshot))
          if (isRunning(turn) && !active.has(id)) delete snapshot[id];
        return mergeActivity(snapshot, msg.activeTurns);
      });
      if (!firstReady.current) {
        syncThread().catch((e) => notify(e.message, true));
        refreshFiles().catch(() => {});
      }
      firstReady.current = false;
      return;
    }
    if (msg.type === 'error') {
      if (/存储|磁盘|no space left|disk is full/i.test(msg.error))
        window.dispatchEvent(new Event('storage:full'));
      notify(msg.error, true);
      return;
    }
    const e = msg.event;
    if (!e) return;
    const p = e.params || {};
    if (e.id != null) {
      setRequests((prev) =>
        prev.some((x) => String(x.id) === String(e.id))
          ? prev
          : [...prev, timedRequest(e as ServerRequest)],
      );
      if (isUserInput(e)) notify('Codex 发来了问题，请补充回答');
      return;
    }
    if (e.method === 'serverRequest/resolved') {
      setRequests((prev) => prev.filter((x) => String(x.id) !== String(p.requestId)));
      setAnswerDrafts((prev) => {
        const next = { ...prev };
        delete next[p.requestId];
        return next;
      });
      if (p.reason === 'timeout') notify('回答时间已结束，Codex 将收到空回答');
      return;
    }
    if (e.method === 'turn/completed' || e.method === 'turn/started')
      setRequests((prev) => prev.filter((r) => keepRequestOnTurn(r, e)));
    if (e.method === 'connection/lost') {
      setRequests([]);
      setAnswerDrafts({});
      notify('Codex 进程已断开，下一次操作会重新连接', true);
      setActivity((prev) => mergeActivity(prev, p.stoppedTurns));
      deltaBuffer.current.flush(true);
      setTurns((prev) =>
        (p.stoppedTurns || [])
          .filter((entry: any) => entry.threadId === threadRef.current?.id)
          .reduce((turns: any, entry: any) => mergeTurns(turns, [entry.turn]), prev),
      );
      setActiveTurn(null);
      return;
    }
    if (e.method === 'account/updated' || e.method === 'account/login/completed') {
      socket.current
        .call('account/read', { refreshToken: false })
        .then(setAccount)
        .catch(() => {});
      return;
    }
    if (e.method === 'thread/title/updated') {
      setThreads((prev) => prev.map((t) => (t.id === p.threadId ? { ...t, title: p.title } : t)));
      if (threadRef.current?.id === p.threadId) setThread((prev) => ({ ...prev!, title: p.title }));
      return;
    }
    if (e.method === 'turn/completed') {
      completionNotice.current?.complete(p);
      completedTurns.current.add(p.turn.id);
      if (completedTurns.current.size > 100)
        completedTurns.current.delete(completedTurns.current.values().next().value);
    }
    if (['turn/started', 'turn/completed'].includes(e.method)) {
      setActivity((prev) => mergeActivity(prev, [{ threadId: p.threadId, turn: p.turn }]));
      const startedAt = p.turn.timing?.startedAt;
      if (typeof startedAt === 'number')
        setThreads((prev) =>
          prev.map((t) =>
            t.id === p.threadId
              ? {
                  ...t,
                  firstTurnAt: Math.min(t.firstTurnAt ?? startedAt, startedAt),
                  lastTurnAt: Math.max(t.lastTurnAt ?? startedAt, startedAt),
                }
              : t,
          ),
        );
    }
    const tid = p.threadId || p.thread?.id;
    if (tid !== threadRef.current?.id) return;
    if (e.method === 'thread/history/reverted') {
      setRequests((prev) => prev.filter((request) => request.params.threadId !== tid));
      historyAbort.current?.abort();
      ++threadRequest.current;
      historyRetry.current = null;
      setHistoryStatus({});
      deltaBuffer.current.clear();
      setTurns((prev) => {
        const index = prev.findIndex((turn) => turn.id === p.beforeTurnId);
        return index < 0 ? [] : prev.slice(0, index);
      });
      setVisibleFrom(null);
      setActiveTurn(null);
      setReview(null);
      setThread((prev) => (prev ? { ...prev, tokenUsage: null } : prev));
      void syncThread().catch((error) => notify(error.message, true));
      return;
    }
    if (e.method === 'item/completed' || e.method === 'turn/completed')
      deltaBuffer.current.flush(true);
    if (e.method === 'turn/started') {
      if (!completedTurns.current.has(p.turn.id)) setActiveTurn(p.turn.id);
      setTurns((prev) => applyLifecycle(prev, e));
    } else if (e.method === 'turn/changes/updated') setTurns((prev) => applyLifecycle(prev, e));
    else if (e.method === 'turn/plan/updated') setTurns((prev) => applyLifecycle(prev, e));
    else if (e.method === 'turn/completed') {
      setActiveTurn((current) => (current === p.turn.id ? null : current));
      setTurns((prev) => applyLifecycle(prev, e));
      if (p.turn.status === 'failed')
        notify(p.turn.error?.message || 'Codex 执行失败，请检查账号配置', true);
      refreshFiles().catch(() => {});
    } else if (e.method === 'item/started' || e.method === 'item/completed') {
      setTurns((prev) => applyLifecycle(prev, e));
      if (e.method === 'item/completed' && p.item.type === 'fileChange')
        refreshFiles().catch(() => {});
    } else if (
      [
        'item/agentMessage/delta',
        'item/commandExecution/outputDelta',
        'item/reasoning/summaryTextDelta',
        'item/reasoning/textDelta',
      ].includes(e.method)
    ) {
      deltaBuffer.current.push(e);
    } else if (e.method === 'thread/tokenUsage/updated')
      setThread((prev) => (prev ? { ...prev, tokenUsage: p.tokenUsage } : prev));
    else if (e.method === 'error') notify(p.error?.message || 'Codex 请求失败', true);
  }
  useEffect(() => {
    socket.current = new LiveSocket(user, event, setStatus, setLatency);
    refreshLists()
      .then((r) => {
        if (r.projects.length) setProject(r.projects[0]);
      })
      .catch((e) => {
        setWelcomeError(e.message);
        notify(e.message, true);
      })
      .finally(() => setListsLoading(false));
    return () => {
      historyAbort.current?.abort();
      deltaBuffer.current.clear();
      socket.current.close();
    };
  }, [user.id, user.csrf]);
  useEffect(() => {
    if (status === 'expired') {
      notify('登录已过期，请重新登录', true);
      setUser(null);
    }
  }, [status]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 7000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    if (!sidebar || !mobile || modal || editorFullscreen) return;
    sidebarRoot.current.querySelector<FocusableElement>('button')?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (document.querySelector<FocusableElement>('.modal-backdrop')) return;
      if (e.key === 'Escape') closeSidebar();
      if (e.key !== 'Tab') return;
      const items = [
        ...sidebarRoot.current.querySelectorAll<FocusableElement>(
          'button,input,summary,[tabindex]',
        ),
      ].filter((x) => !x.disabled && x.tabIndex >= 0 && x.getClientRects().length);
      if (e.shiftKey && document.activeElement === items[0]) {
        e.preventDefault();
        items.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
        e.preventDefault();
        items[0]?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [sidebar, mobile, modal, editorFullscreen]);
  useEffect(() => {
    if (!editor) {
      setEditorFullscreen(false);
      return;
    }
    if (!editorFullscreen) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.isComposing ||
        document.querySelector<FocusableElement>('.modal-backdrop')
      )
        return;
      // Monaco prevents Esc even when idle; handled editor commands stop propagation.
      if (
        event.defaultPrevented &&
        !(event.target as HTMLInputElement).matches?.('.monaco-editor textarea.inputarea')
      )
        return;
      event.preventDefault();
      setEditorFullscreen(false);
      requestAnimationFrame(() => editorFullscreenToggle.current?.focus());
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [editor, editorFullscreen]);
  useEffect(() => {
    if (project) refreshFiles(project).catch((e) => notify(e.message, true));
  }, [project?.id]);
  useEffect(() => {
    setQuickOpen(false);
    setQuickOpenFocus(null);
  }, [project?.id]);
  const showQuickOpen = useCallback(() => {
    if (projectRef.current) {
      setReview(null);
      setEditor(true);
      setQuickOpen(true);
    }
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'p' ||
        event.isComposing ||
        !projectRef.current
      )
        return;
      if (welcomeVisible || document.querySelector<FocusableElement>('.modal-backdrop')) return;
      event.preventDefault();
      event.stopPropagation();
      showQuickOpen();
    };
    // Capture before Monaco or the browser handles its own Ctrl+P command.
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [showQuickOpen, welcomeVisible]);
  const visibleStart = visibleFrom
    ? Math.max(
        0,
        turns.findIndex((turn) => turn.id === visibleFrom),
      )
    : Math.max(0, turns.length - recentTurnLimit);
  useEffect(() => {
    if (!visibleFrom && turns.length) setVisibleFrom(turns[0].id);
  }, [visibleFrom, turns]);
  const rememberScroll = useConversationScroll(scrollRef, messagesRef, autoScroll, [
    thread?.id,
    turns,
    visibleFrom,
    activeTurn,
    requests.length,
    threadLoading,
    historyStatus,
  ]);
  function showOlder() {
    rememberScroll();
    setVisibleFrom(turns[Math.max(0, visibleStart - recentTurnLimit)]?.id || null);
  }
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!review && !document.querySelector<FocusableElement>('.modal-backdrop'))
          saveFileRef.current();
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [review]);
  async function loadCapabilities(force = false) {
    const cache = capabilityCache.current;
    if (cache.pending) return cache.pending;
    if (force !== true && Date.now() - cache.time < 60000) return true;
    cache.pending = (async () => {
      try {
        const [m, a] = await Promise.all([
          socket.current.call('model/list', { limit: 100 }),
          socket.current.call('account/read', { refreshToken: false }),
        ]);
        setModels(m.data || []);
        setAccount(a);
        cache.time = Date.now();
        return true;
      } catch (caughtError) {
        const e = caughtError as AppError;
        notify(e.message, true);
        return false;
      } finally {
        cache.pending = null;
      }
    })();
    return cache.pending;
  }
  async function newProject(name: string) {
    const p = await api<Project>('/projects', { method: 'POST', body: { name } });
    setProjects((prev) => [p, ...prev]);
    await chooseProject(p);
    setModal(null);
    notify('项目已创建');
  }
  function hasDirtyTabs() {
    return tabs.some((t) => t.content !== t.original);
  }
  function resetConversation() {
    historyAbort.current?.abort();
    historyRetry.current = null;
    setHistoryStatus({});
    setVisibleFrom(null);
    setReview(null);
    deltaBuffer.current.clear();
    threadRef.current = null;
    ++threadRequest.current;
    setThreadLoading(false);
    setThread(null);
    setTurns([]);
    setActiveTurn(null);
    setDragging(false);
  }
  function closeSidebar() {
    setSidebar(false);
    requestAnimationFrame(() => sidebarToggle.current?.focus());
  }
  function closeEditor() {
    setEditor(false);
    requestAnimationFrame(() => editorToggle.current?.focus());
  }
  async function chooseProject(p: Project) {
    if (
      p.id !== projectRef.current?.id &&
      hasDirtyTabs() &&
      !(await dialogs.confirm({
        key: 'switch-project',
        title: '切换到另一个项目？',
        description: '当前项目有未保存的修改，切换后这些修改会被丢弃。你可以取消并先保存文件。',
        detail: p.name,
        confirmLabel: '丢弃并切换',
        cancelLabel: '继续编辑',
        danger: true,
      }))
    )
      return;
    projectRef.current = p;
    setProject(p);
    resetConversation();
    ++fileRequest.current;
    setFileBusy(false);
    setTabs([]);
    setSelectedFile(null);
    setFiles([]);
    setContextFile(null);
    if (mobile) closeSidebar();
  }
  async function chooseThread(t: Thread) {
    const p = projects.find((x) => x.id === t.project_id);
    if (!p) return;
    if (
      p.id !== project?.id &&
      hasDirtyTabs() &&
      !(await dialogs.confirm({
        key: 'switch-thread-project',
        title: '切换对话所在的项目？',
        description: '当前项目有未保存的修改，切换会丢弃这些修改。',
        detail: t.title,
        confirmLabel: '丢弃并切换',
        cancelLabel: '继续编辑',
        danger: true,
      }))
    )
      return;
    if (p.id !== project?.id) {
      projectRef.current = p;
      setProject(p);
      ++fileRequest.current;
      setFileBusy(false);
      setTabs([]);
      setSelectedFile(null);
      setFiles([]);
    }
    setVisibleFrom(null);
    setReview(null);
    deltaBuffer.current.clear();
    setThread(t);
    threadRef.current = t;
    setTurns([]);
    setActiveTurn(null);
    autoScroll.current = true;
    if (mobile) closeSidebar();
    try {
      await syncThread(t, true);
    } catch (caughtError) {
      const e = caughtError as AppError;
      notify(e.message, true);
    }
  }
  async function sendMessage(e?: { preventDefault: () => void }) {
    e?.preventDefault();
    if (
      (!input.trim() && !attachments.length) ||
      sendPending.current ||
      progress ||
      activeTurn ||
      modelPending.current ||
      threadLoading ||
      toolPending.current ||
      commandPending.current
    )
      return;
    if (!project) {
      setModal('project');
      return;
    }
    sendPending.current = true;
    setSending(true);
    const key = draftKey,
      selected = [...attachments];
    const text = contextFile ? `请结合项目文件 ${contextFile}：\n\n${input.trim()}` : input.trim();
    try {
      let t = thread;
      if (!t) {
        t = await api<Thread>('/threads', {
          method: 'POST',
          body: { projectId: project.id, title: input.trim().slice(0, 50) },
        });
        setThread(t);
        threadRef.current = t;
        setThreads((prev) => [t!, ...prev]);
      }
      autoScroll.current = true;
      setDraftAttachments((prev) => ({ ...prev, [key]: [], [t.id]: selected }));
      abortUpload.current = new AbortController();
      for (const item of selected) {
        if (item.saved) continue;
        if (!item.file) throw new Error('附件数据已失效，请重新选择文件');
        const [result] = await socket.current.upload(
          { scope: 'attachment', threadId: t.id },
          [item.file],
          setProgress,
          abortUpload.current.signal,
        );
        item.saved = result.attachment;
        setDraftAttachments((prev) => ({ ...prev, [t.id]: selected.map((x) => ({ ...x })) }));
      }
      setProgress(null);
      const result = await socket.current.call('turn/start', {
        threadId: t.id,
        text,
        attachments: selected.map((x) => x.saved!.id),
      });
      setActivity((prev) => mergeActivity(prev, [{ threadId: t.id, turn: result.turn }]));
      setDraftAttachments((prev) => ({ ...prev, [t.id]: [] }));
      if (threadRef.current?.id === t.id) {
        setTurns((prev) => mergeTurns(prev, [result.turn]));
        setActiveTurn(
          result.turn.status === 'inProgress' && !completedTurns.current.has(result.turn.id)
            ? result.turn.id
            : null,
        );
        setInput('');
        setContextFile(null);
      }
    } catch (caughtError) {
      const e = caughtError as AppError;
      notify(e.message, true);
    } finally {
      setSending(false);
      sendPending.current = false;
      setProgress(null);
    }
  }
  async function editMessage(
    turnId: string,
    itemId: string,
    text: string,
    expectedLastTurnId: string,
  ) {
    const t = threadRef.current;
    if (
      !t ||
      sendPending.current ||
      activeTurn ||
      progress ||
      threadLoading ||
      modelPending.current ||
      toolPending.current ||
      commandPending.current
    )
      throw new Error('请等待当前操作结束后再编辑');
    sendPending.current = true;
    setSending(true);
    try {
      const result = await socket.current.call('turn/edit', {
        threadId: t.id,
        turnId,
        itemId,
        text,
        expectedLastTurnId,
      });
      setActivity((prev) => mergeActivity(prev, [{ threadId: t.id, turn: result.turn }]));
      if (threadRef.current?.id === t.id) {
        autoScroll.current = true;
        setTurns((prev) => mergeTurns(prev, [result.turn]));
        setActiveTurn(
          result.turn.status === 'inProgress' && !completedTurns.current.has(result.turn.id)
            ? result.turn.id
            : null,
        );
      }
    } catch (error) {
      // Revert and inference are separate native RPCs. Preserve the user's edit
      // as a composer draft even if a network/provider failure follows revert.
      const recovery = (error as AppError).editDraft;
      if (threadRef.current?.id === t.id && recovery) {
        setInput((prev) => prev || recovery.text);
        setDraftAttachments((prev) => ({
          ...prev,
          [t.id]: [
            ...(prev[t.id] || []),
            ...recovery.attachments
              .filter((item) => !prev[t.id]?.some((draft) => draft.saved?.id === item.id))
              .map((item) => ({ ...item, saved: item, retained: true })),
          ],
        }));
        setContextFile(null);
      }
      throw error;
    } finally {
      sendPending.current = false;
      setSending(false);
    }
  }
  function addAttachments(list: any[]) {
    if (sending || progress) return;
    if (list.some((file) => file.size > 20 * 1024 * 1024)) {
      notify('聊天附件大小上限为 20 MB', true);
      return;
    }
    if (attachments.length + list.length > 10) {
      notify('每轮最多 10 个附件', true);
      return;
    }
    setDraftAttachments((prev) => ({
      ...prev,
      [draftKey]: [
        ...(prev[draftKey] || []),
        ...list.map((file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          file,
        })),
      ],
    }));
  }
  async function removeAttachment(item: { saved: { id: any }; id: string; retained?: boolean }) {
    try {
      if (item.saved && !item.retained)
        await api(`/attachments/${item.saved.id}`, { method: 'DELETE' });
      setDraftAttachments((prev) => ({
        ...prev,
        [draftKey]: (prev[draftKey] || []).filter((x) => x.id !== item.id),
      }));
    } catch (caughtError) {
      const e = caughtError as AppError;
      notify(e.message, true);
    }
  }
  async function persistSettings(s: Settings) {
    try {
      const result = await api('/settings', { method: 'PUT', body: s });
      setSettings(result);
      return result;
    } catch (caughtError) {
      const e = caughtError as AppError;
      notify(e.message, true);
      throw e;
    }
  }
  function updateSettings(s: any) {
    return settingsQueue.current.update(s, settings);
  }
  async function upload(e: { target: HTMLInputElement }) {
    const archive = e.target === archiveInput.current,
      list = [...((e.target as HTMLInputElement).files || [])];
    (e.target as HTMLInputElement).value = '';
    return uploadProject({
      files: list,
      folder: list.some((file) => file.webkitRelativePath),
      archive,
    });
  }
  async function uploadProject(input: UploadSelection) {
    if (!project || progress || sendPending.current || projectUploadPending.current) return;
    projectUploadPending.current = true;
    const targetProject = project,
      controller = new AbortController();
    abortUpload.current = controller;
    let compression: { original: any; compressed: any };
    const report = (value: React.SetStateAction<ProtocolRecord | null | undefined>) =>
      setProgress({ ...value, scope: 'project', compression });
    report({ phase: input.dataTransfer ? 'scanning' : 'uploading', done: 0, total: 0 });
    try {
      const limits = { maxEntries: fileEntryLimit(user) };
      const selection: UploadSelection = input.dataTransfer
        ? await droppedFiles(input.dataTransfer, controller.signal, report, limits)
        : input;
      const list = selection.files!,
        folder = selection.folder,
        archive =
          selection.archive ||
          (!!input.dataTransfer &&
            !folder &&
            list!.length > 0 &&
            list!.every((file) => isArchive(file.name)));
      if (!list!.length && !selection.directories?.length) return;
      let uploadFiles = list;
      if (folder) {
        report({ phase: 'compressing', done: 0, total: list!.reduce((n, f) => n + f.size, 0) });
        const zip = await zipFolder(list, controller.signal, report, selection.directories, limits);
        compression = { original: list!.reduce((n, f) => n + f.size, 0), compressed: zip.size };
        uploadFiles = [zip];
      }
      const onConflict = (error: React.SetStateAction<ProtocolRecord | null | undefined>) =>
        new Promise((resolve) => {
          const finish = (policy: unknown) => {
            controller.signal.removeEventListener('abort', cancel);
            setUploadConflict(null);
            resolve(policy);
          };
          const cancel = () => finish('cancel');
          controller.signal.addEventListener('abort', cancel, { once: true });
          if (controller.signal.aborted) cancel();
          else setUploadConflict({ ...error, resolve: finish });
        });
      const results = await socket.current.upload(
        { projectId: targetProject.id, extract: folder || archive },
        uploadFiles,
        report,
        controller.signal,
        onConflict,
      );
      const uploaded = results.reduce((n, r) => n + (r.uploaded || 0), 0),
        skipped = results.reduce((n, r) => n + (r.skipped || 0), 0),
        overwritten = results.reduce((n, r) => n + (r.overwritten || 0), 0);
      notify(
        `${uploaded} 个文件上传完成${overwritten ? `，已覆盖 ${overwritten} 个` : ''}${skipped ? `，已跳过 ${skipped} 项` : ''}`,
      );
    } catch (caughtError) {
      const e = caughtError as AppError;
      notify(e.message, !controller.signal.aborted && e.message !== '已取消上传');
    } finally {
      projectUploadPending.current = false;
      setUploadConflict(null);
      setProgress(null);
      await refreshFiles(targetProject).catch(() => {});
    }
  }
  async function openFile(rel: string, reload = false) {
    setReview(null);
    if (!reload && tabs.find((t) => t.path === rel)) {
      ++fileRequest.current;
      setFileBusy(false);
      setSelectedFile(rel);
      setEditor(true);
      return;
    }
    const target = projectRef.current;
    if (!target) return;
    const request = ++fileRequest.current;
    setFileBusy(true);
    setEditor(true);
    try {
      const data = await api(`/projects/${target.id}/file?path=${encodeURIComponent(rel)}`);
      if (target.id !== projectRef.current?.id || request !== fileRequest.current) return;
      const tab = {
        ...data,
        path: rel,
        content: data.content,
        original: data.content,
        etag: data.etag,
      };
      setTabs((prev) =>
        prev.some((x) => x.path === rel)
          ? prev.map((x) => (x.path === rel ? tab : x))
          : [...prev, tab],
      );
      setSelectedFile(rel);
    } catch (caughtError) {
      const e = caughtError as AppError;
      notify(e.message, true);
    } finally {
      if (request === fileRequest.current) setFileBusy(false);
    }
  }
  async function saveFile() {
    const file = tabRefs.current.find((x) => x.path === selectedFile);
    if (!file || file.kind === 'image' || file.content === file.original) return;
    try {
      const data = await api(`/projects/${project!.id}/file`, {
        method: 'PUT',
        body: { path: file.path, content: file.content, etag: file.etag },
      });
      setTabs((prev) =>
        prev.map((x) =>
          x.path === file.path ? { ...x, original: file.content, etag: data.etag } : x,
        ),
      );
      notify('文件已保存');
    } catch (caughtError) {
      const e = caughtError as AppError;
      notify(e.message, true);
    }
  }
  async function closeTabs(paths: string[]) {
    if (tabClosePending.current) return false;
    const targets = new Set(paths),
      files = tabRefs.current.filter((file) => targets.has(file.path)),
      id = projectRef.current?.id;
    if (!files.length) return false;
    tabClosePending.current = true;
    try {
      const dirty = files.filter(isDirtyTab),
        approved = new Map(dirty.map((file) => [file.path, file.content]));
      if (
        dirty.length &&
        !(await dialogs.confirm({
          key: 'close-tabs',
          title: dirty.length > 1 ? `关闭 ${dirty.length} 个未保存的文件？` : '关闭未保存的文件？',
          description: '这些编辑尚未保存。关闭后会丢失修改，磁盘中的文件会保留。',
          detail: dirty.map((file) => file.path).join('\n'),
          confirmLabel: '丢弃并关闭',
          cancelLabel: '继续编辑',
          danger: true,
        }))
      )
        return false;
      if (projectRef.current?.id !== id) return false;
      if (hasUnapprovedTabChanges(tabRefs.current, paths, approved)) {
        notify('文件在确认期间发生变化，请重新关闭标签', true);
        return false;
      }
      const next = closeTabState(tabRefs.current, selectedFileRef.current!, paths);
      tabRefs.current = next.tabs;
      selectedFileRef.current = next.selectedFile;
      setTabs(next.tabs);
      setSelectedFile(next.selectedFile);
      return true;
    } finally {
      tabClosePending.current = false;
    }
  }
  async function reloadFile(file: { content: any; original: any; path: any }) {
    const id = projectRef.current?.id;
    if (
      file.content !== file.original &&
      !(await dialogs.confirm({
        key: `reload:${file.path}`,
        title: '重新加载文件？',
        description: '将读取磁盘上的最新内容，当前未保存的修改会被丢弃。',
        detail: file.path,
        confirmLabel: '丢弃并重新加载',
        cancelLabel: '继续编辑',
        danger: true,
      }))
    )
      return;
    if (projectRef.current?.id === id) await openFile(file.path, true);
  }
  async function fileAction(action: string, rel?: string | null) {
    const target = projectRef.current;
    if (!target) return;
    const sameProject = () => {
      if (projectRef.current?.id !== target.id)
        throw new Error('项目已切换，请在当前项目中重新操作');
    };
    const refresh = () => {
      if (projectRef.current?.id === target.id)
        refreshFiles(target).catch((e) => notify(e.message, true));
    };
    try {
      if (action === 'delete')
        await dialogs.confirm({
          key: `delete:${target.id}:${rel}`,
          title: '永久删除文件？',
          description: '文件或文件夹及其内容将被永久删除，未保存的修改也会丢失。此操作无法撤销。',
          detail: rel,
          icon: Trash2,
          danger: true,
          confirmLabel: '永久删除',
          cancelLabel: '保留文件',
          onConfirm: async () => {
            sameProject();
            await api(`/projects/${target.id}/file`, { method: 'DELETE', body: { path: rel } });
            if (projectRef.current?.id === target.id) {
              const removed = (path: string | null) => path === rel || path?.startsWith(rel + '/');
              setTabs((prev) => prev.filter((t) => !removed(t.path)));
              setSelectedFile((current) => (removed(current) ? null : current));
              setContextFile((current) => (removed(current) ? null : current));
              refresh();
            }
            notify('文件已删除');
            window.dispatchEvent(new Event('storage:refresh'));
          },
        });
      if (action === 'rename')
        await dialogs.input({
          key: `rename:${target.id}:${rel}`,
          title: '重命名文件或文件夹',
          description: '也可以输入相对于项目根目录的新路径。',
          label: '新路径',
          initialValue: rel,
          hint: '使用 / 分隔文件夹，例如 src/components/Button.jsx',
          confirmLabel: '保存名称',
          icon: Pencil,
          onConfirm: async (to: any) => {
            sameProject();
            if (to === rel) return;
            if (
              tabRefs.current.some(
                (t) => (t.path === rel || t.path.startsWith(rel + '/')) && t.content !== t.original,
              )
            )
              throw new Error('该路径下有未保存的修改，请取消并先保存或关闭文件');
            await api(`/projects/${target.id}/file`, { method: 'PATCH', body: { from: rel, to } });
            if (projectRef.current?.id === target.id) {
              const renamed = (path: string | null) =>
                path === rel || path?.startsWith(rel + '/') ? to + path!.slice(rel!.length) : path;
              setTabs((prev) =>
                prev.map((t) => ({
                  ...t,
                  path: renamed(t.path)!,
                  ...(t.kind === 'image'
                    ? {
                        url: `/api/projects/${target.id}/image?path=${encodeURIComponent(renamed(t.path)!)}`,
                      }
                    : {}),
                })),
              );
              setSelectedFile(renamed);
              setContextFile(renamed);
              refresh();
            }
            notify('名称已更新');
          },
        });
      if (action === 'newFile' || action === 'newFolder')
        await dialogs.input({
          key: `create:${target.id}:${action}:${rel || ''}`,
          title: action === 'newFile' ? '新建文件' : '新建文件夹',
          description: `创建到 ${target.name}${rel ? `/${rel}` : ''}，支持同时建立多层目录。`,
          label: action === 'newFile' ? '文件路径' : '文件夹路径',
          placeholder: action === 'newFile' ? '例如 main.py' : '例如 components',
          hint: `路径相对于${rel ? '所选文件夹' : '当前项目'}，使用 / 分隔文件夹。`,
          icon: action === 'newFile' ? File : Folder,
          confirmLabel: '创建',
          onConfirm: async (name: any) => {
            const newPath = rel ? `${rel}/${name}` : name;
            sameProject();
            await api(`/projects/${target.id}/${action === 'newFile' ? 'file' : 'directory'}`, {
              method: action === 'newFile' ? 'PUT' : 'POST',
              body: { path: newPath, content: '' },
            });
            if (projectRef.current?.id === target.id) {
              if (action === 'newFile') await openFile(newPath);
              refresh();
            }
            notify(action === 'newFile' ? '文件已创建' : '文件夹已创建');
          },
        });
    } catch (caughtError) {
      const e = caughtError as AppError;
      notify(e.message, true);
    }
  }
  async function threadAction(action: string, t = thread) {
    if (!t) return;
    const tracked = ['fork', 'compact'].includes(action);
    if (
      tracked &&
      (toolPending.current ||
        commandPending.current ||
        threadLoading ||
        sending ||
        activeTurn ||
        status !== 'connected')
    )
      return;
    if (tracked) {
      toolPending.current = true;
      setToolBusy(action);
    }
    try {
      if (action === 'favorite') {
        if (favoritePending.current.has(t.id)) return;
        favoritePending.current.add(t.id);
        try {
          const { favorite } = await api<{ favorite: boolean }>(`/threads/${t.id}/favorite`, {
            method: 'PUT',
            body: { favorite: !t.favorite },
          });
          setThreads((prev) =>
            prev.map((item) => (item.id === t.id ? { ...item, favorite } : item)),
          );
        } finally {
          favoritePending.current.delete(t.id);
        }
        return;
      }
      if (action === 'rename') {
        await dialogs.input({
          key: `thread-name:${t.id}`,
          title: '重命名对话',
          description: '取一个清晰的名字，方便下次找到这段对话。',
          label: '对话标题',
          initialValue: t.title,
          maxLength: 100,
          confirmLabel: '保存标题',
          onConfirm: async (title: string) => {
            if (title === t.title) return;
            await api(`/threads/${t.id}`, { method: 'PATCH', body: { title } });
            setThreads((prev) =>
              prev.map((item) => (item.id === t.id ? { ...item, title } : item)),
            );
            setThread((prev) => (prev?.id === t.id ? { ...prev, title } : prev));
            notify('对话标题已更新');
          },
        });
        return;
      }
      if (action === 'archive') {
        await dialogs.confirm({
          key: `archive:${t.id}`,
          title: '归档这段对话？',
          description: '归档后将从最近对话列表中移除。项目文件会保留。',
          detail: t.title,
          icon: Archive,
          confirmLabel: '归档对话',
          onConfirm: async () => {
            await api(`/threads/${t.id}/archive`, { method: 'POST' });
            if (threadRef.current?.id === t.id) resetConversation();
            setThreads((prev) => prev.filter((item) => item.id !== t.id));
            notify('对话已归档');
          },
        });
        return;
      }
      if (action === 'fork') {
        const r = await socket.current.call('thread/fork', { threadId: t.id });
        const lists = await refreshLists();
        const fork = lists.threads.find((x) => x.id === r.thread.id);
        if (fork && threadRef.current?.id === t.id) await chooseThread(fork);
        notify('对话分支已创建');
        return;
      }
      if (action === 'compact') {
        await socket.current.call('thread/compact/start', { threadId: t.id });
        notify('已开始压缩对话上下文');
      }
      await refreshLists();
    } catch (caughtError) {
      const e = caughtError as AppError;
      notify(e.message, true);
    } finally {
      if (tracked) {
        toolPending.current = false;
        setToolBusy(null);
      }
    }
  }
  const tab = tabs.find((x) => x.path === selectedFile),
    visibleThreads = threads.filter(
      (t) =>
        (!project || t.project_id === project.id) &&
        t.title.toLowerCase().includes(search.toLowerCase()),
    );
  return (
    <>
      <div
        className={`workspace ${sidebar ? 'sidebar-open' : ''} ${editor ? 'editor-open' : ''} ${editor && editorFullscreen ? 'editor-fullscreen' : ''} ${welcomeVisible ? '' : 'workspace-entered'}`}
        inert={welcomeVisible}
        aria-hidden={welcomeVisible}
      >
        {scrimPresent && (
          <div
            className={`mobile-scrim ${sidebar ? '' : 'is-closing'}`}
            aria-hidden="true"
            onClick={closeSidebar}
          />
        )}
        <aside
          className="sidebar"
          id="workspace-sidebar"
          ref={sidebarRoot}
          role={mobile ? 'dialog' : undefined}
          aria-modal={mobile && sidebar ? true : undefined}
          aria-label="工作区侧栏"
          aria-hidden={!sidebar}
          inert={!sidebar}
        >
          <div className="sidebar-content">
            <div className="sidebar-brand">
              <BrandMark size={24} className="brand-mark" />
              <span>
                Starvalley <b>Codex</b>
              </span>
              <IconButton title="收起侧栏" onClick={closeSidebar}>
                <PanelLeft size={17} />
              </IconButton>
            </div>
            <button
              className="new-chat"
              onClick={() => {
                resetConversation();
                if (mobile) closeSidebar();
              }}
            >
              <Plus size={18} />
              新对话<span>⌘ K</span>
            </button>
            <div className="sidebar-search">
              <Search size={15} />
              <input
                aria-label="搜索对话"
                placeholder="搜索对话"
                value={search}
                onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
              />
            </div>
            <div className="sidebar-section">
              <span>项目空间</span>
              <IconButton title="新建项目" onClick={() => setModal('project')}>
                <Plus size={16} />
              </IconButton>
            </div>
            <nav className="project-list" aria-label="项目列表">
              {projects.map((p) => (
                <button
                  key={p.id}
                  className={`project-item ${p.id === project?.id ? 'selected' : ''}`}
                  onClick={() => chooseProject(p)}
                >
                  <Folder size={16} />
                  <span>{p.name}</span>
                  {p.id === project?.id && <span className="project-dot" />}
                </button>
              ))}
              {listsLoading && <LoadingPlaceholder label="正在读取项目…" variant="list" rows={3} />}{' '}
              {!listsLoading && !projects.length && (
                <button className="add-project" onClick={() => setModal('project')}>
                  <Plus size={15} />
                  创建你的第一个项目
                </button>
              )}
            </nav>
            <div className="sidebar-section conversation-label">
              <span>最近对话</span>
              <span>{visibleThreads.length}</span>
            </div>
            <nav className="conversation-list" aria-label="对话列表">
              {visibleThreads.map((t) => (
                <div key={t.id} className={`thread-row ${t.id === thread?.id ? 'selected' : ''}`}>
                  <Tooltip
                    content={
                      <dl className="thread-times">
                        <dt>第一次对话</dt>
                        <dd>{conversationTime(t.firstTurnAt)}</dd>
                        <dt>最后一次对话</dt>
                        <dd>{conversationTime(t.lastTurnAt)}</dd>
                      </dl>
                    }
                  >
                    <button onClick={() => chooseThread(t)}>
                      <MessageSquare size={14} aria-hidden="true" />
                      <span>{t.title}</span>
                      {t.favorite && (
                        <Star
                          size={13}
                          className="thread-favorite"
                          role="img"
                          aria-label="已收藏"
                        />
                      )}
                    </button>
                  </Tooltip>
                  {requests.some((r) => isUserInput(r) && r.params?.threadId === t.id) ? (
                    <span
                      className="thread-question"
                      aria-label="等待你的回答"
                      title="等待你的回答"
                    >
                      <MessageSquare size={14} />
                    </span>
                  ) : (
                    isRunning(activity[t.id]) && (
                      <span
                        className="thread-activity"
                        role="status"
                        aria-label="Codex 正在思考"
                        title="Codex 正在思考"
                      >
                        <LoaderCircle size={14} className="spin" aria-hidden="true" />
                      </span>
                    )
                  )}
                  <RowMenu label="对话操作">
                    <button onClick={() => threadAction('favorite', t)}>
                      <Star size={13} className={t.favorite ? 'thread-favorite' : undefined} />
                      {t.favorite ? '取消收藏' : '收藏'}
                    </button>
                    <button onClick={() => threadAction('rename', t)}>
                      <Pencil size={13} />
                      重命名
                    </button>
                    <button onClick={() => threadAction('archive', t)}>
                      <Archive size={13} />
                      归档
                    </button>
                  </RowMenu>
                </div>
              ))}
              {listsLoading && (
                <LoadingPlaceholder label="正在读取对话…" variant="list" rows={5} />
              )}{' '}
              {!listsLoading && !visibleThreads.length && (
                <p className="sidebar-empty">你的创作，会从这里开始。</p>
              )}
            </nav>
            <SidebarUser
              user={user}
              status={status}
              disabled={modelSaving}
              onOpenProfile={() => setModal('profile')}
              onOpenSettings={() => {
                setModal('settings');
                loadCapabilities();
              }}
            />
          </div>
        </aside>
        <main
          className="main"
          inert={mobile && sidebar && !editorFullscreen}
          aria-hidden={mobile && sidebar && !editorFullscreen}
        >
          <header className="topbar">
            <div className="topbar-left">
              <IconButton
                title={sidebar ? '收起侧栏' : '展开侧栏'}
                buttonRef={sidebarToggle}
                aria-expanded={sidebar}
                aria-controls="workspace-sidebar"
                onClick={() => setSidebar(!sidebar)}
              >
                <PanelLeft size={19} />
              </IconButton>
              <span className="workspace-name">{project?.name || '个人工作区'}</span>
              <ChevronRight size={14} className="muted" />
              <span className="breadcrumb">{thread?.title || '新对话'}</span>
            </div>
            <WorkspaceToolbar
              api={api}
              notifications={notifications}
              memoOpen={memoOpen}
              onMemo={() => {
                setMemoMounted(true);
                setMemoOpen(true);
              }}
              theme={theme}
              customSkin={!!appearance.current}
              status={status}
              latency={latency}
              hasProject={!!project}
              terminalOpen={modal === 'liveTerminal'}
              editor={editor}
              editorToggle={editorToggle}
              settingsDisabled={modelSaving}
              onAppearance={() => setModal('appearance')}
              onTheme={(next) => setTheme(next)}
              onRetry={() => socket.current?.retry()}
              onTerminal={() =>
                setModal((current) => (current === 'liveTerminal' ? null : 'liveTerminal'))
              }
              onEditor={() => setEditor(!editor)}
              onSettings={() => {
                setModal('settings');
                loadCapabilities();
              }}
            />
          </header>
          <div className="work-body">
            <section className="chat-panel">
              {!welcomeVisible && <BrowserGraphicsNotice />}
              <div
                className="chat-scroll"
                ref={scrollRef}
                onScroll={(e) => {
                  autoScroll.current =
                    (e.target as HTMLInputElement).scrollHeight -
                      (e.target as HTMLInputElement).scrollTop -
                      (e.target as HTMLInputElement).clientHeight <
                    100;
                  rememberScroll();
                  if (
                    !autoScroll.current &&
                    (e.target as HTMLInputElement).scrollTop < 160 &&
                    visibleStart > 0
                  )
                    showOlder();
                }}
              >
                {threadLoading && !turns.length ? (
                  <div className="messages conversation-loading">
                    <LoadingPlaceholder label="正在读取对话…" variant="conversation" rows={6} />
                  </div>
                ) : !thread || !turns.length ? (
                  <div className="welcome">
                    <div className="welcome-symbol">
                      <BrandMark size={64} className="brand-mark" />
                    </div>
                    <h1>今天，想创造些什么？</h1>
                    <p>
                      {project
                        ? `在 ${project.name} 中，和 Codex 一起把想法写成代码。`
                        : '创建一个项目，开始你的下一次创作。'}
                    </p>
                    <div className="suggestion-grid">
                      {[
                        {
                          icon: Code2,
                          title: '从一个想法开始',
                          text: '帮我梳理项目需求，并制定一个可执行的开发计划。',
                        },
                        {
                          icon: Search,
                          title: '读懂现有代码',
                          text: '请分析项目结构，介绍关键模块及其工作方式。',
                        },
                        {
                          icon: ShieldCheck,
                          title: '发现并修复问题',
                          text: '请检查项目代码中可能存在的 bug，说明原因并给出修复。',
                        },
                        {
                          icon: Sparkles,
                          title: '把体验再打磨一下',
                          text: '请检查项目的用户体验，提出并实现最有价值的改进。',
                        },
                      ].map((s) => (
                        <button type="button" key={s.title} onClick={() => setInput(s.text)}>
                          <s.icon size={18} className="suggestion-icon" aria-hidden="true" />
                          <span className="suggestion-copy">
                            <strong>{s.title}</strong>
                            <span className="suggestion-description">{s.text}</span>
                          </span>
                          <ArrowRight size={14} className="suggestion-arrow" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                    {!project && (
                      <button
                        className="primary welcome-create"
                        onClick={() => setModal('project')}
                      >
                        <Plus size={16} />
                        创建项目
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="messages" ref={messagesRef} key={thread?.id}>
                    <div className="history-status">
                      {visibleStart > 0 && (
                        <button type="button" onClick={showOlder}>
                          查看更早记录
                        </button>
                      )}
                      {historyStatus.loading && (
                        <span role="status">
                          <LoaderCircle size={13} className="spin" />
                          正在后台加载较早记录…
                        </span>
                      )}
                      {historyStatus.error && (
                        <span role="status">
                          {historyStatus.error}
                          <button type="button" onClick={() => historyRetry.current?.()}>
                            重试
                          </button>
                        </span>
                      )}
                    </div>
                    {turns.slice(visibleStart).map((turn) => (
                      <div key={turn.id} className="turn" data-turn-id={turn.id}>
                        <TurnMessages
                          threadId={thread?.id}
                          turn={turn}
                          onFile={messageFile}
                          notify={notify}
                          onAttachment={setAttachmentPreview}
                          onReview={openReview}
                          latestTurnId={turns.at(-1)?.id}
                          editDisabled={
                            sending ||
                            !!activeTurn ||
                            !!progress ||
                            threadLoading ||
                            modelSaving ||
                            !!toolBusy ||
                            commandBusy ||
                            status !== 'connected'
                          }
                          onEdit={editMessage}
                          onEditStart={() => {
                            autoScroll.current = false;
                          }}
                        />
                        <ThinkingStatus
                          turn={turn}
                          waitingForInput={requests.some(
                            (r) =>
                              isUserInput(r) &&
                              r.params?.isBlocking !== false &&
                              r.params?.threadId === thread?.id &&
                              (!r.params.turnId || r.params.turnId === turn.id),
                          )}
                        />
                        {turn.status === 'failed' && (
                          <p className="turn-error">{turn.error?.message || '本轮执行失败'}</p>
                        )}
                      </div>
                    ))}
                    {sending && !activeTurn && <ThinkingStatus sending />}
                    {threadLoading && (
                      <LoadingPlaceholder label="正在同步对话…" variant="list" rows={2} />
                    )}
                  </div>
                )}
              </div>
              <div className="composer-zone">
                <div className="request-stack">
                  <UserInputRequests
                    requests={requests.filter(isUserInput)}
                    socket={socket.current}
                    status={status}
                    drafts={answerDrafts}
                    threads={threads}
                    enabled={!welcomeVisible}
                    onDraft={(id, draft) => setAnswerDrafts((prev) => ({ ...prev, [id]: draft }))}
                    onDone={(id) => {
                      setRequests((prev) => prev.filter((x) => String(x.id) !== String(id)));
                      setAnswerDrafts((prev) => {
                        const next = { ...prev };
                        delete next[id];
                        return next;
                      });
                    }}
                  />
                  <ApprovalRequests
                    requests={requests.filter((r) => !isUserInput(r))}
                    socket={socket.current}
                    status={status}
                    threads={threads}
                    onDone={(id) =>
                      setRequests((prev) => prev.filter((r) => String(r.id) !== String(id)))
                    }
                  />
                </div>
                <div className="composer-toolbar">
                  {thread && (
                    <ConversationTools
                      thread={thread}
                      busy={toolBusy}
                      disabledReason={
                        threadLoading
                          ? '正在读取对话，请稍候。'
                          : sending || activeTurn
                            ? '请等待当前任务结束后再操作。'
                            : commandBusy
                              ? '终端命令正在执行，请稍候。'
                              : status !== 'connected'
                                ? '连接恢复后即可使用对话工具。'
                                : ''
                      }
                      onAction={threadAction}
                      onTerminal={() => setModal('terminal')}
                    />
                  )}
                  <div className="composer-meters">
                    {thread && <ContextUsage usage={thread.tokenUsage} />}
                    <StorageManager
                      api={api}
                      Dialog={Modal}
                      userId={user.id}
                      onFiles={() => {
                        setReview(null);
                        setEditor(true);
                      }}
                      onDeleted={cleanupDeleted}
                      beforeDelete={beforeCleanupDelete}
                    />
                    <UsageOverview api={api} socket={socket.current} Dialog={Modal} />
                  </div>
                </div>
                <form
                  className={`composer ${dragging ? 'is-dragging' : ''}`}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes('Files')) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      setDragging(true);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    addAttachments([...e.dataTransfer.files]);
                  }}
                  data-effort={effortTone(previewEffort || settings.effort)}
                  onSubmit={sendMessage}
                >
                  {dragging && (
                    <div className="attachment-drop-hint">
                      <Paperclip size={18} />
                      松开文件，添加到此次对话
                    </div>
                  )}
                  <AttachmentList
                    items={attachments}
                    onPreview={setAttachmentPreview}
                    onRemove={removeAttachment}
                    disabled={sending}
                  />
                  {contextFile && (
                    <div className="context-chip">
                      <File size={12} />
                      {contextFile}
                      <IconButton
                        nativeTitle
                        title="取消文件上下文"
                        onClick={() => setContextFile(null)}
                      >
                        <X size={12} />
                      </IconButton>
                    </div>
                  )}
                  <textarea
                    onPaste={(e) => {
                      const files = [...e.clipboardData.items]
                        .filter((x) => x.kind === 'file')
                        .map((x) => x.getAsFile())
                        .filter(Boolean);
                      if (files.length) {
                        e.preventDefault();
                        addAttachments(files);
                        const text = e.clipboardData.getData('text/plain');
                        if (text) setInput((prev) => prev + text);
                      }
                    }}
                    aria-label="发送消息"
                    placeholder={
                      project
                        ? '向 Codex 描述你的想法，或输入具体任务…'
                        : '先创建一个项目，再开始对话…'
                    }
                    value={input}
                    onChange={(e) => setInput((e.target as HTMLTextAreaElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    rows={Math.min(5, Math.max(2, input.split('\n').length))}
                  />
                  <div className="composer-bottom">
                    <div className="composer-options">
                      <IconButton
                        nativeTitle
                        title="添加对话附件"
                        disabled={!project || !!progress || sending}
                        onClick={() => attachmentPicker.current.click()}
                      >
                        <Plus size={19} />
                      </IconButton>
                      <PermissionPicker
                        settings={settings}
                        nestedSandbox={user.nestedSandbox}
                        role={user.role}
                        hostExecution={user.hostExecution}
                        onChange={updateSettings}
                        disabled={sending || !!activeTurn || modelSaving}
                      />
                    </div>
                    <div className="composer-actions">
                      <ModelPicker
                        settings={settings}
                        models={models}
                        onLoad={loadCapabilities}
                        onChange={updateSettings}
                        onPreview={setPreviewEffort}
                        onSaving={(busy) => {
                          modelPending.current = busy;
                          setModelSaving(busy);
                        }}
                        disabled={sending || !!activeTurn || status !== 'connected'}
                      />
                      {activeTurn ? (
                        <button
                          type="button"
                          className="send-button stop"
                          aria-label="停止生成"
                          onClick={() =>
                            socket.current
                              .call('turn/interrupt', { threadId: thread!.id, turnId: activeTurn })
                              .catch((e) => notify(e.message, true))
                          }
                        >
                          <Square size={14} fill="currentColor" />
                        </button>
                      ) : (
                        <button
                          className="send-button"
                          aria-label="发送"
                          disabled={
                            (!input.trim() && !attachments.length) ||
                            sending ||
                            !!progress ||
                            modelSaving ||
                            threadLoading ||
                            !!toolBusy ||
                            commandBusy ||
                            status !== 'connected'
                          }
                        >
                          {sending ? (
                            <LoaderCircle className="spin" size={17} />
                          ) : (
                            <ArrowUp size={19} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              </div>
            </section>
            {editorPresent && (
              <section
                className={`editor-panel ${review ? 'editor-review' : ''} ${editor ? '' : 'is-closing'}`}
                id="workspace-editor"
                aria-label="项目代码"
                aria-hidden={!editor}
                inert={!editor}
              >
                <div className="editor-title">
                  <Code2 size={16} />
                  <strong>{review ? '变更审阅' : '项目代码'}</strong>
                  <span>{project?.name}</span>
                  <div className="editor-title-actions">
                    {review && (
                      <button
                        type="button"
                        className="review-return-files"
                        onClick={() => setReview(null)}
                      >
                        文件视图
                      </button>
                    )}
                    <IconButton
                      title={editorFullscreen ? '退出编辑器全屏' : '全屏显示编辑器'}
                      buttonRef={editorFullscreenToggle}
                      aria-pressed={editorFullscreen}
                      aria-controls="workspace-editor"
                      onClick={() => setEditorFullscreen((value) => !value)}
                    >
                      {editorFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                    </IconButton>
                    <IconButton title="关闭代码面板" onClick={closeEditor}>
                      <X size={17} />
                    </IconButton>
                  </div>
                </div>
                <>
                  {review ? (
                    <Suspense
                      fallback={
                        <LoadingPlaceholder label="正在加载变更审阅…" variant="code" rows={9} />
                      }
                    >
                      <ChangesReview
                        key={`${review.threadId}:${review.turnId}:${review.path || 'all'}`}
                        review={review}
                        summary={turns.find((turn) => turn.id === review.turnId)?.changes}
                        api={api}
                        onSelect={(path) =>
                          setReview((current) => (current ? { ...current, path } : null))
                        }
                        onFile={openCurrentFile}
                      />
                    </Suspense>
                  ) : (
                    <ProjectFiles
                      focusFile={quickOpenFocus}
                      onFocused={finishQuickFocus}
                      onQuickOpen={showQuickOpen}
                      project={project!}
                      files={files}
                      filesLoading={filesLoading}
                      tabs={tabs}
                      selectedFile={selectedFile}
                      tab={tab}
                      fileBusy={fileBusy}
                      theme={theme}
                      uploadDisabled={!project || !!progress || sending}
                      uploadProgress={progress?.scope === 'project' ? progress : null}
                      onCancelUpload={() => abortUpload.current?.abort()}
                      onDropFiles={(dataTransfer) => uploadProject({ dataTransfer })}
                      api={api}
                      Dialog={Modal}
                      notify={notify}
                      onUploadFiles={() => filesInput.current.click()}
                      onUploadFolder={() => folderInput.current.click()}
                      onUploadArchive={() => archiveInput.current.click()}
                      onNewFile={() => fileAction('newFile')}
                      onNewFolder={() => fileAction('newFolder')}
                      onRefresh={() => refreshFiles().catch((e) => notify(e.message, true))}
                      onOpen={openCurrentFile}
                      onAction={currentFileAction}
                      onContext={contextChange}
                      onFileContext={(path) => setContextFile(path)}
                      onDownload={downloadFiles}
                      onDeleted={filesDeleted}
                      beforeDelete={beforeFileDelete}
                      onSelect={setSelectedFile}
                      onCloseTabs={closeTabs}
                      onReload={reloadFile}
                      onSave={saveFile}
                      onEditorSave={saveCurrentFile}
                      onCodeChange={codeChange}
                    />
                  )}
                </>
              </section>
            )}
          </div>
        </main>
        {attachmentPreview && (
          <AttachmentPreview
            key={attachmentPreview.id || attachmentPreview.url}
            item={attachmentPreview as Attachment & ProtocolRecord}
            api={api}
            Dialog={Modal}
            onClose={() => setAttachmentPreview(null)}
          />
        )}
        <input
          hidden
          ref={attachmentPicker}
          type="file"
          multiple
          onChange={(e) => {
            addAttachments([...(e.target as HTMLInputElement).files!]);
            (e.target as HTMLInputElement).value = '';
          }}
        />
        <input
          hidden
          ref={archiveInput}
          type="file"
          multiple
          accept={ARCHIVE_ACCEPT}
          onChange={upload}
        />
        <input hidden ref={filesInput} type="file" multiple onChange={upload} />
        <input hidden ref={folderInput} type="file" multiple webkitdirectory="" onChange={upload} />
        {quickOpen && project && (
          <QuickFilePicker
            key={project.id}
            project={project}
            files={files}
            filesLoading={filesLoading}
            api={api}
            onOpen={openQuickFile}
            onClose={() => setQuickOpen(false)}
          />
        )}
        {uploadConflict && (
          <UploadConflict conflict={uploadConflict} onResolve={uploadConflict.resolve} />
        )}
        {progress && !(progress.scope === 'project' && editorPresent && !review) && (
          <UploadProgress progress={progress} onCancel={() => abortUpload.current?.abort()} />
        )}
        {toast && (
          <div className={`toast ${toast.error ? 'error' : ''}`} role="status">
            {toast.error ? <ShieldCheck size={16} /> : <Check size={16} />}
            <span>{toast.message}</span>
            <IconButton title="关闭提示" onClick={() => setToast(null)}>
              <X size={14} />
            </IconButton>
          </div>
        )}
        {modal === 'project' && (
          <Modal
            title="新建项目"
            subtitle="每个项目都是一个独立的创作空间。"
            onClose={() => setModal(null)}
          >
            <form
              className="modal-form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await newProject(new FormData(e.currentTarget).get('name') as string);
                } catch (caughtError) {
                  const e = caughtError as AppError;
                  notify(e.message, true);
                }
              }}
            >
              <label>
                项目名称
                <input
                  name="name"
                  required
                  autoFocus
                  maxLength={80}
                  placeholder="例如：我的个人网站"
                />
              </label>
              <p className="field-hint">创建后，你可以上传现有代码，或让 Codex 从头开始。</p>
              <button className="primary full">
                <Plus size={16} />
                创建项目
              </button>
            </form>
          </Modal>
        )}
        {['settings', 'appearance', 'profile'].includes(modal!) && (
          <SettingsPanel
            api={api}
            user={user}
            onAvatar={updateAvatar}
            onSkins={updateSkins}
            onResetAppearance={() => setTheme('light')}
            initialTab={
              modal === 'appearance' ? 'appearance' : modal === 'profile' ? 'profile' : 'general'
            }
            settings={settings}
            settingsQueue={settingsQueue.current}
            socket={socket.current}
            models={models}
            account={account!}
            reload={() => loadCapabilities(true)}
            notify={notify}
            onClose={() => setModal(null)}
            onLogout={async () => {
              await api('/logout', { method: 'POST' });
              setUser(null);
            }}
          />
        )}
        {modal === 'liveTerminal' && project && (
          <Modal
            title="网页终端"
            subtitle={
              settings.executionTarget === 'server'
                ? '服务器 root 终端，可以操作系统文件和服务。'
                : '你的独立项目终端，只能修改自己的工作区。输入 codex 即可启动。'
            }
            wide
            onClose={() => setModal(null)}
          >
            <Suspense
              fallback={<LoadingPlaceholder label="正在加载终端…" variant="code" rows={8} />}
            >
              <TerminalView
                socket={socket.current}
                project={project}
                notify={notify}
                theme={theme}
              />
            </Suspense>
          </Modal>
        )}
        {modal === 'terminal' && (
          <Modal
            title="项目终端"
            subtitle={
              settings.executionTarget === 'server'
                ? '命令会以 root 权限在服务器执行，输出显示在对话里。'
                : '命令会在你的独立用户工作区执行，输出显示在对话里。'
            }
            onClose={() => setModal(null)}
          >
            <form
              className="modal-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (commandPending.current || !thread || !command.trim()) return;
                commandPending.current = true;
                setCommandBusy(true);
                try {
                  await socket.current.call('thread/shellCommand', {
                    threadId: thread.id,
                    command,
                    timeoutMs: 60000,
                  });
                  setModal((current) => (current === 'terminal' ? null : current));
                } catch (caughtError) {
                  const e = caughtError as AppError;
                  notify(e.message, true);
                } finally {
                  commandPending.current = false;
                  setCommandBusy(false);
                }
              }}
            >
              <label>
                Shell 命令
                <textarea
                  className="code-input"
                  value={command}
                  onChange={(e) => setCommand((e.target as HTMLTextAreaElement).value)}
                  placeholder="git status --short"
                  rows={3}
                  required
                />
              </label>
              <button
                className="primary full"
                disabled={commandBusy || !command.trim() || status !== 'connected'}
              >
                {commandBusy ? <LoaderCircle size={15} className="spin" /> : <Terminal size={15} />}{' '}
                {commandBusy ? '执行中…' : '执行命令'}
              </button>
            </form>
          </Modal>
        )}
      </div>
      {dialogs.element}
      {memoMounted && (
        <MemoPanel api={api} userId={user.id} open={memoOpen} onClose={() => setMemoOpen(false)} />
      )}
      {welcomeVisible && (
        <WorkspaceWelcome
          user={user}
          ready={status === 'connected' && !listsLoading && !welcomeError}
          error={welcomeError}
          onExited={enterWorkspace}
          onContinue={enterWorkspace}
          onRetry={() => location.reload()}
        />
      )}
    </>
  );
}
