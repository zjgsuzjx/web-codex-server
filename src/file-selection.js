export const parentPath = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

// Only visible rows participate in a range; collapsed or filtered files stay out.
export function selectPaths(visible, previous, target, { range = false, anchor, toggle = false, additive = false } = {}) {
  if (range && visible.includes(anchor) && visible.includes(target)) {
    const first = visible.indexOf(anchor), last = visible.indexOf(target);
    return new Set([...(additive ? previous : []), ...visible.slice(Math.min(first, last), Math.max(first, last) + 1)]);
  }
  if (toggle) { const next = new Set(previous); next.has(target) ? next.delete(target) : next.add(target); return next; }
  return new Set([target]);
}

export function contextPaths(selection, target) {
  if (!target) return [];
  return selection.has(target) ? [...selection] : [target];
}
