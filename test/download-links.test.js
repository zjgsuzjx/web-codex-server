import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadLinkInfo, fileLinkInfo } from '../src/link-info.js';
import { editorLanguage } from '../src/editor-language.js';
import { signalLevel } from '../shared/connection.js';

test('download links keep decoded paths and bypass viewing; normal code references keep line info', () => {
  for (const [href,label] of [['docs/report%20final.pdf','下载报告'],['artifact.zip','Download archive'],['sandbox:/workspace/p/report.pdf','报告']]) {
    const result=downloadLinkInfo(href,label,'thread');assert.ok(result);assert.match(result.url,/^\/api\/threads\/thread\/download\?path=/);
    assert.equal(new URL(result.url,'http://localhost').searchParams.get('path'),result.path);
  }
  assert.equal(downloadLinkInfo('src/app.php:20','src/app.php','thread'),null);
  assert.deepEqual(fileLinkInfo('src/app.php:20'),{path:'src/app.php',line:20,column:null});
  for (const href of ['javascript:alert(1)','javascript%3Aalert(1)','sandbox:javascript:alert(1)','https://example.com/file.zip','/api/private','#part','//evil.example/file']) assert.equal(downloadLinkInfo(href,'下载','thread'),null);
  assert.equal(downloadLinkInfo('file.txt','下载',null),null);
});

test('registered language metadata handles uncommon extensions and extensionless files', () => {
  const languages=[{id:'php',extensions:['.php']},{id:'xml',extensions:['.xml','.svg']},{id:'csharp',extensions:['.cs']},{id:'cpp',extensions:['.cpp','.h']},{id:'typescript',extensions:['.ts','.tsx']},{id:'javascript',extensions:['.js','.jsx']},{id:'python',extensions:['.py'],filenames:['SConstruct']}];
  for (const [file,id] of [['a.PHP','php'],['logo.svg','xml'],['a.cs','csharp'],['a.h','cpp'],['SConstruct','python'],['Dockerfile.worker','dockerfile'],['Containerfile','dockerfile'],['settings.toml','ini'],['.env.production','ini'],['a.tsx','typescript'],['a.jsx','javascript'],['unknown.blob','plaintext']]) assert.equal(editorLanguage(file,languages),id);
});

test('four signal bars preserve inclusive quality boundaries and leave unknown samples unfilled', () => {
  for (const latency of [null, undefined, Infinity, NaN, -1]) assert.equal(signalLevel(latency), 0);
  for (const [latency, level] of [[1,4],[80,4],[81,3],[150,3],[151,2],[300,2],[301,1]]) assert.equal(signalLevel(latency), level);
});
