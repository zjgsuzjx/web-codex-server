import { ArrowLeft, Check, ChevronRight, Info, Plus, Terminal, Trash2, Undo2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import IconButton from '../../../components/ui/IconButton.tsx';
import Tooltip from '../../../components/ui/Tooltip.tsx';
import { readShortcuts, shortcutKey } from '../../chat/components/PromptInput.tsx';
type Shortcut = { name: string; text: string };
export default function ShortcutSettings({ userId }: { userId: string }) {
  const [items, setItems] = useState(() => readShortcuts(userId));
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Shortcut>({ name: '', text: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removed, setRemoved] = useState<Shortcut[] | null>(null);
  const add = useRef<HTMLButtonElement>(null);
  const id = useId();
  function open(index: number) {
    setEditing(index);
    setDraft(items[index] || { name: '', text: '' });
    setError('');
    setNotice('');
  }
  function close() {
    setEditing(null);
    setError('');
    requestAnimationFrame(() => add.current?.focus());
  }
  function persist(next: Shortcut[], message: string) {
    try {
      localStorage.setItem(shortcutKey(userId), JSON.stringify(next));
      setItems(next);
      setNotice(message);
      setError('');
      return true;
    } catch {
      setError('保存失败，请检查浏览器存储空间。');
      return false;
    }
  }
  function save() {
    const item = { name: draft.name.trim().replace(/^\//, ''), text: draft.text.trim() };
    if (!/^[\p{L}\p{N}_-]+$/u.test(item.name)) {
      setError('请输入指令名，只使用文字、数字、下划线或连字符。');
      return;
    }
    if (items.some((x, i) => i !== editing && x.name === item.name)) {
      setError('这个指令名已存在，请换一个名称。');
      return;
    }
    if (!item.text) {
      setError('请填写选择指令后要插入的内容。');
      return;
    }
    const next = [...items];
    next[editing!] = item;
    if (persist(next, '指令已保存')) {
      setRemoved(null);
      close();
    }
  }
  return (
    <section className="shortcut-settings">
      <div className="shortcut-heading">
        <div className="shortcut-title">
          <h4>快捷指令</h4>
          <IconButton
            title="快捷指令"
            description="输入 / 调用常用提示词。指令按账号保存在当前浏览器，不会跨设备同步。"
          >
            <Info size={14} />
          </IconButton>
        </div>
        {editing === null && (
          <button
            ref={add}
            type="button"
            className="secondary shortcut-add"
            onClick={() => open(items.length)}
          >
            <Plus size={14} />
            新建指令
          </button>
        )}
      </div>
      {editing === null ? (
        <>
          <div className="shortcut-list">
            {items.length ? (
              items.map((item, index) => (
                <Tooltip
                  key={item.name}
                  title={`/${item.name}`}
                  description={item.text.slice(0, 400)}
                >
                  <button type="button" className="shortcut-row" onClick={() => open(index)}>
                    <Terminal size={17} strokeWidth={1.65} />
                    <span>
                      <strong>
                        <span>/</span>
                        {item.name}
                      </strong>
                      <span className="shortcut-preview">{item.text}</span>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                </Tooltip>
              ))
            ) : (
              <div className="shortcut-empty">
                <Terminal size={24} strokeWidth={1.5} />
                <strong>暂无快捷指令</strong>
              </div>
            )}
          </div>
          {(notice || removed) && (
            <div className="shortcut-status">
              <span role="status">
                {notice ? (
                  <>
                    <Check size={13} />
                    {notice}
                  </>
                ) : null}
              </span>
              {removed && (
                <button
                  type="button"
                  onClick={() => {
                    if (persist(removed, '已恢复删除的指令')) setRemoved(null);
                  }}
                >
                  <Undo2 size={13} />
                  撤销删除
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div
          className="shortcut-editor"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              save();
            }
          }}
        >
          <button type="button" className="shortcut-back" onClick={close}>
            <ArrowLeft size={13} />
            {editing === items.length ? '新建指令' : '编辑指令'}
          </button>
          <label htmlFor={`${id}-name`}>指令名称</label>
          <div className="shortcut-name">
            <span aria-hidden="true">/</span>
            <input
              id={`${id}-name`}
              autoFocus
              placeholder="例如 review"
              value={draft.name}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) => {
                setDraft({ ...draft, name: e.target.value });
                setError('');
              }}
            />
          </div>
          <label htmlFor={`${id}-text`}>填充内容</label>
          <textarea
            id={`${id}-text`}
            placeholder="例如：审查当前改动，重点检查潜在错误、安全风险和缺失的测试。"
            value={draft.text}
            onChange={(e) => {
              setDraft({ ...draft, text: e.target.value });
              setError('');
            }}
          />
          <div className="shortcut-editor-actions">
            {editing < items.length && (
              <button
                type="button"
                className="shortcut-delete"
                onClick={() => {
                  if (
                    persist(
                      items.filter((_, i) => i !== editing),
                      '指令已删除',
                    )
                  ) {
                    setRemoved(items);
                    close();
                  }
                }}
              >
                <Trash2 size={14} />
                删除
              </button>
            )}
            <span className="shortcut-action-spacer" />
            <button type="button" className="secondary" onClick={close}>
              取消
            </button>
            <Tooltip title="保存指令" description="Ctrl / ⌘ + Enter">
              <button type="button" className="primary" onClick={save}>
                保存
              </button>
            </Tooltip>
          </div>
        </div>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="shortcut-error">
          {error}
        </p>
      )}
    </section>
  );
}
