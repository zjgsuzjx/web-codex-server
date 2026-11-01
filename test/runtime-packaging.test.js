import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('candidate syntax checks accept erasable TypeScript without the compiler and reject invalid source', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-ts-check-'));
  const execute = promisify(execFile);
  try {
    await fs.mkdir(path.join(directory, 'server'));
    await fs.mkdir(path.join(directory, 'shared'));
    const checker = path.join(directory, 'check-runtime.mjs');
    await fs.copyFile(new URL('../scripts/check-runtime.mjs', import.meta.url), checker);
    await fs.writeFile(path.join(directory, 'server/index.ts'), 'interface Config { value: number }\nexport const config: Config = {value: 1};\n');
    await execute(process.execPath, [checker], { cwd: directory });
    await fs.writeFile(path.join(directory, 'server/index.ts'), 'export const broken: = ;\n');
    await assert.rejects(execute(process.execPath, [checker], { cwd: directory }));
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('sv-ts-check-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('runtime image excludes tests and frontend sources while including server and maintenance modules',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const dockerfile=await fs.readFile(path.join(root,'Dockerfile'),'utf8');
  const runtime=dockerfile.split(/^FROM /m).at(-1),copies=[];
  for(const line of runtime.split(/\r?\n/)){
    const match=line.match(/^COPY\s+(?!-)(\S+)\s+(\S+)\s*$/);
    if(!match)continue;
    copies.push({source:match[1].replace(/^\.\//,''),dest:match[2].replace(/^\.\//,'').replace(/\/$/,'')});
  }
  async function included(relative){
    for(const {source,dest} of copies){
      if(relative!==source&&!relative.startsWith(source+'/'))continue;
      const stat=await fs.stat(path.join(root,source));
      const target=dest==='.'||dest===''?path.posix.basename(source):dest;
      const mapped=stat.isDirectory()?target+relative.slice(source.length):target;
      if(mapped===relative)return true;
    }
    return false;
  }
  const ignored=await fs.readFile(path.join(root,'.dockerignore'),'utf8');
  assert.match(ignored,/^\/?test\/?\s*$/m,'Exclude test/ from the Docker build context');
  for(const name of await fs.readdir(path.join(root,'test')))assert.equal(await included('test/'+name),false,'Test files must not ship in the runtime image');
  assert.ok(copies.every(copy=>!copy.source.startsWith('src/')),'Unbundled frontend modules are not needed by the runtime');
  const pending=['server/index.ts','scripts/smoke.mjs','scripts/role-smoke.mjs','scripts/check-runtime.mjs'],visited=new Set();
  while(pending.length){
    const relative=pending.pop();if(visited.has(relative))continue;visited.add(relative);
    assert.ok(await included(relative),`Runtime image is missing ${relative}; include it in Dockerfile COPY rules`);
    const source=await fs.readFile(path.join(root,relative),'utf8');
    const ast=ts.createSourceFile(relative,source,ts.ScriptTarget.Latest,true);
    for(const statement of ast.statements){
      if(!ts.isImportDeclaration(statement)&&!ts.isExportDeclaration(statement))continue;
      if(ts.isImportDeclaration(statement)&&statement.importClause?.isTypeOnly)continue;
      if(ts.isExportDeclaration(statement)&&statement.isTypeOnly)continue;
      const specifier=statement.moduleSpecifier;
      if(!specifier||!ts.isStringLiteral(specifier)||!specifier.text.startsWith('.'))continue;
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(relative),specifier.text));
      assert.ok(!dependency.startsWith('../'),`Unexpected external relative import: ${dependency}`);
      pending.push(dependency);
    }
  }
});
