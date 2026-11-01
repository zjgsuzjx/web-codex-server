import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const roots = ['src', 'server', 'shared'];
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = `${directory}/${entry.name}`;
  return entry.isDirectory() ? walk(file) : [file];
});
const files = roots.flatMap(walk);
const errors = [];
for (const file of files) {
  if (/\.(js|jsx)$/.test(file)) errors.push(`${file}: application modules must use TS/TSX`);
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (/@ts-(?:nocheck|ignore)\b/.test(source)) errors.push(`${file}: file/type-check suppression is prohibited`);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function check(node) {
    const module = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
      ? node.moduleSpecifier
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? node.arguments[0]
        : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
          ? node.argument.literal
          : undefined;
    if (module && ts.isStringLiteral(module) && module.text.startsWith('.')) {
      const specifier = module.text;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (!fs.existsSync(target)) errors.push(`${file}: missing explicit import ${specifier}`);
      if (file.startsWith('shared/') && /^(src|server)\//.test(target)) errors.push(`${file}: shared modules cannot import application layers`);
      if (file.startsWith('server/') && target.startsWith('src/')) errors.push(`${file}: gateway cannot import browser modules`);
      if (file.startsWith('src/components/ui/') && target.startsWith('src/features/')) errors.push(`${file}: UI primitives cannot depend on features`);
    }
    ts.forEachChild(node, check);
  }
  check(ast);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Architecture checks passed (${files.filter(file => /\.(ts|tsx)$/.test(file)).length} TypeScript modules).`);
