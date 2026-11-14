import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CornerDownLeft,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Terminal,
  Wrench,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type TextareaHTMLAttributes } from 'react';
import type { LiveSocket } from '../../../lib/socket.ts';

type Shortcut = { name: string; text: string };
export const shortcutKey = (userId: string) => `composer:shortcuts:${userId}`;
export function readShortcuts(userId: string): Shortcut[] {
  try {
    const value = JSON.parse(localStorage.getItem(shortcutKey(userId)) || '[]');
    return Array.isArray(value)
      ? value.filter((x) => typeof x?.name === 'string' && typeof x?.text === 'string')
      : [];
  } catch {
    return [];
  }
}
interface Item {
  id: string;
  name: string;
  description: string;
  text: string;
  kind: string;
}
export default function PromptInput({
  socket,
  userId,
  value,
  onValue,
  onManage,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  socket: LiveSocket;
  userId: string;
  value: string;
  onValue: (value: string) => void;
  onManage?: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const token = /(?:^|\s)([/@])([^\s/@]*)$/.exec(value.slice(0, cursor));
  const mode = !dismissed && token ? token[1] : '';
  const query = token?.[2].toLocaleLowerCase() || '';
  useEffect(() => {
    setActive(0);
    if (!mode) return;
    let cancelled = false;
    setItems([]);
    setLoading(false);
    if (mode === '/') {
      setItems(
        readShortcuts(userId).map((x) => ({
          id: x.name,
          name: x.name,
          description: x.text,
          text: x.text,
          kind: '快捷指令',
        })),
      );
      setMessage('还没有快捷指令，请在设置 → 工具与技能中添加');
      return;
    }
    setLoading(true);
    setMessage('正在加载工具与技能…');
    Promise.allSettled([
      socket.call('skills/list', {}),
      socket.call('mcpServerStatus/list', { limit: 100 }),
    ]).then(([skills, mcp]) => {
      if (cancelled) return;
      setLoading(false);
      const result: Item[] = [];
      if (skills.status === 'fulfilled')
        for (const group of skills.value?.data || [])
          for (const skill of group.skills || []) {
            if (skill.enabled === false || !skill.name || !skill.path) continue;
            result.push({
              id: `skill:${skill.path}`,
              name: skill.name,
              description: skill.description || skill.shortDescription || '',
              text: `[$${skill.name}](${skill.path}) `,
              kind: 'Skill',
            });
          }
      if (mcp.status === 'fulfilled')
        for (const server of mcp.value?.data || []) {
          if (!server.name) continue;
          result.push({
            id: `mcp:${server.name}`,
            name: server.name,
            description: `${Object.keys(server.tools || {}).length} 个工具`,
            text: `@${server.name} `,
            kind: 'MCP',
          });
        }
      setItems([...new Map(result.map((x) => [x.id, x])).values()]);
      setMessage(
        skills.status === 'rejected' || mcp.status === 'rejected'
          ? '部分列表加载失败，关闭后重新输入 @ 重试'
          : '没有已安装的 MCP 或 Skill',
      );
    });
    return () => {
      cancelled = true;
    };
  }, [mode, socket, userId]);
  const filtered = items.filter((x) =>
    `${x.name} ${x.description}`.toLocaleLowerCase().includes(query),
  );
  const selected = Math.min(active, Math.max(0, filtered.length - 1));
  function choose(item: Item) {
    const start = cursor - (token?.[2].length || 0) - 1;
    const next = value.slice(0, start) + item.text + value.slice(cursor);
    const caret = start + item.text.length;
    onValue(next);
    setDismissed(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
      setCursor(caret);
    });
  }
  useEffect(() => {
    const list = document.getElementById(id);
    const option = document.getElementById(`${id}-${selected}`);
    if (!mode || !list || !option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }, [selected, mode, id]);
  return (
    <div
      className="prompt-input"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && e.target !== input.current) {
          e.preventDefault();
          e.stopPropagation();
          setDismissed(true);
          input.current?.focus();
        }
      }}
    >
      {mode && (
        <div className="prompt-menu">
          <header className="prompt-menu-heading">
            <span>{mode === '/' ? '快捷指令' : '工具与技能'}</span>
            {mode === '/' && onManage && (
              <button
                type="button"
                className="prompt-manage"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setDismissed(true);
                  onManage();
                }}
              >
                <SlidersHorizontal size={12} />
                管理指令
              </button>
            )}
          </header>
          <div
            className="prompt-options"
            role="listbox"
            id={id}
            aria-label={mode === '/' ? '快捷指令' : '工具与技能'}
            aria-busy={loading}
          >
            {filtered.map((item, index) => {
              const Icon = mode === '/' ? Terminal : item.kind === 'Skill' ? BookOpen : Wrench;
              return (
                <button
                  type="button"
                  tabIndex={-1}
                  role="option"
                  aria-selected={index === selected}
                  id={`${id}-${index}`}
                  key={item.id}
                  className={`prompt-option ${index === selected ? 'active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(item)}
                >
                  <span className="prompt-option-icon">
                    <Icon size={17} strokeWidth={1.65} />
                  </span>
                  <span className="prompt-option-copy">
                    <span className="prompt-option-title">
                      <strong>
                        {mode === '/' && <span className="prompt-prefix">/</span>}
                        {item.name}
                      </strong>
                      {mode === '@' && <span className="prompt-kind">{item.kind}</span>}
                    </span>
                    <span className="prompt-option-description">
                      {item.description || '选择后添加到消息'}
                    </span>
                  </span>
                  <CornerDownLeft className="prompt-return" size={14} aria-hidden="true" />
                </button>
              );
            })}
            {!filtered.length && (
              <div className="prompt-empty" role="status">
                {loading ? <LoaderCircle size={19} className="spin" /> : <Search size={19} />}
                <strong>
                  {loading
                    ? '正在读取工具与技能'
                    : items.length
                      ? '没有找到匹配项'
                      : mode === '/'
                        ? '把常用提示词存为快捷指令'
                        : '暂无可用工具与技能'}
                </strong>
                <span>
                  {items.length
                    ? '试试其他名称或关键词'
                    : mode === '/'
                      ? '点击右上角「管理指令」添加，之后输入 / 即可使用。'
                      : message}
                </span>
              </div>
            )}
          </div>
          <footer className="prompt-menu-footer">
            <span>
              <kbd>
                <ArrowUp size={10} />
                <ArrowDown size={10} />
              </kbd>
              选择
            </span>
            <span>
              <kbd>↵</kbd>填入
            </span>
            <span className="prompt-dismiss-hint">
              <kbd>esc</kbd>关闭
            </span>
          </footer>
        </div>
      )}
      <textarea
        {...props}
        ref={input}
        value={value}
        aria-autocomplete="list"
        aria-controls={mode ? id : undefined}
        aria-expanded={!!mode}
        aria-activedescendant={mode && filtered.length ? `${id}-${selected}` : undefined}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) setDismissed(true);
          props.onBlur?.(e);
        }}
        onSelect={(e) => {
          if (e.currentTarget.selectionStart !== cursor) {
            setCursor(e.currentTarget.selectionStart);
            setDismissed(false);
            setActive(0);
          }
        }}
        onChange={(e) => {
          onValue(e.target.value);
          setCursor(e.target.selectionStart);
          setDismissed(false);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (mode && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setDismissed(true);
            return;
          }
          if (mode && !filtered.length && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            return;
          }
          if (
            mode &&
            filtered.length &&
            ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key) &&
            !e.shiftKey
          ) {
            e.preventDefault();
            if (e.key === 'Enter' || e.key === 'Tab') choose(filtered[selected]);
            else
              setActive(
                (selected + (e.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length,
              );
            return;
          }
          props.onKeyDown?.(e);
        }}
      />
    </div>
  );
}
