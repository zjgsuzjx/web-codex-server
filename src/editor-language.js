export function editorLanguage(file, languages) {
  const name = (file || '').split(/[\\/]/).at(-1).toLowerCase();
  const aliases = { '.env': 'ini', '.env.local': 'ini', 'dockerfile': 'dockerfile', 'containerfile': 'dockerfile', 'makefile': 'shell', 'gnumakefile': 'shell' };
  if (aliases[name]) return aliases[name];
  if (/^(?:dockerfile|containerfile)\./.test(name)) return 'dockerfile';
  if (/\.env(?:\.|$)/.test(name)) return 'ini';
  if (name.endsWith('.toml')) return 'ini';
  const exact = languages.find(l => l.filenames?.some(n => n.toLowerCase() === name));
  if (exact) return exact.id;
  const matches = languages.flatMap(l => (l.extensions || []).filter(ext => name.endsWith(ext.toLowerCase())).map(ext => ({ id: l.id, length: ext.length })));
  return matches.sort((a, b) => b.length - a.length)[0]?.id || 'plaintext';
}
