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
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#17191b"/><path d="M16 5l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#c5dfcc"/><circle cx="24" cy="8" r="8" fill="#e5484d"/><text x="24" y="11" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="700" fill="white">${badge}</text></svg>`;
      icon.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(svg)}`);
    },
    dispose() {
      doc.removeEventListener('visibilitychange', acknowledge); doc.defaultView.removeEventListener('focus', acknowledge);
      restore(); if (!existingIcon) icon.remove();
    }
  };
}
