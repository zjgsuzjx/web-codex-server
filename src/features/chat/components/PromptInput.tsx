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
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  socket: LiveSocket;
  userId: string;
  value: string;
  onValue: (value: string) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState('');
  const token = /(?:^|\s)([/@])([^\s/@]*)$/.exec(value.slice(0, cursor));
  const mode = !dismissed && token ? token[1] : '';
  const query = token?.[2].toLocaleLowerCase() || '';
  useEffect(() => {
    setActive(0);
    if (!mode) return;
    let cancelled = false;
    setItems([]);
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
    setMessage('正在加载工具与技能…');
    Promise.allSettled([
      socket.call('skills/list', {}),
      socket.call('mcpServerStatus/list', { limit: 100 }),
    ]).then(([skills, mcp]) => {
      if (cancelled) return;
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
    const start = cursor - query.length - 1;
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
    if (mode) document.getElementById(`${id}-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, mode, id]);
  return (
    <div className="prompt-input">
      {mode && (
        <div className="prompt-menu">
          <header>
            {mode === '/' ? '快捷指令' : '工具与技能'}
            <small>↑ ↓ 选择 · Enter 填入 · Esc 关闭</small>
          </header>
          <div role="listbox" id={id} aria-label={mode === '/' ? '快捷指令' : '工具与技能'}>
            {filtered.map((item, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === selected}
                id={`${id}-${index}`}
                key={item.id}
                className={index === selected ? 'active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(item)}
              >
                <span className="prompt-symbol">{mode === '/' ? '/' : '@'}</span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
                <em>{item.kind}</em>
              </button>
            ))}
            {!filtered.length && <p role="status">{items.length ? '没有匹配结果' : message}</p>}
          </div>
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
          setDismissed(true);
          props.onBlur?.(e);
        }}
        onSelect={(e) => {
          setCursor(e.currentTarget.selectionStart);
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
