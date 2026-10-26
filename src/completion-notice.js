// The notice stays in the browser tab and needs no notification permission.
export function createCompletionNotice(doc) {
  const title = doc.title, existingIcon = doc.querySelector('link[rel="icon"]');
  const icon = existingIcon || doc.head.appendChild(doc.createElement('link'));
  const href = icon.getAttribute('href'); icon.setAttribute('rel', 'icon');
  const completed = new Set(), unseen = new Set();
  const background = () => doc.visibilityState === 'hidden' || !doc.hasFocus();
  const restore = () => { doc.title = title; if (href == null) icon.removeAttribute('href'); else icon.setAttribute('href', href); };
  const acknowledge = () => { if (!background()) { unseen.clear(); restore(); } };
  doc.addEventListener('visibilitychange', acknowledge);
  doc.defaultView.addEventListener('focus', acknowledge);
  return {
    complete({ threadId, turn } = {}) {
      if (!threadId || !turn?.id || turn.status !== 'completed') return;
      const key = `${threadId}:${turn.id}`;
      if (completed.has(key)) return;
      completed.add(key); if (completed.size > 200) completed.delete(completed.values().next().value);
      if (!background()) return;
      unseen.add(key);
      const count = unseen.size, badge = count > 9 ? '9+' : String(count);
      doc.title = `（${count}）工作已完成 · ${title}`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a9bff"/><stop offset="1" stop-color="#3563ee"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><path d="M12 2c.6 5.4 2.6 8.4 10 10-7.4 1.6-9.4 4.6-10 10-.6-5.4-2.6-8.4-10-10 7.4-1.6 9.4-4.6 10-10z" fill="#fff" transform="translate(32 27) scale(1.55) translate(-12 -12)"/><path d="M0 -5C2.6 -1.6 4 .6 4 2.4A4 4 0 0 1 -4 2.4C-4 .6 -2.6 -1.6 0 -5z" fill="#fff" fill-opacity=".92" transform="translate(32 52) scale(1.05)"/><circle cx="48" cy="16" r="16" fill="#e5484d"/><text x="48" y="22" text-anchor="middle" font-family="Segoe UI,system-ui,sans-serif" font-size="18" font-weight="700" fill="white">${badge}</text></svg>`;
      icon.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(svg)}`);
    },
    dispose() {
      doc.removeEventListener('visibilitychange', acknowledge); doc.defaultView.removeEventListener('focus', acknowledge);
      restore(); if (!existingIcon) icon.remove();
    }
  };
}
