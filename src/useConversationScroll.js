import { useLayoutEffect, useRef } from 'react';

export default function useConversationScroll(scrollRef, contentRef, autoScroll, dependencies) {
  const anchor = useRef(null), position = useRef(null), observed = useRef(null), restoreRef = useRef();
  function remember() {
    const scroller = scrollRef.current;
    if (!scroller) return;
    position.current = { top: scroller.scrollTop, height: scroller.scrollHeight };
    const top = scroller.getBoundingClientRect().top;
    const node = [...scroller.querySelectorAll('[data-turn-id]')].find(node => node.getBoundingClientRect().bottom > top);
    anchor.current = node ? { node, offset: node.getBoundingClientRect().top - top } : null;
  }
  function restore() {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const previous = position.current;
    // Native scrolling can precede React's scroll handler. Do not undo it when
    // a background page or a resize is committed in the same animation frame.
    const moved = previous && Math.abs(scroller.scrollTop - previous.top) > Math.max(1, previous.height - scroller.scrollHeight);
    if (moved) {
      autoScroll.current = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 100;
      remember();
    }
    if (autoScroll.current) scroller.scrollTop = scroller.scrollHeight;
    else if (anchor.current?.node.isConnected && scroller.contains(anchor.current.node)) {
      scroller.scrollTop += anchor.current.node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.current.offset;
    }
    remember();
  }
  restoreRef.current = restore;
  useLayoutEffect(restore, dependencies);
  useLayoutEffect(() => {
    const content = contentRef.current, scroller = scrollRef.current;
    if (observed.current?.content === content && observed.current?.scroller === scroller) return;
    observed.current?.observer.disconnect(); observed.current = null;
    if (!content || !scroller) return;
    const observer = new ResizeObserver(() => restoreRef.current());
    observer.observe(content); observer.observe(scroller);
    observed.current = { content, scroller, observer };
  });
  useLayoutEffect(() => () => observed.current?.observer.disconnect(), []);
  return remember;
}
