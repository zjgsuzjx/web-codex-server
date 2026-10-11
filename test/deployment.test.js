import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const exec = promisify(execFile);
const revision = 'a'.repeat(40);

test('release deployment validates, defers and restores without touching production resources', { skip: process.platform !== 'linux' }, async t => {
  const directory = await fs.mkdtemp(path.join(os.userInfo().homedir, '.codex-deploy-test-'));
  const app = path.join(directory, 'apps/web-codex-server'), source = path.join(app, '.deploy-releases/candidate'), bin = path.join(directory, 'bin');
  await fs.mkdir(path.join(app, 'scripts'), { recursive: true }); await fs.mkdir(source, { recursive: true }); await fs.mkdir(bin);
  await fs.copyFile(new URL('../scripts/deploy-release.sh', import.meta.url), path.join(app, 'scripts/deploy-release.sh'));
  for (const file of ['Dockerfile', 'Dockerfile.worker', 'compose.yml']) { await fs.writeFile(path.join(source, file), 'fixture'); await fs.writeFile(path.join(app, file), 'fixture'); }
  await fs.writeFile(path.join(app, '.env'), 'fixture runtime settings');
  const log = path.join(directory, 'calls'), counter = path.join(directory, 'curl-count');
  const wrappers = {
    docker: `#!/bin/bash
printf '%s\\n' "$*" >> "$MOCK_LOG"
if [[ "$1 $2" == 'image inspect' ]]; then echo "sha256:previous"; fi
if [[ "$1" == run && "$MOCK_SCENARIO" == failed-tests ]]; then exit 1; fi
`,
    curl: `#!/bin/bash
n=0; [[ ! -f "$MOCK_COUNTER" ]] || n=$(cat "$MOCK_COUNTER"); n=$((n+1)); echo "$n" > "$MOCK_COUNTER"
if [[ "$MOCK_SCENARIO" == busy || ( "$MOCK_SCENARIO" == work-started && "$n" == 2 ) ]]; then echo '{"status":"ok","deploymentReady":false}';
elif [[ "$MOCK_SCENARIO" == bootstrap && "$n" -lt 3 ]]; then echo '{"status":"ok"}';
elif [[ "$n" -lt 3 ]]; then echo '{"status":"ok","deploymentReady":true}';
elif [[ "$MOCK_SCENARIO" == failed-health ]]; then echo '{"status":"ok","revision":"wrong"}';
else printf '{"status":"ok","revision":"%s"}\\n' "$MOCK_REVISION"; fi
`,
    rsync: '#!/bin/bash\nprintf "promote\\n" >> "$MOCK_LOG"\n'
  };
  for (const [name, script] of Object.entries(wrappers)) await fs.writeFile(path.join(bin, name), script, { mode: 0o755 });
  async function run(scenario, bootstrap = false) {
    await fs.writeFile(log, ''); await fs.rm(counter, { force: true });
    await fs.rm(path.join(app, '.deploy-state/deployed-commit'), { force: true });
    let code = 0;
    try { await exec('/bin/bash', [path.join(app, 'scripts/deploy-release.sh'), source, revision, ...(bootstrap ? ['--bootstrap'] : [])], { env: { ...process.env, PATH: bin + ':' + process.env.PATH, MOCK_LOG: log, MOCK_COUNTER: counter, MOCK_SCENARIO: scenario, MOCK_REVISION: revision } }); }
    catch (e) { code = e.code; }
    return { code, calls: await fs.readFile(log, 'utf8') };
  }
  try {
    await t.test('idle release is tested before promotion and records its revision', async () => {
      const result = await run('success'); assert.equal(result.code, 0);
      assert.ok(result.calls.indexOf('run --rm --network none') < result.calls.indexOf('tag starvalley-codex-web:'));
      assert.ok(result.calls.includes('promote')); assert.equal((await fs.readFile(path.join(app, '.deploy-state/deployed-commit'), 'utf8')).trim(), revision);
      assert.equal(await fs.readFile(path.join(app, '.env'), 'utf8'), 'fixture runtime settings');
    });
    await t.test('busy application does not build or switch', async () => { const result = await run('busy'); assert.equal(result.code, 75); assert.equal(result.calls, ''); });
    await t.test('new work during build postpones the switch', async () => { const result = await run('work-started'); assert.equal(result.code, 75); assert.ok(result.calls.includes('run --rm')); assert.ok(!result.calls.includes('compose')); });
    await t.test('candidate test failure keeps the running image', async () => { const result = await run('failed-tests'); assert.equal(result.code, 1); assert.ok(!result.calls.includes('compose')); assert.ok(!result.calls.includes('promote')); });
    await t.test('failed health restores the previous image and original compose file', async () => { const result = await run('failed-health'); assert.equal(result.code, 1); assert.equal(result.calls.match(/compose /g)?.length, 2); assert.ok(result.calls.includes('tag sha256:previous starvalley-codex-web:local')); assert.ok(result.calls.includes('--file ' + path.join(app, 'compose.yml'))); assert.ok(!result.calls.includes('promote')); });
    await t.test('legacy health requires an explicit bootstrap flag', async () => { assert.equal((await run('bootstrap')).code, 75); assert.equal((await run('bootstrap', true)).code, 0); });
    await t.test('local memory or credentials cannot enter a release', async () => { await fs.writeFile(path.join(source, 'MEMORY.md'), 'local only'); const result = await run('success'); assert.equal(result.code, 1); assert.equal(result.calls, ''); });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
