import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Duplex } from 'node:stream';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { createApp } from '../server/app.ts';
import { CodexManager } from '../server/codex/codex.ts';
import { CODEX_RUNTIME_BIN, CODEX_RUNTIME_MOUNT, CodexUpdates } from '../server/codex/updates.ts';

test('manual Codex updates verify the candidate before making it the persistent workspace default', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-codex-updates-'));
  const helpers = [];
  const reportedVersion = '0.99.0';
  let latest = '0.100.0';
  let registryCalls = 0;
  let failedVerification = false;
  let pauseInstall;
  let workerSpec;
  let workerCommand;
  let retiredWorkers = 0;
  const stream = new Duplex({
    read() {},
    write(data, encoding, done) {
      const request = JSON.parse(data);
      if (request.method === 'initialize')
        this.push(JSON.stringify({ id: request.id, result: {} }) + '\n');
      done();
    },
  });
  const oldWorker = {
    async inspect() {
      return {
        HostConfig: { NetworkMode: 'bridge' },
        Config: { Labels: { 'starvalley.execution': 'workspace' } },
        State: { Running: true },
        Mounts: [],
      };
    },
    async remove() {
      retiredWorkers++;
    },
  };
  const docker = {
    getImage() {
      return {
        async inspect() {
          return { Id: 'local-worker-image' };
        },
      };
    },
    getContainer() {
      return oldWorker;
    },
    async listContainers() {
      return [];
    },
    async createContainer(spec) {
      if (spec.name?.startsWith('sv-codex-')) {
        workerSpec = spec;
        return {
          async start() {},
          async stop() {},
          async exec({ Cmd }) {
            workerCommand = Cmd;
            return {
              async start() {
                return stream;
              },
            };
          },
          modem: {
            demuxStream(source, stdout) {
              source.pipe(stdout);
            },
          },
        };
      }
      helpers.push(spec);
      return {
        async start() {},
        async wait() {
          if (spec.Cmd[0] === 'npm') {
            await pauseInstall;
            const executable = path.join(
              spec.HostConfig.Mounts[0].Source,
              'node_modules/.bin/codex',
            );
            await fs.mkdir(path.dirname(executable), { recursive: true });
            await fs.writeFile(executable, '');
          }
          return { StatusCode: spec.Cmd[0] === 'node' && failedVerification ? 1 : 0 };
        },
        async logs() {
          return Buffer.from(`codex-cli ${reportedVersion}\n`);
        },
        async remove() {},
      };
    },
  };
  const fetchRegistry = async (url) => {
    registryCalls++;
    assert.equal(url, 'https://registry.npmjs.org/@openai%2fcodex/latest');
    return Response.json({ name: '@openai/codex', version: latest });
  };
  const app = await createApp({
    dataDir: directory,
    hostDataDir: directory,
    inviteCode: 'synthetic-invite',
    codexFactory(config, emit) {
      const manager = new CodexManager(config, emit);
      manager.docker = docker;
      manager.updates = new CodexUpdates(
        config,
        docker,
        () => manager.starting.size === 0,
        fetchRegistry,
      );
      manager.prepareHome = async () => {};
      return manager;
    },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  app.config.publicUrl = origin;
  async function request(url, session, body, csrf = true) {
    const response = await fetch(origin + '/api' + url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(session ? { Cookie: session.cookie } : {}),
        ...(session && csrf ? { 'X-CSRF-Token': session.csrf } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function register(username) {
    const { status, data, headers } = await request('/register', null, {
      username,
      password: 'Synthetic-test-password-42',
      inviteCode: 'synthetic-invite',
    });
    assert.equal(status, 200);
    return { ...data.user, cookie: headers.get('set-cookie').split(';')[0] };
  }
  const statusUrl = '/codex/version';
  const check = (session) => request(statusUrl + '/check', session, {});
  const install = (session, version, csrf) =>
    request(statusUrl + '/install', session, { version }, csrf);
  try {
    const owner = await register('owner');
    const member = await register('member');
    assert.equal((await request(statusUrl)).status, 401);
    assert.equal((await request(statusUrl, member)).data.currentVersion, reportedVersion);
    assert.equal((await request(statusUrl, owner)).data.latestVersion, null);
    assert.equal(helpers.length, 1);
    assert.equal(registryCalls, 0);
    assert.equal((await check(member)).status, 403);
    app.store.run("UPDATE users SET role='admin' WHERE id=?", member.id);
    assert.equal((await check(member)).status, 403);
    assert.equal((await install(member, latest)).status, 403);
    assert.equal((await install(owner, latest, false)).status, 403);
    assert.equal((await install(owner, latest)).status, 409);
    assert.equal((await check(owner)).data.updateAvailable, true);
    assert.equal(registryCalls, 1);
    assert.equal((await install(owner, '0.100.1')).status, 409);
    const held = Promise.withResolvers();
    pauseInstall = held.promise;
    try {
      assert.equal((await install(owner, latest)).status, 202);
      assert.equal((await request(statusUrl, owner)).data.phase, 'installing');
      assert.equal((await request('/health')).data.deploymentReady, false);
      assert.equal((await install(owner, latest)).status, 409);
      assert.equal((await check(owner)).data.phase, 'installing');
      assert.equal(registryCalls, 1);
    } finally {
      held.resolve();
    }
    await app.codex.updates.close();
    const installed = await request(statusUrl, owner);
    assert.equal(installed.data.currentVersion, latest);
    assert.equal(installed.data.phase, 'installed');
    assert.equal((await request('/health')).data.deploymentReady, true);
    const [versionProbe, installer, verifier] = helpers;
    assert.ok(helpers.every((spec) => spec.User === '1000:1000' && spec.HostConfig.ReadonlyRootfs));
    assert.equal(versionProbe.HostConfig.NetworkMode, 'none');
    assert.equal(installer.Cmd.at(-1), '@openai/codex@0.100.0');
    assert.ok(installer.Cmd.includes('--ignore-scripts'));
    assert.equal(installer.HostConfig.Mounts.length, 1);
    assert.equal(installer.HostConfig.Mounts[0].ReadOnly, false);
    assert.equal(verifier.HostConfig.NetworkMode, 'none');
    assert.doesNotThrow(() => new Script(verifier.Cmd[2]));
    assert.deepEqual(verifier.HostConfig.Mounts, [
      { ...installer.HostConfig.Mounts[0], ReadOnly: true },
    ]);

    const restarted = new CodexUpdates(app.config, docker, () => true, fetchRegistry);
    const active = await restarted.runtimePath();
    assert.equal((await restarted.status()).currentVersion, latest);
    assert.equal(registryCalls, 1);
    const existing = { target: 'workspace' };
    app.codex.instances.set(owner.id, existing);
    assert.equal(await app.codex.ensure(owner), existing);
    assert.equal(retiredWorkers, 0);
    app.codex.instances.delete(owner.id);
    await app.codex.ensure(owner);
    assert.equal(retiredWorkers, 1);
    assert.equal(workerCommand[0], `${CODEX_RUNTIME_BIN}/codex`);
    assert.deepEqual(workerSpec.HostConfig.Mounts, [
      { Type: 'bind', Source: active, Target: CODEX_RUNTIME_MOUNT, ReadOnly: true },
    ]);

    latest = '0.101.0-beta.1';
    assert.equal((await check(owner)).status, 502);
    latest = '0.98.0';
    assert.equal((await check(owner)).data.updateAvailable, false);
    assert.equal((await install(owner, latest)).status, 409);
    latest = '0.101.0';
    failedVerification = true;
    assert.equal((await check(owner)).data.updateAvailable, true);
    assert.equal((await install(owner, latest)).status, 202);
    await app.codex.updates.close();
    const failed = (await request(statusUrl, owner)).data;
    assert.equal(failed.phase, 'failed');
    assert.match(failed.error, /启动验证/);
    assert.equal(failed.currentVersion, '0.100.0');
    assert.equal(await restarted.runtimePath(), active);
    assert.equal((await fs.readdir(path.join(directory, 'codex-runtime'))).length, 2);
  } finally {
    await app.close();
    stream.destroy();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
