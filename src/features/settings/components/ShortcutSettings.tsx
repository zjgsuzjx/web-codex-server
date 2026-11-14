import { useState } from 'react';
import { readShortcuts, shortcutKey } from '../../chat/components/PromptInput.tsx';
export default function ShortcutSettings({ userId }: { userId: string }) {
  const [items, setItems] = useState(() => readShortcuts(userId));
  const [error, setError] = useState('');
  function save() {
    if (
      items.some((x) => !/^[\p{L}\p{N}_-]+$/u.test(x.name) || !x.text.trim()) ||
      new Set(items.map((x) => x.name)).size !== items.length
    ) {
      setError('指令名须唯一，且只含文字、数字、下划线或连字符；填充内容不能为空。');
      return;
    }
    try {
      localStorage.setItem(shortcutKey(userId), JSON.stringify(items));
      setError('已保存');
    } catch {
      setError('保存失败，请检查浏览器存储空间');
    }
  }
  return (
    <section className="shortcut-settings">
      <h4>快捷输入指令</h4>
      <p className="field-hint">输入 / 搜索并填入常用提示词。保存在当前浏览器，按账号区分。</p>
      {items.map((item, index) => (
        <div className="shortcut-editor" key={index}>
          <input
            aria-label={`指令名称 ${index + 1}`}
            placeholder="指令名称，例如 review"
            value={item.name}
            onChange={(e) =>
              setItems(items.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)))
            }
          />
          <textarea
            aria-label={`填充内容 ${index + 1}`}
            placeholder="选择指令后填入的内容"
            value={item.text}
            onChange={(e) =>
              setItems(items.map((x, i) => (i === index ? { ...x, text: e.target.value } : x)))
            }
          />
          <button
            type="button"
            className="secondary"
            onClick={() => setItems(items.filter((_, i) => i !== index))}
          >
            删除
          </button>
        </div>
      ))}
      <div className="tool-buttons">
        <button
          type="button"
          className="secondary"
          onClick={() => setItems([...items, { name: '', text: '' }])}
        >
          添加指令
        </button>
        <button type="button" className="secondary" onClick={save}>
          保存快捷指令
        </button>
      </div>
      <p role="status">{error}</p>
    </section>
  );
}
