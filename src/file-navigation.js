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
  const valid = fileSortOptions.some(option => option.value === order) ? order : 'name-asc';
  const [field, direction] = valid.split('-'), sign = direction === 'desc' ? -1 : 1;
  return (a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    const byName = names.compare(a.name, b.name) || a.path.localeCompare(b.path);
    if (field === 'name') return sign * byName;
    const known = value => Number.isFinite(value) && value > 0;
    if (known(a[field]) !== known(b[field])) return known(a[field]) ? -1 : 1;
    return (known(a[field]) ? sign * (a[field] - b[field]) : 0) || byName;
  };
}

function matchScore(value, query) {
  if (value === query) return 0;
  if (value.startsWith(query)) return 1;
  const index = value.indexOf(query);
  if (index >= 0) return 2 + index / Math.max(1, value.length);
  let position = -1, gaps = 0;
  for (const char of query) {
    const next = value.indexOf(char, position + 1);
    if (next < 0) return Infinity;
    gaps += next - position - 1; position = next;
  }
  return 4 + gaps / Math.max(1, value.length);
}

export function findFiles(entries, query, limit = 80) {
  const tokens = query.trim().toLocaleLowerCase().replaceAll('\\', '/').split(/\s+/).filter(Boolean);
  const matches = [];
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    const name = entry.name.toLocaleLowerCase(), path = entry.path.toLocaleLowerCase();
    const score = tokens.reduce((sum, token) => sum + Math.min(matchScore(name, token), 8 + matchScore(path, token)), 0);
    if (Number.isFinite(score)) matches.push({ entry, score });
  }
  matches.sort((a, b) => a.score - b.score || names.compare(a.entry.name, b.entry.name) || a.entry.path.localeCompare(b.entry.path));
  return { entries: matches.slice(0, limit).map(match => match.entry), total: matches.length };
}

// The ordinary tree leaves dependency/cache folders lazy. Index them once per
// picker session, progressively, so collapsed folders are searchable as well.
export async function indexLazyFiles(entries, loadDirectory, { signal, onBatch } = {}) {
  const queue = entries.filter(entry => entry.type === 'directory' && entry.lazy).map(entry => entry.path);
  const visited = new Set(), failures = [];
  for (let i = 0; i < queue.length && !signal?.aborted; i++) {
    const path = queue[i];
    if (visited.has(path)) continue;
    visited.add(path);
    try {
      const rows = await loadDirectory(path, signal);
      if (signal?.aborted) break;
      onBatch?.(rows);
      for (const row of rows) if (row.type === 'directory' && row.lazy) queue.push(row.path);
    } catch (error) {
      if (signal?.aborted) break;
      failures.push({ path, error });
    }
  }
  return failures;
}
