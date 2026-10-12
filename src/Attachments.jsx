import { useEffect, useState } from 'react';
import { File, Image, X, Download, LoaderCircle } from 'lucide-react';

const isImage = item => /^image\/(png|jpeg|gif|webp)$/.test(item.mime || item.file?.type || '');
export function AttachmentList({ items, onPreview, onRemove, disabled }) {
  if (!items?.length) return null;
  return <div className="attachment-list" aria-label="对话附件">{items.map(item => <div className="attachment-chip" key={item.id}>
    <button type="button" className="attachment-open" onClick={() => onPreview(item)} title={`预览 ${item.name}`}>
      {isImage(item) ? <Image size={17}/> : <File size={17}/>}<span>{item.name}<small>{Math.ceil((item.size || 0) / 1024)} KB</small></span>
    </button>{onRemove && <button type="button" className="icon-button" aria-label={`删除附件 ${item.name}`} disabled={disabled} onClick={() => onRemove(item)}><X size={13}/></button>}
  </div>)}</div>;
}
export function AttachmentPreview({ item, api, Dialog, onClose }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false, url;
    (async () => {
      if (item.file) {
        url = URL.createObjectURL(item.file);
        let preview = { url, kind: 'download' };
        if (isImage(item)) preview.kind = 'image';
        else if (item.file.size <= 2 * 1024 * 1024) {
          const buffer = await item.file.arrayBuffer();
          try { const bytes = new Uint8Array(buffer); if (bytes.includes(0)) throw new Error(); preview = {...preview,kind:'text',text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)}; } catch {}
        }
        if (!cancelled) setData(preview);
      } else if (item.generated && item.kind === 'image' && item.url) {
        if (!cancelled) setData(item);
      } else {
        const preview = await api(`/attachments/${item.id}/preview`); if (!cancelled) setData(preview);
      }
    })().catch(e=>{if(!cancelled)setError(e.message);});
    return () => {cancelled=true;if(url)URL.revokeObjectURL(url);};
  }, [item.id]);
  return <Dialog title={item.name} subtitle={item.generated ? 'Codex 生成的图片' : '当前对话的附件'} wide onClose={onClose}><div className="attachment-preview">
    {error ? <p role="alert">{error}</p> : !data ? <LoaderCircle className="spin" size={20}/> : data.kind === 'image' ? <img src={data.url} alt={item.name}/> : data.kind === 'text' ? <pre>{data.text}</pre> : <p>此附件无法直接预览，可以下载查看。</p>}
    {data && <a className="secondary" href={item.file ? data.url : `${data.url}${data.url.includes('?')?'&':'?'}download=1`} download={item.generated ? undefined : item.name}><Download size={14}/>{item.generated ? '下载图片' : '下载附件'}</a>}
  </div></Dialog>;
}
