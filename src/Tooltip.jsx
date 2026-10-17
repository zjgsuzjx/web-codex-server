import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

let activeTooltip = null;

export default function Tooltip({ children, title, description, content, disabled = false, variant = 'default' }) {
  const toolbar = variant === 'toolbar' || variant === 'connection';
  const compact = variant === 'toolbar' || (variant === 'default' && !description && !content);
  const id = useId(), trigger = useRef(), bubble = useRef(), timer = useRef(), dismissed = useRef(false);
  const [open, setOpen] = useState(false), [position, setPosition] = useState(null);
  const close = () => { clearTimeout(timer.current); setOpen(false); setPosition(null); if (activeTooltip?.id === id) activeTooltip = null; };
  const show = (delay = 0) => {
    clearTimeout(timer.current);
    if (activeTooltip?.id !== id) activeTooltip?.close();
    activeTooltip = { id, close };
    if (delay) timer.current = setTimeout(() => setOpen(true), delay);
    else setOpen(true);
  };
  const dismiss = () => { dismissed.current = true; close(); };
  useEffect(() => {
    const keyboard = e => { if (e.key === 'Tab') dismissed.current = false; };
    document.addEventListener('keydown', keyboard, true);
    return () => { clearTimeout(timer.current); if (activeTooltip?.id === id) activeTooltip = null; document.removeEventListener('keydown', keyboard, true); };
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current.getBoundingClientRect(), rect = bubble.current.getBoundingClientRect();
    const gap = toolbar ? 8 : 10;
    const above = anchor.top - rect.height - gap, below = anchor.bottom + gap;
    const top = toolbar ? (below + rect.height <= window.innerHeight - 12 ? below : above) : (above >= 12 ? above : below);
    setPosition({ left: Math.max(12, Math.min(anchor.left + anchor.width / 2 - rect.width / 2, window.innerWidth - rect.width - 12)), top: Math.max(12, Math.min(top, window.innerHeight - rect.height - 12)) });
    const escape = e => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } };
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', close); document.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true); };
  }, [open, title, description, content, variant]);
  return <span className="tooltip-trigger" ref={trigger} tabIndex={disabled ? 0 : undefined} role={disabled ? 'group' : undefined} aria-label={disabled ? title : undefined} aria-describedby={disabled && open ? id : undefined}
    onPointerEnter={e => { if (e.pointerType === 'touch') return; dismissed.current = false; show(300); }}
    onPointerLeave={close} onFocus={e => { if (!dismissed.current && e.target.matches(':focus-visible')) show(); }} onBlur={close} onPointerDownCapture={dismiss} onClickCapture={dismiss}>
    {cloneElement(children, { 'aria-describedby': open ? id : undefined })}
    {open && createPortal(<div className={`tooltip-bubble${compact ? ' compact-tooltip' : variant === 'connection' ? ' connection-tooltip' : ''}`} role="tooltip" id={id} ref={bubble} style={{ ...position, visibility: position ? 'visible' : 'hidden' }}>{content ?? <><strong>{title}</strong>{description && <span>{description}</span>}</>}</div>, document.body)}
  </span>;
}
