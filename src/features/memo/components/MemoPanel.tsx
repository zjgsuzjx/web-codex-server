import {
  Bold,
  Check,
  CircleCheck,
  Download,
  Grip,
  Italic,
  LoaderCircle,
  RotateCcw,
  StickyNote,
  Underline,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { ApiClient } from '../../../../shared/contracts/api.ts';
import {
  memoMarkdown,
  validateMemo,
  type MemoDocument,
  type MemoNode,
} from '../../../../shared/workspace/memo.ts';
import { readMemo, renderMemo, taskButton } from '../lib/memo-dom.ts';

interface Props {
  api: ApiClient;
  userId: string;
  open: boolean;
  onClose: () => void;
}
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
function clamp(bounds: Bounds): Bounds {
  const width = Math.min(Math.max(280, bounds.width), window.innerWidth - 16);
  const height = Math.min(Math.max(260, bounds.height), window.innerHeight - 24);
  return {
    width,
    height,
    x: Math.max(8, Math.min(bounds.x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(bounds.y, window.innerHeight - height - 8)),
  };
}

export default function MemoPanel({ api, userId, open, onClose }: Props) {
  const key = `workspace:memo:${userId}`;
  const editor = useRef<HTMLDivElement>(null);
  const version = useRef(0),
    revision = useRef(0),
    savedRevision = useRef(0),
    saving = useRef(false),
    ready = useRef(false),
    conflict = useRef(false);
  const nodes = useRef<MemoNode[]>([]),
    selection = useRef<Range | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [status, setStatus] = useState('正在读取…'),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false);
  const [bounds, setBounds] = useState<Bounds>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(`${key}:bounds`) || 'null');
      if (
        value &&
        ['x', 'y', 'width', 'height'].every(
          (name) => typeof value[name] === 'number' && Number.isFinite(value[name]),
        )
      )
        return clamp(value);
    } catch {
      /* Use the default position. */
    }
    return clamp({ x: window.innerWidth - 416, y: 80, width: 392, height: 488 });
  });
  const persist = useCallback(() => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          nodes: nodes.current,
          version: version.current,
          dirty: revision.current !== savedRevision.current,
        }),
      );
    } catch {
      /* Server persistence remains available when browser storage is full. */
    }
  }, [key]);
  const save = useCallback(
    async function saveLatest() {
      if (
        !ready.current ||
        conflict.current ||
        saving.current ||
        revision.current === savedRevision.current
      )
        return;
      saving.current = true;
      setStatus('正在保存…');
      const sentRevision = revision.current;
      try {
        const result = await api('/memo', {
          method: 'PUT',
          body: { nodes: nodes.current, version: version.current },
        });
        version.current = result.version;
        savedRevision.current = sentRevision;
        persist();
        setError('');
        setStatus('已自动保存');
      } catch (caught) {
        const e = caught as Error & { status?: number };
        conflict.current = e.status === 409;
        setError(e.message);
        setStatus('尚未同步');
      } finally {
        saving.current = false;
      }
      if (
        !conflict.current &&
        savedRevision.current === sentRevision &&
        revision.current !== sentRevision
      )
        void saveLatest();
    },
    [api, persist],
  );
  const load = useCallback(
    async (preferLocal = true) => {
      setError('');
      try {
        const cloud = await api('/memo');
        let draft: Pick<MemoDocument, 'nodes' | 'version'> | null = null;
        if (preferLocal)
          try {
            const value = JSON.parse(localStorage.getItem(key) || 'null');
            if (value?.dirty === true && Number.isSafeInteger(value.version))
              draft = { version: value.version, nodes: validateMemo(value.nodes) };
          } catch {
            /* Ignore an invalid browser draft. */
          }
        version.current = cloud.version;
        nodes.current = draft?.nodes || cloud.nodes;
        renderMemo(editor.current!, nodes.current);
        ready.current = true;
        setLoaded(true);
        conflict.current = false;
        if (draft && JSON.stringify(draft.nodes) !== JSON.stringify(cloud.nodes)) {
          revision.current++;
          if (draft.version !== cloud.version) {
            conflict.current = true;
            setError('云端已有更新，本地草稿已保留。请选择要保留的内容。');
            setStatus('存在不同版本');
          } else void save();
        } else {
          savedRevision.current = revision.current;
          persist();
          setStatus('已自动保存');
        }
      } catch (caught) {
        setError((caught as Error).message);
        setStatus('读取失败');
      }
    },
    [api, key, save, persist],
  );
  useEffect(() => {
    void load();
    return () => {
      clearTimeout(timer.current);
      void save();
    };
  }, [load, save]);
  useEffect(() => {
    const resize = () => setBounds((b) => clamp(b));
    const flush = () => {
      if (document.visibilityState === 'hidden') void save();
    };
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('online', save);
    return () => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('online', save);
    };
  }, [save]);
  useEffect(() => {
    try {
      localStorage.setItem(`${key}:bounds`, JSON.stringify(bounds));
    } catch {
      /* Position is optional. */
    }
  }, [bounds, key]);
  function changed() {
    try {
      nodes.current = readMemo(editor.current!);
      revision.current++;
      persist();
      setStatus('等待保存…');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), 450);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }
  function rememberSelection() {
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
    if (range && editor.current?.contains(range.commonAncestorContainer))
      selection.current = range.cloneRange();
  }
  function restoreSelection() {
    editor.current?.focus();
    if (selection.current && editor.current?.contains(selection.current.commonAncestorContainer)) {
      const current = window.getSelection();
      current?.removeAllRanges();
      current?.addRange(selection.current);
    }
  }
  function format(command: string, value?: string) {
    restoreSelection();
    document.execCommand(command, false, value);
    rememberSelection();
    changed();
  }
  function checklist() {
    restoreSelection();
    document.execCommand('formatBlock', false, 'div');
    const anchor = window.getSelection()?.anchorNode;
    const element = anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
    let block = element?.closest('div');
    if (!block || block === editor.current || !editor.current?.contains(block)) return;
    if (block.hasAttribute('data-task')) {
      block.removeAttribute('data-task');
      block.removeAttribute('data-checked');
      block.querySelector('button')?.remove();
    } else {
      block.dataset.task = '';
      block.dataset.checked = 'false';
      block.prepend(taskButton(false));
    }
    rememberSelection();
    changed();
  }
  function gesture(event: PointerEvent<HTMLElement>, resize = false) {
    if (event.button !== 0 || (!resize && (event.target as HTMLElement).closest('button'))) return;
    event.preventDefault();
    const target = event.currentTarget,
      start = { ...bounds },
      x = event.clientX,
      y = event.clientY;
    target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) =>
      setBounds(
        clamp(
          resize
            ? { ...start, width: start.width + e.clientX - x, height: start.height + e.clientY - y }
            : { ...start, x: start.x + e.clientX - x, y: start.y + e.clientY - y },
        ),
      );
    const stop = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', stop);
      target.removeEventListener('pointercancel', stop);
      target.removeEventListener('lostpointercapture', stop);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', stop);
    target.addEventListener('pointercancel', stop);
    target.addEventListener('lostpointercapture', stop);
  }
  const toggleTask = (button: HTMLElement) => {
    const block = button.closest<HTMLElement>('[data-task]');
    if (!block) return;
    block.dataset.checked = String(block.dataset.checked !== 'true');
    button.setAttribute('aria-checked', block.dataset.checked);
    changed();
  };
  return (
    <section
      id="workspace-memo"
      className="memo-panel"
      aria-label="备忘录"
      hidden={!open}
      style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
    >
      <header className="memo-heading" onPointerDown={gesture}>
        <span className="memo-emblem">
          <StickyNote size={17} />
        </span>
        <div>
          <h3>备忘录</h3>
          <span>留住此刻的灵感</span>
        </div>
        <Grip size={14} className="memo-drag-hint" />
        <button
          aria-label="导出 Markdown"
          className="memo-icon"
          disabled={!loaded}
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([memoMarkdown(nodes.current)], { type: 'text/markdown;charset=utf-8' }),
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = `备忘录-${new Date().toLocaleDateString('sv-SE')}.md`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={16} />
        </button>
        <button
          aria-label="关闭备忘录"
          className="memo-icon"
          onClick={() => {
            void save();
            onClose();
          }}
        >
          <X size={17} />
        </button>
      </header>
      <div className="memo-format" role="toolbar" aria-label="备忘录格式">
        {(
          [
            [Bold, '加粗', 'bold'],
            [Italic, '倾斜', 'italic'],
            [Underline, '下划线', 'underline'],
          ] as const
        ).map(([Icon, label, command]) => (
          <button
            key={command}
            className="memo-icon"
            title={label}
            aria-label={label}
            disabled={!loaded}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => format(command)}
          >
            <Icon size={16} />
          </button>
        ))}
        <span className="memo-divider" />
        <button
          className="memo-icon"
          title="圆圈待办列表"
          aria-label="圆圈待办列表"
          disabled={!loaded}
          onPointerDown={(e) => e.preventDefault()}
          onClick={checklist}
        >
          <CircleCheck size={17} />
        </button>
        <span className="memo-divider" />
        <select
          aria-label="字号"
          defaultValue="3"
          disabled={!loaded}
          onChange={(e) => format('fontSize', e.target.value)}
        >
          <option value="2">小号</option>
          <option value="3">正文</option>
          <option value="5">大号</option>
        </select>
        <button
          className="memo-icon memo-format-clear"
          title="清除格式"
          aria-label="清除格式"
          disabled={!loaded}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => format('removeFormat')}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      {error && (
        <div className="memo-error" role="alert">
          <span>{error}</span>
          {conflict.current ? (
            <div>
              <button onClick={() => void load(false)}>载入云端</button>
              <button
                onClick={async () => {
                  try {
                    version.current = (await api('/memo')).version;
                    conflict.current = false;
                    void save();
                  } catch (caught) {
                    setError((caught as Error).message);
                  }
                }}
              >
                保留本地
              </button>
            </div>
          ) : (
            <button onClick={() => (loaded ? void save() : void load())}>重试</button>
          )}
        </div>
      )}
      <div
        ref={editor}
        className="memo-editor"
        contentEditable={loaded}
        suppressContentEditableWarning
        role="textbox"
        aria-label="备忘录内容"
        aria-multiline="true"
        data-placeholder="写下一点想法，或列出今天的待办…"
        spellCheck="false"
        onInput={changed}
        onKeyUp={rememberSelection}
        onPointerUp={rememberSelection}
        onBlur={rememberSelection}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          changed();
        }}
        onDrop={(e) => e.preventDefault()}
        onClick={(e) => {
          const button = (e.target as HTMLElement).closest<HTMLElement>('.memo-task-toggle');
          if (button) toggleTask(button);
        }}
        onKeyDown={(e) => {
          const button = (e.target as HTMLElement).closest<HTMLElement>('.memo-task-toggle');
          if (button && (e.key === ' ' || e.key === 'Enter')) {
            e.preventDefault();
            toggleTask(button);
            return;
          }
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
          const range = window.getSelection()?.rangeCount
            ? window.getSelection()!.getRangeAt(0)
            : null;
          const element =
            range?.startContainer instanceof HTMLElement
              ? range.startContainer
              : range?.startContainer.parentElement;
          const block = element?.closest<HTMLElement>('[data-task]');
          if (!range || !block || !editor.current?.contains(block)) return;
          e.preventDefault();
          range.deleteContents();
          const next = document.createElement('div');
          if (block.textContent?.trim()) {
            const tail = document.createRange();
            tail.selectNodeContents(block);
            tail.setStart(range.startContainer, range.startOffset);
            next.dataset.task = '';
            next.dataset.checked = 'false';
            next.append(taskButton(false), tail.extractContents());
          }
          if (!next.textContent) next.append(document.createElement('br'));
          block.after(next);
          if (!block.textContent?.trim()) block.remove();
          const caret = document.createRange();
          caret.selectNodeContents(next);
          if (next.firstChild instanceof HTMLButtonElement) caret.setStartAfter(next.firstChild);
          caret.collapse(true);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(caret);
          rememberSelection();
          changed();
        }}
      />
      <footer className="memo-footer">
        <span role="status">
          {status.includes('正在') ? (
            <LoaderCircle size={12} className="spin" />
          ) : (
            <Check size={12} />
          )}
          {status}
        </span>
        <span>私人备忘 · Markdown 导出</span>
      </footer>
      <button
        className="memo-resize"
        aria-label="调整备忘录大小"
        onPointerDown={(e) => gesture(e, true)}
        onKeyDown={(e) => {
          if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
            e.preventDefault();
            setBounds((b) =>
              clamp({
                ...b,
                width: b.width + (e.key === 'ArrowRight' ? 20 : e.key === 'ArrowLeft' ? -20 : 0),
                height: b.height + (e.key === 'ArrowDown' ? 20 : e.key === 'ArrowUp' ? -20 : 0),
              }),
            );
          }
        }}
      />
    </section>
  );
}
