import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Download, FileText, Globe2, Image, LoaderCircle, ExternalLink } from 'lucide-react';
import { contentImage, mediaUrl, toolContent } from '../shared/chat-content.js';
import { remarkReplyFormat } from '../shared/markdown-format.js';
import ChatImage from './ChatImage';
import { downloadLinkInfo, fileLinkInfo, rehypeFileReferences, websiteInfo } from './link-info';

function WebsiteLink({ href, children, ...props }) {
  const website = websiteInfo(href);
  return website ? <a {...props} className="website-link" href={href} target="_blank" rel="noopener noreferrer" title={href}>
    <Globe2 size={13} aria-hidden="true"/><span className="website-link-label">{children}</span><span className="website-link-domain">{website.domain}</span><ExternalLink size={11} aria-hidden="true"/>
  </a> : <a {...props} href={href}>{children}</a>;
}

const nodeText = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(nodeText).join('') : nodeText(node?.props?.children || '');
export function Markdown({ text = '', threadId, onFile, notify, onPreview }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkReplyFormat]} rehypePlugins={[rehypeFileReferences]} urlTransform={(url, key) => key === 'src' ? mediaUrl(url, threadId) : fileLinkInfo(url) || downloadLinkInfo(url, '', threadId) ? url : defaultUrlTransform(url)} components={{
    a: ({ node, href, children, ...props }) => {
      const local = fileLinkInfo(href), image = node.children?.some(child => child.tagName === 'img');
      const label = image ? '打开图片链接' : children;
      const download = !image && downloadLinkInfo(href, nodeText(children), threadId);
      const link = !href ? <span>{label}</span> : download ? <a {...props} className="file-link" href={download.url} download title={`下载文件：${download.path}`}><Download size={13} aria-hidden="true"/><span className="file-link-label">{label}</span></a> : websiteInfo(href) ? <WebsiteLink href={href} {...props}>{label}</WebsiteLink> : local ?
        <a {...props} className="file-link" href={href} title={`打开文件：${local.path}${local.line ? ` · 第 ${local.line} 行` : ''}`} onClick={onFile ? event => { event.preventDefault(); onFile(local.path); } : undefined}>
          <FileText size={13} aria-hidden="true"/><span className="file-link-label">{label}</span>
        </a> : <a {...props} href={href} rel="noopener noreferrer">{label}</a>;
      return image ? <span className="markdown-image-link">{children}{link}</span> : link;
    },
    table: ({ node, children, ...props }) => <div className="markdown-table" role="region" aria-label="回复表格，可横向滚动" tabIndex={0}><table {...props}>{children}</table></div>,
    img: ({ node, src, alt }) => src ? <ChatImage src={src} alt={alt || '图片'} onPreview={onPreview}/> : <span className="output-error">图片地址无法预览</span>,
    pre: ({ node, children, ...props }) => <div className="code-block"><div className="code-block-header"><span>代码</span><button type="button" onClick={() => navigator.clipboard.writeText(nodeText(children)).then(() => notify?.('已复制')).catch(() => notify?.('复制失败', true))}><Copy size={12}/>复制</button></div><pre {...props}>{children}</pre></div>
  }}>{text || ''}</ReactMarkdown>;
}

export function GeneratedImage({ item, onPreview }) {
  const source = item.imageUrl || '';
  const busy = ['inProgress', 'in_progress', 'generating', 'queued'].includes(item.status) && !source;
  const error = item.failure?.type === 'usageLimitExceeded' ? '生图额度已用完，请在额度重置后重试。' : item.status === 'failed' ? '图片生成失败。' : 'Codex 未返回可读取的图片结果。';
  return <article className="generated-image"><div className="generated-image-heading"><Image size={16}/><strong>生成的图片</strong>{busy && <LoaderCircle className="spin" size={15}/>}</div>
    {source ? <><ChatImage src={source} alt="生成的图片" onPreview={image => onPreview({ ...image, id: item.id, generated: true })}/><a className="generated-image-download" href={`${item.imageUrl}?download=1`} download><Download size={14}/>下载图片</a></> : <p className={busy ? 'output-pending' : 'output-error'} role="status">{busy ? '正在生成图片…' : error}</p>}
    {item.revisedPrompt && <details className="image-prompt"><summary>图片描述</summary><p>{item.revisedPrompt}</p></details>}
  </article>;
}

export function ToolOutput({ item, threadId, onFile, notify, onPreview }) {
  const content = toolContent(item);
  return <div className="tool-output">
    {content.map((block, index) => {
      const image = contentImage(block), text = block.text || (block.type === 'resource' && block.resource?.text);
      if (image) { const src = mediaUrl(image, threadId); return src ? <ChatImage key={index} src={src} alt="工具返回的图片" onPreview={onPreview}/> : <p className="output-error" key={index}>工具图片地址无法预览</p>; }
      if (typeof text === 'string') return <div className="markdown" key={index}><Markdown text={text} threadId={threadId} onFile={onFile} notify={notify} onPreview={onPreview}/></div>;
      if (block.type === 'resource_link' && /^https?:\/\//.test(block.uri || '')) return <p key={index}><WebsiteLink href={block.uri}>{block.title || block.name || block.uri}</WebsiteLink></p>;
      return <pre key={index}>{JSON.stringify(block, null, 2)}</pre>;
    })}
    {item.error && <pre className="output-error">{typeof item.error === 'string' ? item.error : item.error.message || JSON.stringify(item.error, null, 2)}</pre>}
    {item.result?.structuredContent != null && <pre>{JSON.stringify(item.result.structuredContent, null, 2)}</pre>}
    {!content.length && !item.error && item.result?.structuredContent == null && <pre>{JSON.stringify(item, null, 2)}</pre>}
  </div>;
}
