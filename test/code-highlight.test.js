import test from 'node:test';
import assert from 'node:assert/strict';
import { codeLanguage, MAX_HIGHLIGHT_LENGTH } from '../src/code-language.js';
import { highlightCode } from '../src/code-highlight.js';

const text = node => node.type === 'text' ? node.value : (node.children || []).map(text).join('');
const classes = node => [...(node.properties?.className || []), ...(node.children || []).flatMap(classes)];

test('fence aliases have readable language labels and reuse the matching grammar', () => {
  for (const alias of ['cs', 'c#', 'CSHARP', 'language-cs']) assert.equal(codeLanguage(alias).label, 'C#');
  for (const [alias, label, grammar] of [['js', 'JavaScript', 'javascript'], ['tsx', 'TSX', 'typescript'], ['html', 'HTML', 'xml'], ['toml', 'TOML', 'ini'], ['pwsh', 'PowerShell', 'powershell']]) {
    assert.equal(codeLanguage(alias).label, label);
    assert.equal(codeLanguage(alias).grammar, grammar);
  }
});

test('short C# calls and enum members from the reported example get distinct tokens', () => {
  const code = 'SetOutlinerStrategy(_selection.Count > 0\n    ? OutlineRenderingStrategy.PerObject\n    : OutlineRenderingStrategy.Default);\n';
  const result = highlightCode(code, 'cs');
  assert.equal(result.language.label, 'C#');
  assert.equal(text(result.tree), code);
  for (const token of ['hljs-title', 'function_', 'hljs-type', 'hljs-property', 'hljs-number']) assert.ok(classes(result.tree).includes(token), token);
  const numbers = [];
  function collect(node) {
    if (node.properties?.className?.includes('hljs-number')) numbers.push(text(node));
    for (const child of node.children || []) collect(child);
  }
  collect(result.tree);
  assert.deepEqual(numbers, ['0']);
});

test('common languages preserve exact source, including whitespace and partial streams', () => {
  for (const [fence, code] of [
    ['js', 'const value = "hello";\n'], ['tsx', 'const node = <Button value={42} />;\n'],
    ['python', 'def greet(name):\n\treturn "hello " + name\n'], ['json', '{"enabled": true, "count": 42}\n'],
    ['html', '<section class="test">你好</section>\n'], ['css', '.card { color: red; }\n'],
    ['sh', 'echo "hello"\n'], ['powershell', '$value = Get-ChildItem\n'], ['sql', 'SELECT name FROM users;\n'],
    ['c', 'int main() { return 0; }\n'], ['cpp', 'auto value = std::string("text");\n'],
    ['java', 'public class Test { int value = 42; }\n'], ['go', 'package main\nfunc main() {}\n'],
    ['rust', 'fn main() { let value = 42; }\n'], ['toml', '[server]\nport = 3100\n'],
    ['yaml', 'enabled: true\n'], ['dockerfile', 'FROM node:24\nRUN npm ci\n'],
    ['diff', '+added\n-removed\n'], ['md', '# Heading\n**bold**\n'], ['cs', 'public string Name => "unfinished'],
  ]) {
    const result = highlightCode(code, fence);
    assert.ok(result.tree, fence);
    assert.equal(text(result.tree), code, fence);
    assert.ok(classes(result.tree).length > 0, fence);
  }
});

test('HTML payloads stay text in an AST of spans, without executable attributes', () => {
  const code = '<script>window.__codeXss = 1</script>\n<img src=x onerror="alert(1)">\n';
  const { tree } = highlightCode(code, 'html');
  assert.equal(text(tree), code);
  function check(node) {
    if (node.type === 'element') {
      assert.equal(node.tagName, 'span');
      assert.deepEqual(Object.keys(node.properties), ['className']);
    }
    for (const child of node.children || []) check(child);
  }
  check(tree);
});

test('plain text, unsupported languages and oversized blocks retain readable source', () => {
  for (const fence of ['text', 'none', 'a-future-language']) assert.equal(highlightCode('const value = 42;', fence).tree, null);
  assert.equal(highlightCode('a'.repeat(MAX_HIGHLIGHT_LENGTH + 1), 'js').tree, null);
  assert.equal(highlightCode('Ordinary words without programming syntax.').tree, null);
  assert.equal(highlightCode('').tree, null);
  const detected = highlightCode('def greet(name):\n    return "hello " + name\n');
  assert.equal(detected.language.label, 'Python');
  assert.equal(detected.detected, true);
});
