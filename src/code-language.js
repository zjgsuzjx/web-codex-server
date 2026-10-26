export const MAX_HIGHLIGHT_LENGTH = 30_000;

const definitions = [
  ['csharp', 'C#', ['cs', 'c#', 'c-sharp']],
  ['javascript', 'JavaScript', ['js', 'mjs', 'cjs', 'node']],
  ['typescript', 'TypeScript', ['ts']],
  ['jsx', 'JSX', [], 'javascript'],
  ['tsx', 'TSX', [], 'typescript'],
  ['python', 'Python', ['py', 'python3']],
  ['bash', 'Shell', ['sh', 'shell', 'zsh', 'shellscript']],
  ['powershell', 'PowerShell', ['ps', 'ps1', 'pwsh']],
  ['json', 'JSON', []],
  ['jsonc', 'JSONC', [], 'json'],
  ['html', 'HTML', ['htm'], 'xml'],
  ['xml', 'XML', ['svg']],
  ['css', 'CSS', []],
  ['sql', 'SQL', []],
  ['yaml', 'YAML', ['yml']],
  ['ini', 'INI', ['env', 'properties']],
  ['toml', 'TOML', [], 'ini'],
  ['c', 'C', ['h']],
  ['cpp', 'C++', ['c++', 'cc', 'cxx', 'hpp']],
  ['java', 'Java', []],
  ['go', 'Go', ['golang']],
  ['rust', 'Rust', ['rs']],
  ['dockerfile', 'Dockerfile', ['docker']],
  ['diff', 'Diff', ['patch']],
  ['markdown', 'Markdown', ['md']],
  ['plaintext', '纯文本', ['text', 'txt', 'plain', 'none', 'nohighlight']],
];

const languages = new Map();
for (const [id, label, aliases, grammar = id] of definitions) {
  const value = { id, label, grammar: id === 'plaintext' ? null : grammar };
  for (const alias of [id, ...aliases]) languages.set(alias, value);
}

export function codeLanguage(value = '') {
  const name = String(value).trim().replace(/^language-/i, '').split(/\s/)[0].toLowerCase();
  return languages.get(name) || { id: '', grammar: null, label: name.slice(0, 40) || '代码' };
}
