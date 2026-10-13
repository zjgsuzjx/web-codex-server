import { useLayoutEffect, useRef, useState } from 'react';
import { ImageOff, RefreshCw } from 'lucide-react';

export function ImageSkeleton() {
  return <span className="image-skeleton skeleton" role="status"><span>正在加载图片…</span></span>;
}

export default function ChatImage(props) {
  return <ImageLoader key={props.src} {...props}/>;
}

function ImageLoader({ src, alt = '图片', onPreview, preview = false }) {
  const image = useRef();
  const [status, setStatus] = useState('loading'), [attempt, setAttempt] = useState(0);
  const retryUrl = attempt && !/^(?:data:|blob:)/.test(src) ? new URL(src, window.location.href) : null;
  if (retryUrl) retryUrl.searchParams.set('retry', attempt);
  const source = retryUrl ? retryUrl.href : src;
  useLayoutEffect(() => {
    if (image.current?.complete && image.current.naturalWidth > 0) setStatus('loaded');
  }, [source, attempt]);
  const frame = <span className={`chat-image-frame ${status}`} aria-busy={status === 'loading'}>
    {status !== 'failed' && <img key={attempt} ref={image} src={source} alt={alt} loading={preview ? 'eager' : 'lazy'} decoding="async" onLoad={() => setStatus('loaded')} onError={() => setStatus('failed')}/>}
    {status === 'loading' && <ImageSkeleton/>}
  </span>;
  return <span className={`chat-image ${preview ? 'chat-image-preview' : ''}`}>
    {onPreview && status !== 'failed' ? <button type="button" className="chat-image-open" aria-label={`预览 ${alt}`} onClick={() => onPreview({ id: src, name: alt, kind: 'image', url: src, media: true })}>{frame}</button> : frame}
    {status === 'failed' && <span className="image-load-error" role="status"><ImageOff size={20}/><span>图片加载失败</span><button type="button" onClick={() => { setStatus('loading'); setAttempt(value => value + 1); }}><RefreshCw size={13}/>重试加载</button></span>}
  </span>;
}
