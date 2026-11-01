import { X } from 'lucide-react';
import type * as React from 'react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProtocolCallback } from '../../../shared/contracts/protocol.ts';
import type { FocusableElement } from '../../types/dom.ts';
export interface ModalProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  onClose: ProtocolCallback;
  onRequestClose?: ProtocolCallback;
  wide?: boolean;
  dismissible?: boolean;
  className?: string;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  role?: React.AriaRole;
  exiting?: boolean;
  initialFocus?: React.RefObject<HTMLElement | null | undefined>;
  selectInitialFocus?: boolean;
  returnFocus?: Element | null;
}

const layers: HTMLDivElement[] = [],
  originalInert = new Map();
export const DIALOG_CLOSE_MS = 180;
function syncLayers() {
  const top = layers.at(-1);
  for (const element of Array.from(document.body.children) as HTMLElement[]) {
    if (!originalInert.has(element)) originalInert.set(element, element.inert);
    element.inert = element !== top;
  }
  if (!top) {
    for (const [element, inert] of originalInert) element.inert = inert;
    originalInert.clear();
  }
}

export default function Modal({
  title,
  subtitle,
  children,
  onClose,
  onRequestClose,
  wide = false,
  dismissible = true,
  className = '',
  icon: Icon,
  role = 'dialog',
  exiting = false,
  initialFocus,
  selectInitialFocus = false,
  returnFocus,
}: ModalProps) {
  const ref = useRef<HTMLElement>(undefined!),
    backdrop = useRef<HTMLDivElement>(undefined!),
    closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined!),
    closeCallback = useRef(onClose),
    requestCloseCallback = useRef(onRequestClose),
    closingRef = useRef(false),
    dismissibleRef = useRef(dismissible),
    uid = useId();
  const [closing, setClosing] = useState(false);
  closeCallback.current = onClose;
  requestCloseCallback.current = onRequestClose;
  dismissibleRef.current = dismissible;
  const previousFocus = useRef(returnFocus || document.activeElement);
  const closeVisible = useRef(dismissible);
  closeVisible.current ||= dismissible;
  function close() {
    if (!dismissibleRef.current || closingRef.current) return;
    closingRef.current = true;
    requestCloseCallback.current?.();
    setClosing(true);
    closeTimer.current = setTimeout(
      () => closeCallback.current(),
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : DIALOG_CLOSE_MS,
    );
  }
  useLayoutEffect(() => {
    const previous = previousFocus.current,
      menuTrigger = previous?.closest('.row-menu')?.querySelector<FocusableElement>('summary');
    const layer = backdrop.current;
    layers.push(layer);
    syncLayers();
    const focused =
      initialFocus?.current ||
      (ref.current.contains(document.activeElement) ? document.activeElement : ref.current);
    (focused as HTMLElement).focus({ preventScroll: true });
    if (selectInitialFocus) (focused as HTMLInputElement).select?.();
    const keydown = (e: KeyboardEvent) => {
      if (layers.at(-1) !== layer) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
      if (e.key === 'Tab') {
        const elements = [
          ...ref.current.querySelectorAll<FocusableElement>(
            'button,input,textarea,select,a[href],summary,[tabindex]',
          ),
        ].filter(
          (x) =>
            !x.disabled && x.tabIndex >= 0 && !x.closest('[inert]') && x.getClientRects().length,
        );
        if (!elements.length) {
          e.preventDefault();
          ref.current.focus();
        } else if (
          e.shiftKey &&
          (document.activeElement === elements[0] || document.activeElement === ref.current)
        ) {
          e.preventDefault();
          elements.at(-1)!.focus();
        } else if (!e.shiftKey && document.activeElement === elements.at(-1)) {
          e.preventDefault();
          elements[0].focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      clearTimeout(closeTimer.current);
      document.removeEventListener('keydown', keydown);
      layers.splice(layers.indexOf(layer), 1);
      syncLayers();
      const parentLayer = layers.at(-1);
      // Restore after the portal has left the DOM; a newly opened dialog owns focus.
      queueMicrotask(() => {
        if (layers.at(-1) !== parentLayer) return;
        const visible = (element: Element | null | undefined) =>
          element &&
          element !== document.body &&
          element !== document.documentElement &&
          element.isConnected &&
          !element.closest('[inert]') &&
          element.getClientRects().length;
        const target = [
          menuTrigger,
          previous,
          parentLayer?.querySelector<FocusableElement>('.modal'),
          ...document.querySelectorAll<FocusableElement>('[aria-label="设置"]'),
        ].find(visible);
        (target as HTMLElement | undefined)?.focus({ preventScroll: true });
      });
    };
  }, []);
  return createPortal(
    <div
      ref={backdrop}
      className={`modal-backdrop ${closing || exiting ? 'is-closing' : ''}`}
      style={{ '--dialog-duration': `${DIALOG_CLOSE_MS}ms` }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className={`modal ${wide ? 'wide' : ''} ${className}`}
        role={role}
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        aria-describedby={subtitle ? `${uid}-subtitle` : undefined}
        inert={closing || exiting}
        tabIndex={-1}
        ref={ref}
      >
        <header>
          <div className="modal-heading">
            {Icon && (
              <span className="modal-heading-icon">
                <Icon size={21} />
              </span>
            )}
            <div>
              <h2 id={`${uid}-title`}>{title}</h2>
              {subtitle && <p id={`${uid}-subtitle`}>{subtitle}</p>}
            </div>
          </div>
          {closeVisible.current && (
            <button
              type="button"
              className="icon-button"
              aria-label="关闭"
              disabled={!dismissible || closing || exiting}
              onClick={close}
            >
              <X size={19} />
            </button>
          )}
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
