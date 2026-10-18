import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function ContextMenu({ menu, items, onClose }) {
  const root = useRef(), close = useRef(onClose);
  const [position, setPosition] = useState(null);
  close.current = onClose;
  useLayoutEffect(() => {
    const node = root.current, rect = node.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(menu.x, innerWidth - rect.width - 8)), top: Math.max(8, Math.min(menu.y, innerHeight - rect.height - 8)) });
    const outside = event => { if (!node.contains(event.target) && !menu.trigger?.contains(event.target)) close.current(false); };
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(true); }
    };
    const dismiss = () => close.current(false);
    const scroll = event => { if (!node.contains(event.target)) dismiss(); };
    let focusFrame = 0;
    const release = () => {
      // Touch release may focus the original row through compatibility mouse events.
      focusFrame = requestAnimationFrame(() => {
        if (node.isConnected && !node.closest('[inert]') && !node.contains(document.activeElement)) node.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
      });
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('pointerup', release, { once: true, capture: true });
    document.addEventListener('keydown', escape, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('pointerup', release, true);
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [menu]);
  useLayoutEffect(() => {
    // A hidden element cannot receive focus; wait for the measured position to render.
    if (position) root.current.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [position]);
  function navigate(event) {
    const elements = [...root.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const index = elements.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? elements.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + elements.length) % elements.length;
      elements[next]?.focus();
    } else if (event.key === 'Tab') { event.preventDefault(); close.current(true); }
  }
  return createPortal(<div ref={root} role="menu" aria-label={menu.label || '操作菜单'} className="context-menu" style={{ ...position, visibility: position ? 'visible' : 'hidden' }} onKeyDown={navigate} onContextMenu={event => event.preventDefault()}>
    {menu.heading && <div className="context-menu-heading">{menu.heading}</div>}
    {items.map((item, index) => item.separator ? <hr role="separator" key={`separator-${index}`}/> : <button type="button" role="menuitem" key={item.label} disabled={item.disabled} className={item.danger ? 'danger-text' : ''} onClick={() => {
      // Dialogs must capture the persistent trigger, rather than a disappearing menu item.
      close.current(true);
      item.action();
    }}>{item.icon && <item.icon size={15} aria-hidden="true"/>}<span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</button>)}
  </div>, document.body);
}
