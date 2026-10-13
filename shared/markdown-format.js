import { decodeString } from 'micromark-util-decode-string';

const inlineParents = new Set(['paragraph', 'heading', 'tableCell', 'link', 'strong', 'emphasis', 'delete']);
const text = value => ({ type: 'text', value });
const plainText = node => node.value ?? node.children?.map(plainText).join('') ?? '';

// Work on parsed text, never on code, URLs, HTML attributes, or escaped markers.
function textTokens(node, source) {
  const start = node.position?.start.offset, end = node.position?.end.offset;
  if (node.type !== 'text' || start == null || end == null) return [node];
  const raw = source.slice(start, end).replace(/\r\n?/g, '\n');
  if (!raw.includes('**') || decodeString(raw) !== node.value) return [node];
  const tokens = []; let previous = 0;
  for (const match of raw.matchAll(/\*{2,}/g)) {
    const index = match.index;
    if (match[0].length !== 2) continue;
    let escapes = 0;
    for (let i = index - 1; i >= 0 && raw[i] === '\\'; i--) escapes++;
    if (escapes % 2) continue;
    if (index > previous) tokens.push(text(decodeString(raw.slice(previous, index))));
    tokens.push({ type: 'boldMarker' }); previous = index + 2;
  }
  if (!tokens.length) return [node];
  if (previous < raw.length) tokens.push(text(decodeString(raw.slice(previous))));
  return tokens;
}

function repairStrong(children, source) {
  const tokens = []; let unmatched = false;
  for (const node of children.flatMap(child => textTokens(child, source))) {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    const raw = node.type === 'strong' && start != null && end != null ? source.slice(start, end) : '';
    // CommonMark can pair the middle delimiters in **标题：**正文**标题： **.
    // Recover those boundaries without flattening ordinary nested emphasis.
    if (unmatched && node.type === 'strong' && /[\p{P}\p{S}]$/u.test(tokens.at(-1)?.value || '') && /^\*\*[^*]/.test(raw) && /[^*]\*\*$/.test(raw)) {
      tokens.push({ type: 'boldMarker' }, ...node.children, { type: 'boldMarker' });
    } else {
      tokens.push(node);
      if (node.type === 'boldMarker') unmatched = !unmatched;
    }
  }
  const output = []; let opening = -1, previous = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'boldMarker') continue;
    if (opening < 0) { opening = i; continue; }
    const content = tokens.slice(opening + 1, i), value = content.map(plainText).join('');
    // Keep incomplete streaming output and ambiguous math/globs literal.
    if (!/[\p{L}\p{N}]/u.test(value) || /[\r\n]/.test(value) || content.some(node => ['break', 'html'].includes(node.type)) || value.trim().length < 2) {
      opening = i; continue;
    }
    output.push(...tokens.slice(previous, opening));
    const inner = content;
    let leading = '', trailing = '';
    if (inner[0]?.type === 'text') {
      leading = inner[0].value.match(/^\s*/)[0]; inner[0] = text(inner[0].value.slice(leading.length));
    }
    if (inner.at(-1)?.type === 'text') {
      trailing = inner.at(-1).value.match(/\s*$/)[0]; inner[inner.length - 1] = text(inner.at(-1).value.slice(0, inner.at(-1).value.length - trailing.length));
    }
    if (leading) output.push(text(leading));
    output.push({ type: 'strong', children: inner.filter(node => node.type !== 'text' || node.value) });
    if (trailing) output.push(text(trailing));
    previous = i + 1; opening = -1;
  }
  return [...output, ...tokens.slice(previous)].map(node => node.type === 'boldMarker' ? text('**') : node);
}

// Only attribute-free <br> is interpreted as HTML. Everything else remains text.
export function remarkReplyFormat() {
  return (tree, file) => {
    const source = String(file.value ?? '');
    function visit(node) {
      if (!node.children) return;
      node.children = node.children.map(child => {
        if (child.type !== 'html' || !/^<br\s*\/?>$/i.test(child.value.trim())) return child;
        const lineBreak = { type: 'break' };
        return inlineParents.has(node.type) ? lineBreak : { type: 'paragraph', children: [lineBreak] };
      });
      node.children.forEach(visit);
      if (inlineParents.has(node.type)) node.children = repairStrong(node.children, source);
    }
    visit(tree);
  };
}
