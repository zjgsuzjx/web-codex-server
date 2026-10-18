import { useEffect, useRef } from 'react';

export default function useLongPress(onOpen, { allowInputs = false } = {}) {
  const callback = useRef(onOpen), gesture = useRef(null), timer = useRef(), suppressUntil = useRef(0);
  callback.current = onOpen;
  const cancel = () => { clearTimeout(timer.current); gesture.current = null; };
  useEffect(() => cancel, []);
  return {
    onPointerDownCapture(event) {
      cancel(); suppressUntil.current = 0;
      if (!['touch', 'pen'].includes(event.pointerType) || !event.isPrimary || event.target.closest(allowInputs ? 'summary,[data-no-long-press]' : 'input,summary,[data-no-long-press]')) return;
      gesture.current = { x: event.clientX, y: event.clientY, target: event.target };
      timer.current = setTimeout(() => {
        const point = gesture.current;
        if (!point?.target.isConnected) return;
        suppressUntil.current = performance.now() + 800;
        callback.current(point);
      }, 500);
    },
    onPointerMoveCapture(event) {
      const point = gesture.current;
      if (point && Math.hypot(event.clientX - point.x, event.clientY - point.y) > 8) cancel();
    },
    onPointerUpCapture: cancel,
    onPointerCancelCapture: cancel,
    onClickCapture(event) {
      if (performance.now() < suppressUntil.current) { event.preventDefault(); event.stopPropagation(); suppressUntil.current = 0; }
    },
  };
}
