import { readdir, readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';

async function modules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? modules(file) : /\.(ts|mjs)$/.test(file) && !file.endsWith('.d.ts') ? [file] : [];
  }));
  return nested.flat();
}

// Runs without TypeScript or test dependencies in the production image. Node 24
// strips erasable types. Strip explicitly before --check: some Node 24 releases
// treat .ts as JavaScript in their syntax-check-only path, even though normal
// module execution supports TypeScript.
for (const file of [...await modules('server'), ...await modules('shared')]) {
  const source = await readFile(file, 'utf8');
  const javascript = file.endsWith('.ts')
    ? stripTypeScriptTypes(source, { mode: 'strip', sourceUrl: file })
    : source;
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: javascript,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Runtime syntax checks passed.');
