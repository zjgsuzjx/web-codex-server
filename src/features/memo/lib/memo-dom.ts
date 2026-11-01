import { memoTags, validateMemo, type MemoNode } from '../../../../shared/workspace/memo.ts';

export function readMemo(root: HTMLElement): MemoNode[] {
  function read(node: Node): MemoNode[] {
    if (node.nodeType === Node.TEXT_NODE) return [{ text: node.textContent || '' }];
    if (!(node instanceof HTMLElement) || node.tagName === 'BUTTON') return [];
    let children = [...node.childNodes].flatMap(read);
    const tag = node.tagName.toLowerCase();
    if (node.style.fontWeight === 'bold' || Number(node.style.fontWeight) >= 600)
      children = [{ tag: 'b', children }];
    if (node.style.fontStyle === 'italic') children = [{ tag: 'i', children }];
    if (node.style.textDecoration.includes('underline')) children = [{ tag: 'u', children }];
    if (!(memoTags as readonly string[]).includes(tag)) return children;
    const size = Number(node.getAttribute('size'));
    return [
      {
        tag: tag as MemoNode['tag'],
        children,
        ...(size >= 1 && size <= 7 ? { size } : {}),
        ...(tag === 'div' && node.hasAttribute('data-task')
          ? { checked: node.dataset.checked === 'true' }
          : {}),
      },
    ];
  }
  return validateMemo([...root.childNodes].flatMap(read));
}

export function taskButton(checked: boolean) {
  const button = document.createElement('button');
  button.type = 'button';
  button.contentEditable = 'false';
  button.className = 'memo-task-toggle';
  button.setAttribute('role', 'checkbox');
  button.setAttribute('aria-label', '完成待办');
  button.setAttribute('aria-checked', String(checked));
  return button;
}

export function renderMemo(root: HTMLElement, nodes: MemoNode[]) {
  function render(node: MemoNode): Node {
    if (node.text !== undefined) return document.createTextNode(node.text);
    const element = document.createElement(node.tag || 'span');
    if (node.size) element.setAttribute('size', String(node.size));
    if (node.checked !== undefined) {
      element.dataset.task = '';
      element.dataset.checked = String(node.checked);
      element.append(taskButton(node.checked));
    }
    element.append(...(node.children || []).map(render));
    return element;
  }
  root.replaceChildren(...nodes.map(render));
}
