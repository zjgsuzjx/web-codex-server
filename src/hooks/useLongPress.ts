import { useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
export interface LongPressPoint {
  x: number;
  y: number;
  target: HTMLElement;
}
export default function useLongPress(
  onOpen: (point: LongPressPoint) => void,
  { allowInputs = false } = {},
) {
  const callback = useRef(onOpen),
    gesture = useRef<LongPressPoint | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    suppressUntil = useRef(0);
  callback.current = onOpen;
  const cancel = () => {
    clearTimeout(timer.current);
    gesture.current = null;
  };
  useEffect(() => cancel, []);
  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      cancel();
      suppressUntil.current = 0;
      const target = event.target as HTMLElement;
      if (
        !['touch', 'pen'].includes(event.pointerType) ||
        !event.isPrimary ||
        target.closest(
          allowInputs ? 'summary,[data-no-long-press]' : 'input,summary,[data-no-long-press]',
        )
      )
        return;
      gesture.current = { x: event.clientX, y: event.clientY, target };
      timer.current = setTimeout(() => {
        const point = gesture.current;
        if (!point?.target.isConnected) return;
        suppressUntil.current = performance.now() + 800;
        callback.current(point);
      }, 500);
    },
    onPointerMoveCapture(event: PointerEvent<HTMLElement>) {
      const point = gesture.current;
      if (point && Math.hypot(event.clientX - point.x, event.clientY - point.y) > 8) cancel();
    },
    onPointerUpCapture: cancel,
    onPointerCancelCapture: cancel,
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (performance.now() < suppressUntil.current) {
        event.preventDefault();
        event.stopPropagation();
        suppressUntil.current = 0;
      }
    },
  };
}
