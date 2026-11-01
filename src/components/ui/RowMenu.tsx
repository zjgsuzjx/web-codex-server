import { MoreHorizontal } from 'lucide-react';
import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { FocusableElement } from '../../types/dom.ts';
export interface RowMenuProps {
  label: string;
  size?: number;
  children?: React.ReactNode;
}

// One listener per workspace also covers an outside click immediately after opening.
export function useRowMenuDismissal() {
  useEffect(() => {
    const menus = () => [...document.querySelectorAll<FocusableElement>('.row-menu[open]')];
    const closeOutside = (event: Event) => {
      for (const menu of menus()) if (!menu.contains(event.target as Node)) menu.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const open = menus();
      if (!open.length) return;
      event.preventDefault();
      event.stopPropagation();
      for (const menu of open) menu.open = false;
      open.at(-1)!.querySelector<FocusableElement>('summary')!.focus();
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

export default function RowMenu({ label, size = 16, children }: RowMenuProps) {
  const root = useRef<HTMLDetailsElement>(undefined!);
  const [open, setOpen] = useState(false);
  return (
    <details
      className="row-menu"
      ref={root}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-label={label} aria-expanded={open}>
        <MoreHorizontal size={size} />
      </summary>
      <div
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button,a')) root.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
