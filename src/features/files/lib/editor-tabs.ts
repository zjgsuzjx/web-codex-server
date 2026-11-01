import type { EditorTab } from '../../../../shared/contracts/domain.ts';
export const isDirtyTab = (file: EditorTab) =>
  file.kind !== 'image' && file.content !== file.original;

/** Preserve identity when a controlled editor repeats its current model value. */
export function updateTabContent(
  tabs: EditorTab[],
  selectedFile: string | null | undefined,
  content: string | undefined,
) {
  const value = content || '';
  const selected = tabs.find((tab) => tab.path === selectedFile);
  if (!selected || selected.content === value) return tabs;
  return tabs.map((tab) => (tab.path === selectedFile ? { ...tab, content: value } : tab));
}

export function tabClosePaths(
  tabs: EditorTab[],
  path: string,
  mode: import('../../../../shared/contracts/domain.ts').TabCloseMode,
) {
  const index = tabs.findIndex((file) => file.path === path);
  if (['single', 'others', 'right'].includes(mode) && index < 0) return [];
  return tabs
    .filter(
      (file, position) =>
        mode === 'all' ||
        (mode === 'single' && file.path === path) ||
        (mode === 'others' && file.path !== path) ||
        (mode === 'right' && position > index) ||
        (mode === 'saved' && !isDirtyTab(file)),
    )
    .map((file) => file.path);
}

export function closeTabState(tabs: EditorTab[], selectedFile: string | null, paths: string[]) {
  const removed = new Set(paths),
    remaining = tabs.filter((file) => !removed.has(file.path));
  if (!removed.has(selectedFile!)) return { tabs: remaining, selectedFile };
  const index = tabs.findIndex((file) => file.path === selectedFile);
  const neighbor = [...tabs.slice(index + 1), ...tabs.slice(0, index).reverse()].find(
    (file) => !removed.has(file.path),
  );
  return { tabs: remaining, selectedFile: neighbor?.path || null };
}

export function hasUnapprovedTabChanges(
  tabs: EditorTab[],
  paths: string[],
  approved: Map<string, string | undefined>,
) {
  const targets = new Set(paths);
  return tabs.some(
    (file) =>
      targets.has(file.path) &&
      isDirtyTab(file) &&
      (!approved.has(file.path) || approved.get(file.path) !== file.content),
  );
}
