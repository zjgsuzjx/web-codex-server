import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ignore from 'ignore';
import { openSafe, relativePath, safePath } from './files.js';

const execute = promisify(execFile);
// These defaults apply to untracked files; versioned project files take precedence.
const generatedDirectories = new Set(['.work', '.deploy', '.deploy-state', '.deploy-releases', '.cache', '.pytest_cache', '__pycache__', '.next', '.nuxt', '.svelte-kit', 'dist', 'build', 'coverage', 'test-results', 'bin', 'obj', 'tmp', 'temp', 'Library', 'Temp', 'Logs']);
const generatedExtension = /\.(?:dll|exe|pdb|obj|o|class|pyc|pyo|tmp|temp|bak|swp|swo|log)$/i;
const hardExcluded = new Set(['.git', 'node_modules', '.venv']);

export function generatedChangePath(value) {
  return value.split('/').some(part => generatedDirectories.has(part)) || generatedExtension.test(value) || /(?:^|\/)\.~|~$/.test(value);
}

async function ignoreRules(root, directory) {
  let opened;
  try {
    opened = await openSafe(root, directory ? `${directory}/.gitignore` : '.gitignore');
    if (opened.stat.size > 256 * 1024) return null;
    const bytes = Buffer.alloc(opened.stat.size + 1);
    const { bytesRead } = await opened.handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > opened.stat.size) return null;
    return ignore().add(bytes.subarray(0, bytesRead).toString('utf8'));
  } catch { return null; }
  finally { await opened?.handle.close(); }
}

async function gitFiles(root, directory) {
  // Git is used only for file names. File contents always go through openSafe.
  // Disable fsmonitor hooks and inherited Git configuration/environment overrides.
  try {
    const gitPath = directory ? `${directory}/.git` : '.git';
    const gitDir = await safePath(root, gitPath), stat = await fs.lstat(gitDir);
    if (!stat.isDirectory() && !stat.isFile()) return null;
    const repo = path.join(root, directory), env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' });
    const args = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', `safe.directory=${repo}`, `--git-dir=${gitDir}`, `--work-tree=${repo}`, 'ls-files', '-z'];
    const results = await Promise.all([
      execute('git', [...args, '--cached', '--'], { cwd: repo, env, timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }),
      execute('git', [...args, '--others', '--exclude-standard', '--'], { cwd: repo, env, timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })
    ]);
    const parse = output => new Set(output.split('\0').filter(value => { try { relativePath(value, false); return true; } catch { return false; } }));
    const tracked = parse(results[0].stdout), untracked = parse(results[1].stdout.replace(/\/\0/g, '\0'));
    return { directory, tracked, files: new Set([...tracked, ...untracked].filter(file => tracked.has(file) || !generatedChangePath(file))) };
  } catch { return null; } // Uploaded folders still use .gitignore below.
}

function parents(files) {
  const dirs = new Set();
  for (const file of files) {
    const parts = file.split('/'); parts.pop();
    while (parts.length) { dirs.add(parts.join('/')); parts.pop(); }
  }
  return dirs;
}

export async function changeFileFilter(root, baseline) {
  const policies = new Map(), preserved = new Set(baseline?.files.keys() || []), preservedDirs = parents(preserved);
  async function enter(directory, parent) {
    const repo = await gitFiles(root, directory);
    if (repo) repo.dirs = parents(repo.files);
    const policy = { repo: repo || parent?.repo, rules: [...(parent?.rules || [])] };
    const rules = await ignoreRules(root, directory);
    if (rules) policy.rules.push({ directory, rules });
    policies.set(directory, policy); return policy;
  }
  await enter('');
  return async (name, isDirectory) => {
    const parts = name.split('/');
    if (parts.some(part => hardExcluded.has(part))) return false;
    const parent = parts.slice(0, -1).join('/'), policy = policies.get(parent);
    const kept = isDirectory ? preservedDirs.has(name) : preserved.has(name);
    const rel = policy.repo?.directory ? name.slice(policy.repo.directory.length + 1) : name;
    const versioned = policy.repo && (isDirectory ? policy.repo.dirs.has(rel) || policy.repo.tracked.has(rel) : policy.repo.tracked.has(rel));
    if (!kept && !versioned && generatedChangePath(name)) return false;
    if (!kept && policy.repo && isDirectory && !policy.repo.dirs.has(rel) && !policy.repo.files.has(rel)) return false;
    // Discover a repository inside an uploaded project folder as well as at its root.
    const current = isDirectory ? await enter(name, policy) : policy;
    if (kept) return true;
    if (current.repo) {
      const local = current.repo.directory ? name.slice(current.repo.directory.length + 1) : name;
      if (isDirectory && current.repo.directory === name) return true;
      return isDirectory ? current.repo.dirs.has(local) : current.repo.files.has(local);
    }
    let ignored = false;
    for (const { directory, rules } of policy.rules) {
      const result = rules.test((directory ? name.slice(directory.length + 1) : name) + (isDirectory ? '/' : ''));
      if (result.ignored || result.unignored) ignored = result.ignored;
    }
    return !ignored;
  };
}
