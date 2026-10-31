import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const exec = promisify(execFile);
const revision = 'a'.repeat(40);

test('build cache cleanup is bounded, scoped and runs before builder/swap teardown', async t => {
  let bash = '/bin/bash';
  if (process.platform === 'win32') {
    try {
      const { stdout } = await exec('git', ['--exec-path']);
      bash = path.resolve(stdout.trim(), '../../../bin/bash.exe');
      await fs.access(bash);
    } catch { t.skip('Git Bash is required for local deployment helper tests'); return; }
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-build-cache-'));
  try {
    await fs.mkdir(path.join(directory, 'bin'));
    await fs.copyFile(new URL('../scripts/deploy-build.sh', import.meta.url), path.join(directory, 'helper.sh'));
    await fs.writeFile(path.join(directory, 'bin/docker'), `#!/bin/bash
printf 'docker %s\\n' "$*" >> "$TEST_LOG"
case "$1 $2" in
  'buildx build') exit "$TEST_BUILD_EXIT";;
  'buildx prune') echo 'Total: 1.25GB'; exit "$TEST_PRUNE_EXIT";;
esac
`, { mode: 0o755 });
    // Record the real timeout arguments without waiting for a simulated timeout.
    await fs.writeFile(path.join(directory, 'bin/timeout'), `#!/bin/bash
printf 'timeout %s\\n' "$*" >> "$TEST_LOG"
while [[ "$1" == --* ]]; do shift; done
[[ "$1" =~ ^[0-9]+s$ ]] || exit 99
shift
exec "$@"
`, { mode: 0o755 });
    const harness = path.join(directory, 'harness.sh');
    await fs.writeFile(harness, `#!/bin/bash
set -euo pipefail
TEST_DIR=$(cd "$(dirname "$0")" && pwd -P)
export TEST_LOG="$TEST_DIR/calls" PATH="$TEST_DIR/bin:$PATH"
[[ "$(command -v docker)" == "$TEST_DIR/bin/docker" ]]
source "$TEST_DIR/helper.sh"
build_swap() { printf 'swap %s\\n' "$1" >> "$TEST_LOG"; }
BUILD_STARTED=true
BUILD_SWAP=true
BUILD_DEADLINE=$(($(date +%s) + TEST_BUDGET))
result=0
build_image --tag fixture-web "$TEST_DIR" || result=$?
if [[ "$result" == 0 && "$TEST_SECOND_IMAGE" == true ]]; then build_image --tag fixture-worker "$TEST_DIR" || result=$?; fi
finish_build || result=1
# The release's EXIT trap calls finish_build again; it must be a no-op.
finish_build
printf 'state started=%s swap=%s dirty=%s\\n' "$BUILD_STARTED" "$BUILD_SWAP" "$BUILD_CACHE_DIRTY" >> "$TEST_LOG"
exit "$result"
`);
    const scenarios = [
      { name: 'two successful builds', second: true, code: 0, prunes: 1 },
      { name: 'failed build', buildExit: 1, code: 1, prunes: 1 },
      { name: 'timed out build', buildExit: 124, code: 124, prunes: 1 },
      { name: 'failed prune', pruneExit: 1, code: 1, prunes: 1 },
      { name: 'timed out prune', pruneExit: 124, code: 1, prunes: 1 },
      { name: 'budget exhausted before building', budget: -1, code: 124, prunes: 0 }
    ];
    for (const scenario of scenarios) await t.test(scenario.name, async () => {
      await fs.writeFile(path.join(directory, 'calls'), '');
      let code = 0;
      try {
        await exec(bash, ['--noprofile', '--norc', harness], { env: { ...process.env, TEST_BUILD_EXIT: String(scenario.buildExit || 0), TEST_PRUNE_EXIT: String(scenario.pruneExit || 0), TEST_SECOND_IMAGE: String(!!scenario.second), TEST_BUDGET: String(scenario.budget ?? 60) } });
      } catch (error) { code = error.code; }
      const calls = (await fs.readFile(path.join(directory, 'calls'), 'utf8')).trim().split('\n');
      assert.equal(code, scenario.code, calls.join('\n'));
      const prunes = calls.filter(call => call.startsWith('docker buildx prune '));
      assert.equal(prunes.length, scenario.prunes);
      if (scenario.prunes) {
        assert.equal(prunes[0], 'docker buildx prune --builder sv-codex-bounded-20261016 --all --force');
        assert.ok(calls.includes('timeout --signal=TERM --kill-after=10s 120s docker buildx prune --builder sv-codex-bounded-20261016 --all --force'));
        assert.ok(calls.findLastIndex(call => call.startsWith('docker buildx build ')) < calls.indexOf(prunes[0]));
        assert.ok(calls.indexOf(prunes[0]) < calls.indexOf('docker buildx stop sv-codex-bounded-20261016'));
      }
      assert.ok(calls.indexOf('docker buildx stop sv-codex-bounded-20261016') < calls.indexOf('swap remove'));
      assert.equal(calls.at(-1), 'state started=false swap=false dirty=false');
      assert.ok(!calls.some(call => /docker (system|image|volume|builder) prune/.test(call)));
      if (scenario.second) assert.equal(calls.filter(call => call.startsWith('docker buildx build ')).length, 2);
    });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('main deployment extracts readable source while keeping runtime state private', { skip: process.platform !== 'linux' }, async () => {
  const directory = await fs.mkdtemp(path.join(os.userInfo().homedir, '.codex-main-deploy-test-'));
  const app = path.join(directory, 'apps/web-codex-server'), fixture = path.join(directory, 'fixture'), bin = path.join(directory, 'bin');
  const archive = path.join(directory, 'source.tar'), record = path.join(directory, 'release-checked');
  try {
    await fs.mkdir(path.join(app, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(fixture, 'src'), { recursive: true, mode: 0o755 });
    await fs.mkdir(path.join(fixture, 'scripts'), { mode: 0o755 }); await fs.mkdir(bin);
    await fs.writeFile(path.join(fixture, 'package.json'), '{}', { mode: 0o644 });
    await fs.writeFile(path.join(fixture, 'src/index.js'), 'export {};', { mode: 0o644 });
    await fs.writeFile(path.join(fixture, 'scripts/tool.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const script = await fs.readFile(new URL('../scripts/deploy-main.sh', import.meta.url), 'utf8');
    // Substitute only Git discovery; archive extraction and deployment flow are real.
    await fs.writeFile(path.join(app, 'scripts/deploy-main.sh'), script.replace('export PATH=/usr/local/bin:/usr/bin:/bin', 'export PATH="$DEPLOY_TEST_BIN:/usr/local/bin:/usr/bin:/bin"'));
    await fs.writeFile(path.join(bin, 'git'), `#!/bin/bash
set -euo pipefail
case " $* " in
  *" init --bare "*) mkdir -p "\${@: -1}";;
  *" rev-parse FETCH_HEAD "*) printf '%s\\n' "$MOCK_REVISION";;
  *" ls-tree -r --name-only "*) printf 'package.json\\nsrc/index.js\\nscripts/tool.sh\\n';;
  *" archive "*) cat "$MOCK_ARCHIVE";;
esac
`, { mode: 0o755 });
    await fs.writeFile(path.join(fixture, 'scripts/deploy-release.sh'), `#!/bin/bash
set -euo pipefail
[[ "$(stat -c %a "$1")" == 700 ]]
[[ "$(stat -c %a "$1/package.json")" == 644 ]]
[[ "$(stat -c %a "$1/src")" == 755 ]]
[[ "$(stat -c %a "$1/src/index.js")" == 644 ]]
[[ "$(stat -c %a "$1/scripts/tool.sh")" == 755 ]]
[[ ! -e "$1/.env" && ! -e "$1/MEMORY.md" && ! -e "$1/AGENTS.md" ]]
printf '%s\\n' "$2" > "$MOCK_RECORD"
`);
    await exec('/bin/tar', ['-cf', archive, '-C', fixture, 'package.json', 'src', 'scripts']);
    await fs.writeFile(path.join(app, '.env'), 'private runtime fixture', { mode: 0o600 });
    await exec('/bin/bash', [path.join(app, 'scripts/deploy-main.sh'), revision], { env: { ...process.env, DEPLOY_TEST_BIN: bin, MOCK_REVISION: revision, MOCK_ARCHIVE: archive, MOCK_RECORD: record } });
    assert.equal((await fs.readFile(record, 'utf8')).trim(), revision);
    assert.equal((await fs.stat(path.join(app, '.deploy-state/main.lock'))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(app, '.deploy-state'))).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(app, '.env'))).mode & 0o777, 0o600);
    assert.equal(await fs.readFile(path.join(app, '.env'), 'utf8'), 'private runtime fixture');
    assert.deepEqual(await fs.readdir(path.join(app, '.deploy-releases')), []);
    const result = JSON.parse(await fs.readFile(path.join(app, '.deploy-state/result-' + revision + '.json')));
    assert.equal(result.status, 'succeeded'); assert.equal(result.exitCode, 0);
    // A stale state file must never turn a broken/wrong live revision green.
    await fs.writeFile(path.join(app, '.deploy-state/deployed-commit'), revision);
    await fs.writeFile(path.join(bin, 'curl'), '#!/bin/bash\necho \'{"status":"ok","revision":"wrong"}\'\n', { mode: 0o755 });
    const env = { ...process.env, DEPLOY_TEST_BIN: bin, MOCK_REVISION: revision, MOCK_ARCHIVE: archive, MOCK_RECORD: record };
    await assert.rejects(exec('/bin/bash', [path.join(app, 'scripts/deploy-main.sh'), revision], { env }), error => error.code === 1);
    assert.equal(JSON.parse(await fs.readFile(path.join(app, '.deploy-state/result-' + revision + '.json'))).status, 'failed');
    await fs.writeFile(path.join(bin, 'curl'), `#!/bin/bash\necho '{"status":"ok","revision":"${revision}"}'\n`, { mode: 0o755 });
    await exec('/bin/bash', [path.join(app, 'scripts/deploy-main.sh'), revision], { env });
    await fs.rm(path.join(app, '.deploy-state/deployed-commit'));
    await assert.rejects(exec('/bin/bash', [path.join(app, 'scripts/deploy-main.sh'), revision], { env: { ...env, MOCK_REVISION: 'b'.repeat(40) } }), error => error.code === 78);
    assert.equal(JSON.parse(await fs.readFile(path.join(app, '.deploy-state/result-' + revision + '.json'))).exitCode, 78);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('release deployment validates, defers and restores without touching production resources', { skip: process.platform !== 'linux' }, async t => {
  const directory = await fs.mkdtemp(path.join(os.userInfo().homedir, '.codex-deploy-test-'));
  const app = path.join(directory, 'apps/web-codex-server'), source = path.join(app, '.deploy-releases/candidate'), bin = path.join(directory, 'bin');
  await fs.mkdir(path.join(app, 'scripts'), { recursive: true }); await fs.mkdir(source, { recursive: true }); await fs.mkdir(bin);
  await fs.copyFile(new URL('../scripts/deploy-release.sh', import.meta.url), path.join(app, 'scripts/deploy-release.sh'));
  for (const file of ['deploy-build.sh', 'deploy-swap.sh']) await fs.copyFile(new URL('../scripts/' + file, import.meta.url), path.join(app, 'scripts', file));
  await fs.mkdir(path.join(app, 'deploy'));
  await fs.copyFile(new URL('../deploy/buildkitd.toml', import.meta.url), path.join(app, 'deploy/buildkitd.toml'));
  for (const file of ['Dockerfile', 'Dockerfile.worker', 'compose.yml']) { await fs.writeFile(path.join(source, file), 'fixture'); await fs.writeFile(path.join(app, file), 'fixture'); }
  await fs.writeFile(path.join(app, '.env'), 'fixture runtime settings');
  const log = path.join(directory, 'calls'), counter = path.join(directory, 'curl-count');
  const wrappers = {
    docker: `#!/bin/bash
printf '%s\\n' "$*" >> "$MOCK_LOG"
if [[ "$1" == update && "$*" == *--cpus* ]]; then echo 'CPU quota/period already set' >&2; exit 1; fi
if [[ "$1 $2" == 'image inspect' ]]; then echo "sha256:previous"; fi
if [[ "$1" == inspect && "$*" == *Config.Image* ]]; then echo 'moby/buildkit@sha256:6c2fa84a6b61ccd72899dde4239f8d5717f05f9a8ca6f3cad185fb1a95a94de3'; fi
if [[ "$1" == inspect && "$*" == *HostConfig.Memory* ]]; then
  if [[ "$MOCK_SCENARIO" == bad-limits ]]; then echo '0 0 0 0 0'; else echo '1073741824 3758096384 75000 100000 256'; fi
fi
if [[ "$1" == exec ]]; then
  case "$*" in
    *memory.max*) printf '1073741824\\n2684354560\\n75000 100000\\n';;
    *buildkitd.toml*) echo '  max-parallelism = 1';;
    *io.max*) if [[ "$MOCK_SCENARIO" != bad-io ]]; then echo '253:0 rbps=50331648 wbps=25165824 riops=max wiops=max'; fi;;
  esac
fi
if [[ "$1 $2" == 'buildx build' && "$MOCK_SCENARIO" == failed-build ]]; then exit 1; fi
if [[ "$1 $2" == 'buildx build' && "$MOCK_SCENARIO" == swap-build-failed ]]; then exit 1; fi
if [[ "$1 $2" == 'buildx build' && "$MOCK_SCENARIO" == build-timeout ]]; then exit 124; fi
if [[ "$1 $2" == 'buildx prune' ]]; then
  if [[ "$MOCK_SCENARIO" == failed-prune || "$MOCK_SCENARIO" == swap-prune-failed ]]; then exit 1; fi
  if [[ "$MOCK_SCENARIO" == prune-timeout ]]; then exit 124; fi
  echo 'Total: 1.25GB'
fi
if [[ "$1" == run && "$*" == *--privileged* ]]; then
  if [[ "\${@: -1}" == create ]]; then touch "$MOCK_SWAP_STATE"; else rm -f "$MOCK_SWAP_STATE"; fi
fi
if [[ "$1" == run && "$MOCK_SCENARIO" == failed-checks ]]; then exit 1; fi
`,
    curl: `#!/bin/bash
if [[ "$*" == *--unix-socket* ]]; then echo '{"Warnings":null}'; exit; fi
n=0; [[ ! -f "$MOCK_COUNTER" ]] || n=$(cat "$MOCK_COUNTER"); n=$((n+1)); echo "$n" > "$MOCK_COUNTER"
if [[ "$MOCK_SCENARIO" == busy || ( "$MOCK_SCENARIO" == work-started && "$n" -ge 2 && "$n" -le 22 ) || ( "$MOCK_SCENARIO" == work-finished && "$n" == 2 ) ]]; then echo '{"status":"ok","deploymentReady":false}';
elif [[ "$MOCK_SCENARIO" == bootstrap && ( "$MOCK_BOOTSTRAP" != true || "$n" -lt 3 ) ]]; then echo '{"status":"ok"}';
elif [[ "$n" -lt 3 ]]; then echo '{"status":"ok","deploymentReady":true}';
elif [[ "$MOCK_SCENARIO" == failed-health ]]; then echo '{"status":"ok","revision":"wrong"}';
else printf '{"status":"ok","revision":"%s","deploymentReady":true}\\n' "$MOCK_REVISION"; fi
`,
    rsync: '#!/bin/bash\nprintf "promote\\n" >> "$MOCK_LOG"\n',
    sleep: '#!/bin/bash\nexit 0\n',
    df: '#!/bin/bash\nfree=7000000000; [[ "$MOCK_SCENARIO" != swap-low-disk ]] || free=4000000000\nprintf "Filesystem 1B-blocks Used Available Use%% Mounted\\n/dev/vda2 40000000000 30000000000 %s 75%% /\\n" "$free"\n',
    lsblk: '#!/bin/bash\necho 253:0\n',
    awk: `#!/bin/bash
if [[ "$*" == *MemAvailable* ]]; then
  if [[ "$MOCK_SCENARIO" == low-memory ]]; then echo 100000; else echo 1100000; fi
elif [[ "$*" == *SwapFree* ]]; then
  if [[ "$MOCK_SCENARIO" == swap-* && ! -f "$MOCK_SWAP_STATE" ]]; then echo 1500000; else echo 3000000; fi
else exec /usr/bin/awk "$@"; fi
`
  };
  for (const [name, script] of Object.entries(wrappers)) await fs.writeFile(path.join(bin, name), script, { mode: 0o755 });
  async function run(scenario, bootstrap = false) {
    await fs.writeFile(log, ''); await fs.rm(counter, { force: true });
    await fs.rm(path.join(app, '.deploy-state/deployed-commit'), { force: true });
    let code = 0;
    try { await exec('/bin/bash', [path.join(app, 'scripts/deploy-release.sh'), source, revision, ...(bootstrap ? ['--bootstrap'] : [])], { env: { ...process.env, PATH: bin + ':' + process.env.PATH, MOCK_LOG: log, MOCK_COUNTER: counter, MOCK_SCENARIO: scenario, MOCK_REVISION: revision, MOCK_SWAP_STATE: path.join(directory, 'swap-state'), MOCK_BOOTSTRAP: String(bootstrap) } }); }
    catch (e) { code = e.code; }
    return { code, calls: await fs.readFile(log, 'utf8') };
  }
  try {
    await t.test('idle release checks syntax without running tests before promotion and records its revision', async () => {
      const result = await run('success'); assert.equal(result.code, 0);
      const calls = result.calls.trim().split('\n');
      const tested = calls.findIndex(call => call.startsWith('run --rm --network none'));
      const promoted = calls.findIndex(call => call.startsWith('tag starvalley-codex-web:'));
      assert.ok(tested >= 0 && promoted > tested, result.calls);
      assert.ok(calls[tested].endsWith('npm run check'),result.calls);
      assert.ok(!/npm test|node --test/.test(result.calls),'Production deployment must not run the test suite');
      const built = calls.findLastIndex(call => call.startsWith('buildx build '));
      const pruned = calls.indexOf('buildx prune --builder sv-codex-bounded-20261016 --all --force');
      const stopped = calls.findLastIndex(call => call === 'buildx stop sv-codex-bounded-20261016');
      assert.ok(built < pruned && pruned < stopped && stopped < tested, result.calls);
      assert.equal(calls.filter(call => call.startsWith('buildx prune ')).length, 1);
      assert.ok(result.calls.includes('promote')); assert.equal((await fs.readFile(path.join(app, '.deploy-state/deployed-commit'), 'utf8')).trim(), revision);
      assert.equal(await fs.readFile(path.join(app, '.env'), 'utf8'), 'fixture runtime settings');
    });
    await t.test('worker and web builds share cache until both images are loaded, then prune once', async () => {
      await fs.writeFile(path.join(app, 'Dockerfile.worker'), 'previous worker');
      try {
        const result = await run('success'); assert.equal(result.code, 0);
        assert.equal(result.calls.match(/buildx build /g)?.length, 2);
        assert.equal(result.calls.match(/buildx prune /g)?.length, 1);
        assert.ok(result.calls.lastIndexOf('buildx build ') < result.calls.indexOf('buildx prune '));
      } finally { await fs.writeFile(path.join(app, 'Dockerfile.worker'), 'fixture'); }
    });
    await t.test('busy application does not build or switch', async () => { const result = await run('busy'); assert.equal(result.code, 75); assert.equal(result.calls, ''); });
    await t.test('new work during build postpones the switch', async () => { const result = await run('work-started'); assert.equal(result.code, 75); assert.ok(result.calls.includes('run --rm')); assert.ok(!result.calls.includes('compose')); });
    await t.test('work finishing after build reuses the checked candidate', async () => { const result = await run('work-finished'); assert.equal(result.code, 0); assert.equal(result.calls.match(/buildx build /g)?.length, 1); assert.equal(result.calls.match(/run --rm --network none --memory/g)?.length, 1); });
    await t.test('low memory defers before any builder or swap starts', async () => { const result = await run('low-memory'); assert.equal(result.code, 75); assert.ok(!result.calls.includes('buildx')); assert.ok(!result.calls.includes('run --rm')); });
    await t.test('insufficient disk refuses extra swap and leaves production intact', async () => { const result = await run('swap-low-disk'); assert.equal(result.code, 75); assert.ok(!result.calls.includes('--privileged')); assert.ok(!result.calls.includes('buildx')); });
    for (const scenario of ['swap-success', 'swap-build-failed']) {
      await t.test(scenario + ' stops the builder before removing temporary swap', async () => {
        const result = await run(scenario); assert.equal(result.code, scenario === 'swap-success' ? 0 : 1);
        assert.ok(result.calls.includes('--privileged'));
        assert.equal(result.calls.match(/buildx prune /g)?.length, 1);
        assert.ok(result.calls.indexOf('buildx prune ') < result.calls.lastIndexOf('buildx stop'));
        assert.ok(result.calls.lastIndexOf('buildx stop') < result.calls.indexOf(app + ' remove'));
        assert.equal(await fs.stat(path.join(directory, 'swap-state')).then(() => true, () => false), false);
      });
    }
    for (const scenario of ['bad-limits', 'bad-io', 'failed-build', 'build-timeout']) {
      await t.test(scenario + ' stops the dedicated builder and preserves production', async () => {
        const result = await run(scenario); assert.equal(result.code, scenario === 'build-timeout' ? 124 : 1);
        assert.ok(result.calls.includes('buildx stop sv-codex-bounded-20261016'));
        assert.ok(!result.calls.includes('compose')); assert.ok(!result.calls.includes('promote'));
        assert.ok(!result.calls.split('\n').some(call => call.startsWith('build ')), result.calls);
        assert.equal(result.calls.match(/buildx prune /g)?.length || 0, ['failed-build', 'build-timeout'].includes(scenario) ? 1 : 0);
      });
    }
    for (const scenario of ['failed-prune', 'prune-timeout', 'swap-prune-failed']) {
      await t.test(scenario + ' fails before promotion and still stops the builder and removes swap', async () => {
        const result = await run(scenario); assert.equal(result.code, 1);
        assert.equal(result.calls.match(/buildx prune /g)?.length, 1, 'EXIT must not retry pruning or restart the builder');
        assert.ok(result.calls.indexOf('buildx prune ') < result.calls.lastIndexOf('buildx stop'));
        assert.ok(!result.calls.includes('run --rm --network none --memory'));
        assert.ok(!result.calls.includes('compose')); assert.ok(!result.calls.includes('promote'));
        assert.equal(await fs.stat(path.join(directory, 'swap-state')).then(() => true, () => false), false);
      });
    }
    await t.test('candidate syntax check failure keeps the running image', async () => { const result = await run('failed-checks'); assert.equal(result.code, 1); assert.ok(!result.calls.includes('compose')); assert.ok(!result.calls.includes('promote')); });
    await t.test('failed health restores the previous image and a saved original compose file', async () => { const result = await run('failed-health'); assert.equal(result.code, 1); assert.equal(result.calls.match(/compose /g)?.length, 2); assert.ok(result.calls.includes('tag sha256:previous starvalley-codex-web:local')); assert.ok(result.calls.includes('--file ' + path.join(app, '.deploy-state/previous-compose.'))); assert.ok(!result.calls.includes('promote')); });
    await t.test('legacy health requires an explicit bootstrap flag', async () => { assert.equal((await run('bootstrap')).code, 75); assert.equal((await run('bootstrap', true)).code, 0); });
    await t.test('local memory or credentials cannot enter a release', async () => { await fs.writeFile(path.join(source, 'MEMORY.md'), 'local only'); const result = await run('success'); assert.equal(result.code, 1); assert.equal(result.calls, ''); });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
