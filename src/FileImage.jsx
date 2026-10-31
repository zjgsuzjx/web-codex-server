import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Image, Minus, Plus, RotateCcw, LoaderCircle } from 'lucide-react';
import { formatBytes } from '../shared/usage';

export default function FileImage({ file, focusRequested = false, onFocused }) {
  const [status, setStatus] = useState('loading'), [dimensions, setDimensions] = useState(null), [zoom, setZoom] = useState(null), [retry, setRetry] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0, padding: 24 }), [dragging, setDragging] = useState(false);
  const canvas = useRef(), image = useRef(), stage = useRef(), gesture = useRef(), pendingAnchor = useRef(), wheelHandler = useRef();
  const fit = dimensions && viewport.width && viewport.height ? Math.max(.001, Math.min(1, (viewport.width - 2 * viewport.padding) / dimensions.width, (viewport.height - 2 * viewport.padding) / dimensions.height)) : 1;
  const scale = zoom ?? fit, minimum = Math.min(.1, fit);
  const width = dimensions ? dimensions.width * scale : 0, height = dimensions ? dimensions.height * scale : 0;

  function changeZoom(value, clientX, clientY) {
    if (status !== 'ready') return;
    if (value == null) { pendingAnchor.current = null; setZoom(null); canvas.current.scrollTo(0, 0); return; }
    const next = Math.max(minimum, Math.min(4, value));
    if (next === zoom) { pendingAnchor.current = null; return; }
    const bounds = canvas.current.getBoundingClientRect(), rect = image.current.getBoundingClientRect();
    const x = clientX ?? bounds.left + bounds.width / 2, y = clientY ?? bounds.top + bounds.height / 2;
    pendingAnchor.current = { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height, left: x - bounds.left, top: y - bounds.top };
    setZoom(next);
  }
  wheelHandler.current = event => {
    if (!event.ctrlKey) return;
    // A non-passive native listener also suppresses the browser's page zoom.
    event.preventDefault();
    if (status !== 'ready' || !event.deltaY) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.current.clientHeight : 1);
    changeZoom(scale * Math.exp(Math.max(-.5, Math.min(.5, -delta * .002))), event.clientX, event.clientY);
  };
  useEffect(() => {
    const node = canvas.current;
    const resize = () => setViewport({ width: node.clientWidth, height: node.clientHeight, padding: parseFloat(getComputedStyle(stage.current).paddingLeft) || 0 });
    resize(); const observer = new ResizeObserver(resize); observer.observe(node);
    const wheel = event => wheelHandler.current(event);
    node.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); node.removeEventListener('wheel', wheel); };
  }, []);
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    if (!anchor || !image.current) return;
    pendingAnchor.current = null;
    const bounds = canvas.current.getBoundingClientRect(), rect = image.current.getBoundingClientRect();
    canvas.current.scrollLeft += rect.left + anchor.x * rect.width - bounds.left - anchor.left;
    canvas.current.scrollTop += rect.top + anchor.y * rect.height - bounds.top - anchor.top;
  }, [zoom, width, height]);
  useEffect(() => {
    if (!focusRequested || status !== 'ready') return;
    const frame = requestAnimationFrame(() => { canvas.current.focus({ preventScroll: true }); onFocused?.(); });
    return () => cancelAnimationFrame(frame);
  }, [focusRequested, status, onFocused]);
  function endDrag(event) {
    gesture.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div className="file-image-view">
    <div className="image-controls"><Image size={14}/><span>{dimensions ? `${dimensions.width} × ${dimensions.height}` : '图片预览'} · {formatBytes(file.size)}</span><button type="button" aria-label="缩小图片" title="缩小图片" disabled={status !== 'ready' || scale <= minimum} onClick={() => changeZoom(scale / 1.25)}><Minus size={14}/></button><button type="button" aria-label="适应窗口" onClick={() => changeZoom(null)} disabled={status !== 'ready'} title="适应窗口">{zoom == null ? '适应' : `${Math.round(zoom * 100)}%`}</button><button type="button" aria-label="放大图片" title="放大图片" disabled={status !== 'ready' || scale >= 4} onClick={() => changeZoom(scale * 1.25)}><Plus size={14}/></button><button type="button" aria-label="原始大小" title="原始大小" disabled={status !== 'ready'} onClick={() => changeZoom(1)}><RotateCcw size={13}/></button></div>
    <div ref={canvas} tabIndex={0} role="region" aria-label="图片预览" className={`file-image-canvas ${status === 'ready' ? 'is-ready' : ''} ${dragging ? 'is-dragging' : ''}`} onPointerDown={event => {
      if (event.button !== 0 || status !== 'ready') return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
      setDragging(true);
    }} onPointerMove={event => {
      const start = gesture.current;
      if (!start) return;
      if (!(event.buttons & 1)) { endDrag(event); return; }
      event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
      event.currentTarget.scrollTop = start.top + start.y - event.clientY;
    }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { gesture.current = null; setDragging(false); }}>
      <div ref={stage} className="file-image-stage" style={{ width: Math.max(viewport.width, width + 2 * viewport.padding), height: Math.max(viewport.height, height + 2 * viewport.padding) }}>
        {status === 'loading' && <div className="image-feedback" role="status"><LoaderCircle className="spin" size={22}/>正在加载图片…</div>}
        {status === 'error' ? <div className="image-feedback" role="alert"><Image size={30}/><p>图片无法显示，请重试或下载查看。</p><button type="button" className="secondary" onClick={() => { setStatus('loading'); setRetry(n => n + 1); }}>重新加载</button></div> : <img ref={image} alt={file.path} draggable={false} src={`${file.url}&v=${file.modified}&retry=${retry}`} style={{ width, height, visibility: status === 'loading' ? 'hidden' : 'visible' }} onLoad={event => { setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setStatus('ready'); }} onError={() => setStatus('error')}/>}
      </div>
    </div>
    <div className="editor-status image-status"><span>{file.mime}</span><span title="Ctrl + 鼠标滚轮缩放，按住鼠标左键拖动查看">Ctrl + 滚轮缩放 · 左键拖动</span></div>
  </div>;
}
