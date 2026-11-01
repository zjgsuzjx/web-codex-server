export const MEMO_LIMIT = 100_000;
export const memoTags = [
  'div',
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  'span',
  'font',
  'ul',
  'ol',
  'li',
] as const;
export interface MemoNode {
  tag?: (typeof memoTags)[number];
  text?: string;
  size?: number;
  checked?: boolean;
  children?: MemoNode[];
}
export interface MemoDocument {
  nodes: MemoNode[];
  version: number;
  updated: number | null;
}

/** Only structured text and a small formatting vocabulary cross the trust boundary. */
export function validateMemo(value: unknown): MemoNode[] {
  let count = 0,
    length = 0;
  function visit(value: unknown, depth: number): MemoNode {
    if (!value || typeof value !== 'object' || depth > 20 || ++count > 15000)
      throw new Error('备忘录结构过于复杂');
    const node = value as MemoNode;
    if (typeof node.text === 'string') {
      length += node.text.length;
      if (length > MEMO_LIMIT) throw new Error('备忘录最多支持 100,000 个字符');
      return { text: node.text };
    }
    if (!node.tag || !memoTags.includes(node.tag)) throw new Error('不支持的备忘录格式');
    if (node.size !== undefined && (!Number.isInteger(node.size) || node.size < 1 || node.size > 7))
      throw new Error('字号无效');
    if (node.checked !== undefined && (node.tag !== 'div' || typeof node.checked !== 'boolean'))
      throw new Error('待办格式无效');
    if (node.children !== undefined && !Array.isArray(node.children))
      throw new Error('备忘录内容无效');
    return {
      tag: node.tag,
      ...(node.size ? { size: node.size } : {}),
      ...(node.checked !== undefined ? { checked: node.checked } : {}),
      children: (node.children || []).map((child) => visit(child, depth + 1)),
    };
  }
  if (!Array.isArray(value)) throw new Error('备忘录内容无效');
  return value.map((node) => visit(node, 0));
}

export function memoMarkdown(nodes: MemoNode[]): string {
  const escape = (text: string) => text.replace(/([\\`*_{}\[\]<>#+.!|~-])/g, '\\$1');
  function render(node: MemoNode): string {
    if (node.text !== undefined) return escape(node.text);
    const body = (node.children || []).map(render).join('');
    if (node.checked !== undefined) return `\n- [${node.checked ? 'x' : ' '}] ${body.trim()}\n`;
    if (node.tag === 'br') return '\n';
    if (node.tag === 'b' || node.tag === 'strong') return body.trim() ? `**${body}**` : body;
    if (node.tag === 'i' || node.tag === 'em') return body.trim() ? `*${body}*` : body;
    if (node.tag === 'u') return `<u>${body}</u>`;
    if (node.tag === 'li') return `\n- ${body.trim()}\n`;
    if (['div', 'p', 'ul', 'ol'].includes(node.tag || '')) return `\n${body}\n`;
    return body;
  }
  return (
    nodes
      .map(render)
      .join('')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}
