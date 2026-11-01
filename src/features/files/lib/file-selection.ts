export const parentPath = (path: string) =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

// Only visible rows participate in a range; collapsed or filtered files stay out.
export function selectPaths(
  visible: string[],
  previous: Set<string>,
  target: string,
  {
    range = false,
    anchor,
    toggle = false,
    additive = false,
  }: { range?: boolean; anchor?: string | null; toggle?: boolean; additive?: boolean } = {},
) {
  if (range && visible.includes(anchor!) && visible.includes(target)) {
    const first = visible.indexOf(anchor!),
      last = visible.indexOf(target);
    return new Set([
      ...(additive ? previous : []),
      ...visible.slice(Math.min(first, last), Math.max(first, last) + 1),
    ]);
  }
  if (toggle) {
    const next = new Set(previous);
    next.has(target) ? next.delete(target) : next.add(target);
    return next;
  }
  return new Set([target]);
}

export function contextPaths(selection: Set<string>, target: string) {
  if (!target) return [];
  return selection.has(target) ? [...selection] : [target];
}
