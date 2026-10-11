import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function Tooltip({ children, title, description, disabled = false }) {
  const id = useId(), trigger = useRef(), bubble = useRef(), timer = useRef();
  const [open, setOpen] = useState(false), [position, setPosition] = useState(null);
  const close = () => { clearTimeout(timer.current); setOpen(false); setPosition(null); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current.getBoundingClientRect(), rect = bubble.current.getBoundingClientRect();
    const above = anchor.top - rect.height - 10;
    setPosition({ left: Math.max(12, Math.min(anchor.left + anchor.width / 2 - rect.width / 2, window.innerWidth - rect.width - 12)), top: Math.max(12, Math.min(above >= 12 ? above : anchor.bottom + 10, window.innerHeight - rect.height - 12)) });
    const escape = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', close); document.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true); };
  }, [open, title, description]);
  return <span className="tooltip-trigger" ref={trigger} tabIndex={disabled ? 0 : undefined} role={disabled ? 'group' : undefined} aria-label={disabled ? title : undefined} aria-describedby={disabled && open ? id : undefined}
    onPointerEnter={e => { if (e.pointerType === 'touch') return; clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 300); }}
    onPointerLeave={close} onFocus={() => { clearTimeout(timer.current); setOpen(true); }} onBlur={close} onPointerDown={close}>
    {cloneElement(children, { 'aria-describedby': open ? id : undefined })}
    {open && createPortal(<div className="tooltip-bubble" role="tooltip" id={id} ref={bubble} style={{ ...position, visibility: position ? 'visible' : 'hidden' }}><strong>{title}</strong>{description && <span>{description}</span>}</div>, document.body)}
  </span>;
}
