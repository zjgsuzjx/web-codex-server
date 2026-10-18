export const isDirtyTab = file => file.kind !== 'image' && file.content !== file.original;

export function tabClosePaths(tabs, path, mode) {
  const index = tabs.findIndex(file => file.path === path);
  if (['single', 'others', 'right'].includes(mode) && index < 0) return [];
  return tabs.filter((file, position) => mode === 'all' || mode === 'single' && file.path === path || mode === 'others' && file.path !== path || mode === 'right' && position > index || mode === 'saved' && !isDirtyTab(file)).map(file => file.path);
}

export function closeTabState(tabs, selectedFile, paths) {
  const removed = new Set(paths), remaining = tabs.filter(file => !removed.has(file.path));
  if (!removed.has(selectedFile)) return { tabs: remaining, selectedFile };
  const index = tabs.findIndex(file => file.path === selectedFile);
  const neighbor = [...tabs.slice(index + 1), ...tabs.slice(0, index).reverse()].find(file => !removed.has(file.path));
  return { tabs: remaining, selectedFile: neighbor?.path || null };
}

export function hasUnapprovedTabChanges(tabs, paths, approved) {
  const targets = new Set(paths);
  return tabs.some(file => targets.has(file.path) && isDirtyTab(file) && (!approved.has(file.path) || approved.get(file.path) !== file.content));
}
