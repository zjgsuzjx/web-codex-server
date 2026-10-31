import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const pending=['server/index.js','scripts/smoke.mjs','scripts/role-smoke.mjs'],visited=new Set();
  while(pending.length){
    const relative=pending.pop();if(visited.has(relative))continue;visited.add(relative);
    assert.ok(await included(relative),`Runtime image is missing ${relative}; include it in Dockerfile COPY rules`);
    const source=await fs.readFile(path.join(root,relative),'utf8');
    for(const match of source.matchAll(/^\s*(?:import\s+(?:[^'"\n]*?\s+from\s*)?|export\s+[^'"\n]*?\s+from\s*)['"](\.[^'"]+)['"]/gm)){
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(relative),match[1]));
      assert.ok(!dependency.startsWith('../'),`Unexpected external relative import: ${dependency}`);
      pending.push(dependency);
    }
  }
});
