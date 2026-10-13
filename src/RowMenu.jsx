import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

// One listener per workspace also covers an outside click immediately after opening.
export function useRowMenuDismissal() {
  useEffect(() => {
    const menus = () => [...document.querySelectorAll('.row-menu[open]')];
    const closeOutside = event => { for (const menu of menus()) if (!menu.contains(event.target)) menu.open = false; };
    const escape = event => {
      if (event.key !== 'Escape') return;
      const open = menus(); if (!open.length) return;
      event.preventDefault(); event.stopPropagation();
      for (const menu of open) menu.open = false;
      open.at(-1).querySelector('summary').focus();
    };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', escape, true);
    };
  }, []);
}

export default function RowMenu({ label, size = 16, children }) {
  const root = useRef();
  const [open, setOpen] = useState(false);
  return <details className="row-menu" ref={root} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary aria-label={label} aria-expanded={open}><MoreHorizontal size={size}/></summary>
    <div onClick={event => { if (event.target.closest('button,a')) root.current.open = false; }}>{children}</div>
  </details>;
}
