import { useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Download, Image, LoaderCircle, RefreshCw } from 'lucide-react';
import { contentImage, mediaUrl, toolContent } from '../shared/chat-content.js';

const nodeText = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(nodeText).join('') : nodeText(node?.props?.children || '');
export function Markdown({ text = '', threadId, onFile, notify }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(url, key) => key === 'src' ? mediaUrl(url, threadId) : defaultUrlTransform(url)} components={{
    a: ({ node, href, children, ...props }) => {
      const local = href && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\/api\/)/i.test(href);
      return <a {...props} href={href} target={local ? undefined : '_blank'} rel="noopener noreferrer" onClick={local && onFile ? event => { event.preventDefault(); onFile(href.replace(/(?::\d+)?(?:#L\d+)?$/, '')); } : undefined}>{children}</a>;
    },
    img: ({ node, src, alt }) => src ? <img className="markdown-image" src={src} alt={alt || '图片'} loading="lazy"/> : <span className="output-error">图片地址无法预览</span>,
    pre: ({ node, children, ...props }) => <div className="code-block"><div className="code-block-header"><span>代码</span><button type="button" onClick={() => navigator.clipboard.writeText(nodeText(children)).then(() => notify?.('已复制')).catch(() => notify?.('复制失败', true))}><Copy size={12}/>复制</button></div><pre {...props}>{children}</pre></div>
  }}>{text || ''}</ReactMarkdown>;
}

export function GeneratedImage({ item, onPreview }) {
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const source = item.imageUrl ? `${item.imageUrl}${attempt ? `?retry=${attempt}` : ''}` : '';
  const busy = ['inProgress', 'in_progress', 'generating', 'queued'].includes(item.status) && !source;
  const error = item.failure?.type === 'usageLimitExceeded' ? '生图额度已用完，请在额度重置后重试。' : item.status === 'failed' ? '图片生成失败。' : 'Codex 未返回可读取的图片结果。';
  return <article className="generated-image"><div className="generated-image-heading"><Image size={16}/><strong>生成的图片</strong>{busy && <LoaderCircle className="spin" size={15}/>}</div>
    {source ? <>{failed ? <div className="output-error" role="status">图片暂时无法读取。<button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}><RefreshCw size={13}/>重试加载</button></div> : <button type="button" className="generated-image-open" aria-label="预览生成的图片" onClick={() => onPreview({ id: item.id, name: '生成的图片', kind: 'image', url: source, generated: true })}><img src={source} alt="Codex 生成的图片" onError={() => setFailed(true)}/></button>}<a className="generated-image-download" href={`${item.imageUrl}?download=1`} download><Download size={14}/>下载图片</a></> : <p className={busy ? 'output-pending' : 'output-error'} role="status">{busy ? '正在生成图片…' : error}</p>}
    {item.revisedPrompt && <details className="image-prompt"><summary>图片描述</summary><p>{item.revisedPrompt}</p></details>}
  </article>;
}

export function ToolOutput({ item, threadId, onFile, notify }) {
  const content = toolContent(item);
  return <div className="tool-output">
    {content.map((block, index) => {
      const image = contentImage(block), text = block.text || (block.type === 'resource' && block.resource?.text);
      if (image) { const src = mediaUrl(image, threadId); return src ? <img key={index} className="markdown-image" src={src} alt="工具返回的图片" loading="lazy"/> : <p className="output-error" key={index}>工具图片地址无法预览</p>; }
      if (typeof text === 'string') return <div className="markdown" key={index}><Markdown text={text} threadId={threadId} onFile={onFile} notify={notify}/></div>;
      if (block.type === 'resource_link' && /^https?:\/\//.test(block.uri || '')) return <p key={index}><a href={block.uri} target="_blank" rel="noopener noreferrer">{block.title || block.name || block.uri}</a></p>;
      return <pre key={index}>{JSON.stringify(block, null, 2)}</pre>;
    })}
    {item.error && <pre className="output-error">{typeof item.error === 'string' ? item.error : item.error.message || JSON.stringify(item.error, null, 2)}</pre>}
    {item.result?.structuredContent != null && <pre>{JSON.stringify(item.result.structuredContent, null, 2)}</pre>}
    {!content.length && !item.error && item.result?.structuredContent == null && <pre>{JSON.stringify(item, null, 2)}</pre>}
  </div>;
}
