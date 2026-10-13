import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeString } from 'micromark-util-decode-string';
import { remarkReplyFormat } from '../shared/markdown-format.js';
import { fileLinkInfo, isFileLineLink, rehypeFileReferences } from '../src/link-info.js';
import { currentThought } from '../shared/thinking.js';

const textNode = (raw, offset = 0) => ({ type: 'text', value: decodeString(raw), position: { start: { offset }, end: { offset: offset + raw.length } } });
const plain = node => node.value ?? node.children?.map(plain).join('') ?? '';
function format(source, children = [textNode(source)], type = 'paragraph') {
  const tree = { type: 'root', children: [{ type, children }] };
  remarkReplyFormat()(tree, { value: source });
  return tree.children[0].children;
}

test('reply emphasis accepts Chinese punctuation and edge spaces, preserving surrounding text', () => {
  for (const source of ['**必须使用 Claude 模型： **目前没有', '**中文：**目前没有', '** 标题： **目前没有']) {
    const nodes = format(source), strong = nodes.find(node => node.type === 'strong');
    assert.ok(strong); assert.equal(plain(strong).endsWith('：'), true);
    assert.equal(plain({ children: nodes }), source.replaceAll('**', ''));
    assert.equal(plain(strong), plain(strong).trim());
  }
});

test('reply emphasis preserves embedded links/code and ordinary nested emphasis', () => {
  const source = '**带 [文档](https://example.com) 与 `x`： **后文';
  const linkStart = source.indexOf('[文档]'), codeStart = source.indexOf('`x`'), tailStart = codeStart + 3;
  const link = { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: '文档' }] };
  const code = { type: 'inlineCode', value: 'x' };
  const nodes = format(source, [textNode(source.slice(0, linkStart)), link, textNode(' 与 ', codeStart - 3), code, textNode(source.slice(tailStart), tailStart)]);
  const strong = nodes.find(node => node.type === 'strong');
  assert.ok(strong.children.includes(link)); assert.ok(strong.children.includes(code));
  const existing = { type: 'strong', children: [{ type: 'emphasis', children: [{ type: 'text', value: '原有斜体' }] }] };
  const other = '**标题： **后文';
  assert.equal(format(other, [existing, textNode(other)])[0], existing);
});

test('consecutive Chinese labels recover incorrectly paired middle delimiters', () => {
  const source = '**第一：**正文**第二： **继续';
  const middleStart = source.indexOf('**正文'), middleEnd = middleStart + '**正文**'.length;
  const middle = { type: 'strong', children: [textNode('正文', middleStart + 2)], position: { start: { offset: middleStart }, end: { offset: middleEnd } } };
  const nodes = format(source, [textNode(source.slice(0, middleStart)), middle, textNode(source.slice(middleEnd), middleEnd)]);
  assert.deepEqual(nodes.filter(node => node.type === 'strong').map(plain), ['第一：', '第二：']);
  assert.equal(nodes.find(node => node.value === '正文')?.type, 'text');
});

test('escaped/entity markers, incomplete streams, math and code remain literal', () => {
  for (const source of ['\\*\\*字面标记\\*\\*', '\\**字面\\**', '&#42;&#42;字面&#42;&#42;', '**未完成', 'x ** y ** z', '***三个星号***', '**第一\n第二 **']) {
    const nodes = format(source);
    assert.equal(nodes.some(node => node.type === 'strong'), false);
    assert.equal(plain({ children: nodes }), decodeString(source));
  }
  const code = { type: 'inlineCode', value: '**标签： **<br>' };
  assert.equal(format('', [code])[0], code);
  const tree = { type: 'root', children: [{ type: 'code', value: '**标签： **<br>' }] };
  remarkReplyFormat()(tree, { value: '' });
  assert.equal(tree.children[0].value, '**标签： **<br>');
});

test('entities and escaped table pipes do not prevent emphasis repair', () => {
  const source = '**名称 &amp; 值\\|类型： **下一项';
  const nodes = format(source, undefined, 'tableCell');
  assert.equal(plain(nodes.find(node => node.type === 'strong')), '名称 & 值|类型：');
  assert.equal(plain({ children: nodes }), decodeString(source.replaceAll('**', '')));
});

test('only attribute-free HTML breaks become line breaks, including tables', () => {
  for (const value of ['<br>', '<br/>', '<br />', '<BR>']) {
    assert.equal(format('', [{ type: 'html', value }], 'tableCell')[0].type, 'break');
  }
  for (const value of ['<br onclick="alert(1)">', '<script>alert(1)</script>', '<!-- <br> -->', '<img src=x onerror=alert(1)>']) {
    assert.equal(format('', [{ type: 'html', value }])[0].type, 'html');
  }
  const tree = { type: 'root', children: [{ type: 'html', value: '<br>\n' }] };
  remarkReplyFormat()(tree, { value: '<br>\n' });
  assert.equal(tree.children[0].children[0].type, 'break');
  assert.equal(format('\\<br>')[0].value, '<br>');
});

test('file references decode spaces and strip line/column/section suffixes', () => {
  assert.deepEqual(fileLinkInfo('src/My%20App.jsx:42:3#L42'), { path: 'src/My App.jsx', line: 42, column: 3 });
  assert.deepEqual(fileLinkInfo('/workspace/project/app.js#L12-L20'), { path: '/workspace/project/app.js', line: 12, column: null });
  assert.equal(fileLinkInfo('README.md#installation').path, 'README.md');
  assert.equal(fileLinkInfo('docs/hash%23name.md').path, 'docs/hash#name.md');
  assert.equal(isFileLineLink('app.js:12'), true);
  assert.equal(isFileLineLink('src/My%20App.jsx#L42'), true);
  for (const href of ['javascript:1', 'javascript:/fake.js:1', 'javascript%3Aalert(1)', 'https://example.com/a.js:1', 'mailto:user.js:1', '//example.com/a', '/api/file', '/api', '/%61pi/file', '#section', 'bad%ZZ.md', 'bad%00.md', '%2F%2Fevil.example/a']) {
    assert.equal(fileLinkInfo(href), null, href);
    assert.equal(isFileLineLink(href), false, href);
  }
});

test('thinking status does not repeat formatted reasoning and tool labels remain plain text', () => {
  assert.equal(currentThought({ items: [{ type: 'reasoning', summary: ['**检查方向： **第一行<br>第二行<BR />第三行'] }] }), '正在思考');
  assert.equal(currentThought({ items: [{ type: 'dynamicToolCall', status: 'inProgress', tool: '检查<br>结果' }] }), '正在使用 检查 结果');
});

test('file pills keep following punctuation outside the link and preserve sentence text', () => {
  const link = { type: 'element', tagName: 'a', properties: { href: 'app.js:12' }, children: [{ type: 'text', value: 'app.js' }] };
  const tree = { type: 'root', children: [link, { type: 'text', value: '。下一句' }] };
  rehypeFileReferences()(tree);
  const group = tree.children[0];
  assert.equal(group.tagName, 'span'); assert.equal(group.children[0], link);
  assert.equal(group.children[1].children[0].value, '。');
  assert.equal(plain(tree), 'app.js。下一句');
  assert.equal(plain(link), 'app.js');
});

test('punctuation grouping preserves remote links, anchors and linked images', () => {
  for (const href of ['https://example.com', '#section', '/api/file', 'javascript:alert(1)']) {
    const link = { type: 'element', tagName: 'a', properties: { href }, children: [{ type: 'text', value: '内容' }] };
    const tree = { type: 'root', children: [link, { type: 'text', value: '。' }] };
    rehypeFileReferences()(tree); assert.equal(tree.children[0], link);
  }
  const link = { type: 'element', tagName: 'a', properties: { href: 'image.png' }, children: [{ type: 'element', tagName: 'img' }] };
  const tree = { type: 'root', children: [link, { type: 'text', value: '。' }] };
  rehypeFileReferences()(tree); assert.equal(tree.children[0], link);
});
