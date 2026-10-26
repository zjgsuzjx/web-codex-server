import { memo, useEffect, useRef, useState } from 'react';
import { Check, Code2, Copy } from 'lucide-react';
import { codeLanguage, MAX_HIGHLIGHT_LENGTH } from './code-language.js';

let highlighter;
const loadHighlighter = () => highlighter ||= import('./code-highlight.js').catch(error => { highlighter = null; throw error; });

// Lowlight emits only text and spans. Render text through React's escaping, never HTML.
function tokens(nodes) {
  return nodes.map((node, index) => node.type === 'text' ? node.value :
    <span key={index} className={(node.properties?.className || []).join(' ')}>{tokens(node.children || [])}</span>);
}

export default memo(function CodeBlock({ code, fence = '', notify }) {
  const [highlight, setHighlight] = useState(null), [copiedSource, setCopiedSource] = useState(null);
  const copyTimer = useRef();
  const declared = codeLanguage(fence);
  useEffect(() => {
    if (!code.trim() || code.length > MAX_HIGHLIGHT_LENGTH || declared.id === 'plaintext' || (fence && !declared.grammar)) return;
    let active = true;
    // Coalesce streamed updates; keep the newest source visible while tokens are prepared.
    const timer = setTimeout(() => {
      loadHighlighter().then(module => {
        if (active) setHighlight({ code, fence, ...module.highlightCode(code, fence) });
      }).catch(() => {});
    }, 80);
    return () => { active = false; clearTimeout(timer); };
  }, [code, fence, declared.id, declared.grammar]);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const current = highlight?.code === code && highlight?.fence === fence ? highlight : null;
  const language = current?.language || declared, copied = copiedSource === code;
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedSource(code); clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedSource(null), 1800);
    } catch {
      clearTimeout(copyTimer.current); setCopiedSource(null);
      notify?.('复制失败，请选择代码后复制', true);
    }
  }
  return <div className="code-block" data-language={language.id || undefined}>
    <div className="code-block-header"><span className="code-block-language"><Code2 size={14} aria-hidden="true"/><span>{language.label}</span>{current?.detected && <small>自动识别</small>}</span>
      <button type="button" className={copied ? 'is-copied' : undefined} aria-label={`复制 ${language.label} 代码`} onClick={copy}>{copied ? <Check size={13} aria-hidden="true"/> : <Copy size={13} aria-hidden="true"/>}<span aria-live="polite">{copied ? '已复制' : '复制'}</span></button>
    </div>
    <pre tabIndex={0} aria-label={`${language.label} 代码，可横向滚动`}><code className={language.id ? `language-${language.id}` : undefined}>{current?.tree ? tokens(current.tree.children) : code}</code></pre>
  </div>;
});
