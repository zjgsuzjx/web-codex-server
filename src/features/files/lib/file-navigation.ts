import type { FileEntry } from '../../../../shared/contracts/domain.ts';
import type { AppError } from '../../../../shared/contracts/errors.ts';
import type { ProtocolRecord } from '../../../../shared/contracts/protocol.ts';
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const fileSortOptions = [
  { value: 'name-asc', label: '文件名 · A → Z' },
  { value: 'name-desc', label: '文件名 · Z → A' },
  { value: 'modified-asc', label: '修改时间 · 旧 → 新' },
  { value: 'modified-desc', label: '修改时间 · 新 → 旧' },
  { value: 'created-asc', label: '创建时间 · 旧 → 新' },
  { value: 'created-desc', label: '创建时间 · 新 → 旧' },
];

export function compareFileEntries(order = 'name-asc') {
  const valid = fileSortOptions.some((option) => option.value === order) ? order : 'name-asc';
  const [field, direction] = valid.split('-'),
    sign = direction === 'desc' ? -1 : 1;
  return (a: FileEntry, b: FileEntry) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    const byName = names.compare(a.name, b.name) || a.path.localeCompare(b.path);
    if (field === 'name') return sign * byName;
    const known = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0;
    if (known(a[field as 'modified' | 'created']) !== known(b[field as 'modified' | 'created']))
      return known(a[field as 'modified' | 'created']) ? -1 : 1;
    return (
      (known(a[field as 'modified' | 'created'])
        ? sign * (a[field as 'modified' | 'created']! - b[field as 'modified' | 'created']!)
        : 0) || byName
    );
  };
}

function matchScore(value: string, query: string) {
  if (value === query) return 0;
  if (value.startsWith(query)) return 1;
  const index = value.indexOf(query);
  if (index >= 0) return 2 + index / Math.max(1, value.length);
  let position = -1,
    gaps = 0;
  for (const char of query) {
    const next = value.indexOf(char, position + 1);
    if (next < 0) return Infinity;
    gaps += next - position - 1;
    position = next;
  }
  return 4 + gaps / Math.max(1, value.length);
}

function searchableEntry(entry: FileEntry) {
  const folders = entry.path.split('/');
  if (entry.type !== 'directory') folders.pop();
  return folders.every((folder) => !folder.startsWith('.'));
}

export function findFiles(entries: FileEntry[], query: string, limit = 80) {
  const tokens = query
    .trim()
    .toLocaleLowerCase()
    .replaceAll('\\', '/')
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return { entries: [], total: 0 };
  const matches = [];
  for (const entry of entries) {
    if (entry.type !== 'file' || !searchableEntry(entry)) continue;
    const name = entry.name.toLocaleLowerCase(),
      path = entry.path.toLocaleLowerCase();
    const score = tokens.reduce(
      (sum, token) => sum + Math.min(matchScore(name, token), 8 + matchScore(path, token)),
      0,
    );
    if (Number.isFinite(score)) matches.push({ entry, score });
  }
  matches.sort(
    (a, b) =>
      a.score - b.score ||
      names.compare(a.entry.name, b.entry.name) ||
      a.entry.path.localeCompare(b.entry.path),
  );
  return { entries: matches.slice(0, limit).map((match) => match.entry), total: matches.length };
}

// The ordinary tree leaves dependency/cache folders lazy. Index them once per
// active search, progressively. Dot-prefixed folders are never indexed.
export async function indexLazyFiles(
  entries: FileEntry[],
  loadDirectory: (path: string, signal?: AbortSignal) => Promise<FileEntry[]>,
  { signal, onBatch }: { signal?: AbortSignal; onBatch?: (rows: FileEntry[]) => void } = {},
) {
  const queue = entries
    .filter((entry) => entry.type === 'directory' && entry.lazy && searchableEntry(entry))
    .map((entry) => entry.path);
  const visited = new Set(),
    failures = [];
  for (let i = 0; i < queue.length && !signal?.aborted; i++) {
    const path = queue[i];
    if (visited.has(path)) continue;
    visited.add(path);
    try {
      const rows = (await loadDirectory(path, signal)).filter(searchableEntry);
      if (signal?.aborted) break;
      onBatch?.(rows);
      for (const row of rows) if (row.type === 'directory' && row.lazy) queue.push(row.path);
    } catch (caughtError) {
      const error = caughtError as AppError;
      if (signal?.aborted) break;
      failures.push({ path, error });
    }
  }
  return failures;
}
