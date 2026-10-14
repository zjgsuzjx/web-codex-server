import { getDomain } from 'tldts';

// Markdown otherwise interprets bare "file.js:12" as a URL scheme.
export function isFileLineLink(href) {
  return Boolean(fileLinkInfo(href)?.line);
}

// Explicit download labels and sandbox artifacts bypass the code viewer.
export function downloadLinkInfo(href, label, threadId) {
  if (!threadId || typeof href !== 'string') return null;
  const sandbox = href.startsWith('sandbox:');
  const file = fileLinkInfo(sandbox ? href.slice(8) : href);
  if (!file || !sandbox && !/(?:下载|download\b|save\s+(?:file|as)\b)/i.test(label || '')) return null;
  return { ...file, url: `/api/threads/${encodeURIComponent(threadId)}/download?path=${encodeURIComponent(file.path)}` };
}

export function fileLinkInfo(href) {
  if (typeof href !== 'string' || !href || /^(?:\/\/|#|\/api(?:\/|$))/i.test(href)) return null;
  const [encodedPath, fragment = ''] = href.split('#');
  let path;
  try { path = decodeURIComponent(encodedPath); } catch { return null; }
  if (/[\x00-\x1f\x7f?]/.test(path)) return null;
  const suffix = path.match(/:(\d+)(?::(\d+))?$/);
  if (suffix) {
    if (!/\.[a-z\d]+$/i.test(path.slice(0, suffix.index))) return null;
    path = path.slice(0, suffix.index);
  }
  // A colon must be a line suffix, never an encoded URL scheme.
  if (!path || path.includes(':') || /^(?:\/\/|\/api(?:\/|$))/.test(path)) return null;
  const anchor = fragment.match(/^L(\d+)(?:-L?\d+)?$/i);
  const line = Number(suffix?.[1] || anchor?.[1]) || null;
  return { path, line, column: Number(suffix?.[2]) || null };
}

// Keep trailing punctuation outside the pill, but on the same line as its file.
export function rehypeFileReferences() {
  return tree => {
    function visit(node) {
      if (!node.children) return;
      node.children.forEach(visit);
      const children = [];
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i], next = node.children[i + 1];
        const punctuation = next?.type === 'text' && next.value.match(/^[。，、；：！？,.!?;:）)\]】》」』]+/)?.[0];
        if (child.tagName === 'a' && fileLinkInfo(child.properties?.href) && punctuation && !child.children?.some(part => part.tagName === 'img')) {
          children.push({ type: 'element', tagName: 'span', properties: { className: ['file-reference'] }, children: [child,
            { type: 'element', tagName: 'span', properties: { className: ['file-reference-punctuation'] }, children: [{ type: 'text', value: punctuation }] }
          ] });
          const rest = next.value.slice(punctuation.length);
          if (rest) children.push({ ...next, value: rest });
          i++;
        } else children.push(child);
      }
      node.children = children;
    }
    visit(tree);
  };
}

export function websiteInfo(href) {
  if (typeof href !== 'string' || !/^(?:https?:\/\/|\/\/)/i.test(href)) return null;
  try {
    const url = new URL(href, 'https://localhost');
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return { hostname: url.hostname, domain: getDomain(url.hostname, { allowPrivateDomains: true }) || url.hostname };
  } catch { return null; }
}
