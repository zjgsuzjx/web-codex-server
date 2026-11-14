import { useEffect, useState } from 'react';
import type { ChangeSummary } from '../../../../shared/contracts/protocol.ts';

export function ignoredChangePath(path: string, ignored: string[]) {
  return ignored.some((root) => path === root || path.startsWith(`${root}/`));
}
export function visibleChanges(summary: ChangeSummary | undefined, ignored: string[]) {
  if (!summary) return summary;
  const files = summary.files.filter((file) => !ignoredChangePath(file.path, ignored));
  return {
    ...summary,
    files,
    added: files.reduce((sum, file) => sum + (file.added || 0), 0),
    removed: files.reduce((sum, file) => sum + (file.removed || 0), 0),
    unknown: files.filter((file) => file.added == null).length,
  };
}
export function useChangeVisibility(projectId: string | undefined) {
  const key = `change-visibility:${projectId || ''}`;
  const read = () => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value)
        ? value.filter((path): path is string => typeof path === 'string' && !!path)
        : [];
    } catch {
      return [];
    }
  };
  const [state, setState] = useState<{ key: string; paths: string[] }>(() => ({
    key,
    paths: read(),
  }));
  useEffect(() => {
    const update = () => setState({ key, paths: read() });
    update();
    window.addEventListener('change-visibility', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('change-visibility', update);
      window.removeEventListener('storage', update);
    };
  }, [key]);
  const paths = state.key === key ? state.paths : read();
  function toggle(selected: string[], restore: boolean) {
    const current = read();
    const next = restore
      ? current.filter(
          (root) =>
            !selected.some(
              (path) => root === path || root.startsWith(`${path}/`) || path.startsWith(`${root}/`),
            ),
        )
      : [...new Set([...current, ...selected])];
    localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event('change-visibility'));
  }
  return { paths, toggle };
}
