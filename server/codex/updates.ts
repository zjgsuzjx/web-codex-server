import type Docker from 'dockerode';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppError } from '../../shared/contracts/errors.ts';
import type { CodexUpdateStatus } from '../../shared/settings/codex-updates.ts';
import { fail } from '../files/files.ts';
import type { ServerConfig } from '../types.ts';

export const CODEX_RUNTIME_MOUNT = '/opt/starvalley-codex';
export const CODEX_RUNTIME_BIN = `${CODEX_RUNTIME_MOUNT}/node_modules/.bin`;
export const CODEX_APP_SERVER_ARGS = [
  'app-server',
  '-c',
  'features.default_mode_request_user_input=true',
];

const packageName = '@openai/codex';
const registry = 'https://registry.npmjs.org';
const latestUrl = `${registry}/@openai%2fcodex/latest`;
const versionPattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const installationPattern = /^install-[0-9a-f-]{36}$/;
const relativeBin = 'node_modules/.bin/codex';
const isVersion = (value: unknown): value is string =>
  typeof value === 'string' && versionPattern.test(value);

function newer(version: string, current: string) {
  const parts = current.split('.').map(Number);
  for (const [index, value] of version.split('.').map(Number).entries())
    if (value !== parts[index]) return value > parts[index]!;
  return false;
}

interface Installation {
  directory: string;
  version: string;
}

// Run the same stdio startup as the gateway against an empty Codex home.
const verifyAppServer = `
const { spawn, spawnSync } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { createInterface } = require('node:readline');
const [cli, version, ...args] = process.argv.slice(1);
mkdirSync(process.env.CODEX_HOME, { recursive: true });
const reported = spawnSync(cli, ['--version'], { encoding: 'utf8', timeout: 5000 });
if (reported.status !== 0 || reported.stdout.trim() !== 'codex-cli ' + version) process.exit(1);
const child = spawn(cli, args, { stdio: ['pipe', 'pipe', 'ignore'] });
const send = (message) => child.stdin.write(JSON.stringify(message) + '\\n');
const finish = (status) => {
  child.kill('SIGKILL');
  process.exit(status);
};
child.on('error', () => finish(1));
child.on('exit', () => finish(1));
child.stdin.on('error', () => finish(1));
createInterface({ input: child.stdout }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id === 1) {
    if (msg.error || !msg.result) return finish(1);
    send({ method: 'initialized', params: {} });
    send({ id: 2, method: 'thread/list', params: { limit: 1 } });
  }
  if (msg.id === 2) finish(Array.isArray(msg.result?.data) && !msg.error ? 0 : 1);
});
send({
  id: 1,
  method: 'initialize',
  params: {
    clientInfo: { name: 'starvalley_web', version: '1.0.0' },
    capabilities: { experimentalApi: true }
  }
});
`;

export class CodexUpdates {
  private config: ServerConfig;
  private docker: Docker;
  private canPrune: () => boolean;
  private fetchRegistry: typeof fetch;
  private base?: { imageId: string; version: Promise<string> };
  private checking?: Promise<CodexUpdateStatus>;
  private job?: Promise<void>;
  private latestVersion: string | null = null;
  private phase: CodexUpdateStatus['phase'] = 'idle';
  private error: string | null = null;

  constructor(
    config: ServerConfig,
    docker: Docker,
    canPrune: () => boolean,
    fetchRegistry = fetch,
  ) {
    this.config = config;
    this.docker = docker;
    this.canPrune = canPrune;
    this.fetchRegistry = fetchRegistry;
  }

  private get root() {
    return path.join(this.config.dataDir, 'codex-runtime');
  }

  private get hostRoot() {
    return path.posix.join(this.config.hostDataDir.replaceAll('\\', '/'), 'codex-runtime');
  }

  get installing() {
    return !!this.job;
  }

  async close() {
    await this.job;
  }

  private async readInstallation(): Promise<Installation | undefined> {
    try {
      const record = JSON.parse(await fs.readFile(path.join(this.root, 'current.json'), 'utf8'));
      if (
        !record ||
        !isVersion(record.version) ||
        typeof record.directory !== 'string' ||
        !installationPattern.test(record.directory)
      )
        return;
      await fs.access(path.join(this.root, record.directory, relativeBin));
      return { directory: record.directory, version: record.version };
    } catch (caughtError) {
      if ((caughtError as AppError).code !== 'ENOENT' && !(caughtError instanceof SyntaxError))
        throw caughtError;
    }
  }

  async runtimePath() {
    const installation = await this.readInstallation();
    return installation && path.posix.join(this.hostRoot, installation.directory);
  }

  async status(): Promise<CodexUpdateStatus> {
    const { phase, latestVersion, error } = this;
    const currentVersion = (await this.readInstallation())?.version ?? (await this.baseVersion());
    return {
      currentVersion,
      latestVersion,
      updateAvailable: !!latestVersion && newer(latestVersion, currentVersion),
      phase,
      error,
    };
  }

  check() {
    if (this.job) return this.status();
    this.checking ??= this.checkLatest().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private async checkLatest() {
    const { currentVersion } = await this.status();
    let version: string;
    try {
      const response = await this.fetchRegistry(latestUrl, {
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Registry request failed');
      const metadata = await response.json();
      if (metadata?.name !== packageName || !isVersion(metadata.version))
        throw new Error('Invalid release metadata');
      version = metadata.version;
    } catch {
      fail(502, '无法检查 Codex 更新，请稍后重试');
    }
    this.latestVersion = version;
    this.phase = 'idle';
    this.error = null;
    return {
      currentVersion,
      latestVersion: version,
      updateAvailable: newer(version, currentVersion),
      phase: this.phase,
      error: this.error,
    } satisfies CodexUpdateStatus;
  }

  async install(version: unknown) {
    const status = await this.status();
    if (this.job) fail(409, 'Codex 正在更新，请等待安装完成');
    if (this.checking) fail(409, '正在检查 Codex 更新，请稍后重试');
    if (
      !isVersion(version) ||
      this.latestVersion !== version ||
      !newer(version, status.currentVersion)
    )
      fail(409, '版本已变化，请重新检查更新');

    this.phase = 'installing';
    this.error = null;
    this.job = this.installRelease(version)
      .then(() => {
        this.phase = 'installed';
      })
      .catch((caughtError) => {
        this.phase = 'failed';
        const error = caughtError as AppError;
        this.error = error.status ? error.message : '安装失败，工作区继续使用原版本。';
        if (!error.status) console.error('Codex update failed:', error.code || error.name);
      })
      .finally(() => {
        this.job = undefined;
      });
    return {
      ...status,
      latestVersion: version,
      updateAvailable: true,
      phase: this.phase,
      error: null,
    };
  }

  private async baseVersion() {
    try {
      const { Id } = await this.docker.getImage(this.config.workerImage).inspect();
      if (this.base?.imageId !== Id) {
        this.base = {
          imageId: Id,
          version: this.run(Id, ['codex', '--version'], 10, { readOutput: true })
            .then((output) => {
              const version = output.match(/^codex-cli (.+)$/m)?.[1];
              if (!isVersion(version)) throw new Error('Invalid Codex CLI version');
              return version;
            })
            .catch((error) => {
              if (this.base?.imageId === Id) this.base = undefined;
              throw error;
            }),
        };
      }
      return await this.base.version;
    } catch {
      fail(503, '无法读取工作区 Codex 版本，请确认 worker 镜像可用');
    }
  }

  private async installRelease(version: string) {
    const directory = `install-${randomUUID()}`;
    const localPath = path.join(this.root, directory);
    const hostPath = path.posix.join(this.hostRoot, directory);
    const cache = '.npm-cache';
    const temp = path.join(this.root, `${directory}.json`);
    const { Id } = await this.docker.getImage(this.config.workerImage).inspect();
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.mkdir(localPath, { mode: 0o755 });
    let published = false;
    try {
      try {
        await this.run(
          Id,
          [
            'npm',
            'install',
            '--prefix',
            CODEX_RUNTIME_MOUNT,
            '--registry',
            registry,
            `--cache=${CODEX_RUNTIME_MOUNT}/${cache}`,
            '--fetch-retries=1',
            '--fetch-timeout=30000',
            '--ignore-scripts',
            '--include=optional',
            '--no-save',
            '--no-package-lock',
            '--no-audit',
            '--no-fund',
            `${packageName}@${version}`,
          ],
          150,
          { source: hostPath, writable: true },
        );
        // Native archives can exceed the helper's tmpfs. Discard the staging cache before verification.
        await fs.rm(path.join(localPath, cache), { recursive: true, force: true });
      } catch {
        fail(502, '无法下载或安装新版本，请检查服务器网络及存储空间后重试。');
      }
      try {
        await this.run(
          Id,
          [
            'node',
            '-e',
            verifyAppServer,
            `${CODEX_RUNTIME_BIN}/codex`,
            version,
            ...CODEX_APP_SERVER_ARGS,
          ],
          20,
          { source: hostPath },
        );
      } catch {
        fail(502, '新版本未通过工作区启动验证，当前版本保持可用。');
      }
      await fs.writeFile(temp, JSON.stringify({ directory, version }), { flag: 'wx', mode: 0o600 });
      await fs.rename(temp, path.join(this.root, 'current.json'));
      published = true;
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {});
      if (!published) await fs.rm(localPath, { recursive: true, force: true }).catch(() => {});
    }
    await this.prune(directory).catch(() => {});
  }

  private async prune(current: string) {
    // A start already in progress can still be attaching a prior installation.
    if (!this.canPrune()) return;
    const containers = await this.docker.listContainers({
      all: true,
      abortSignal: AbortSignal.timeout(5000),
    });
    const mounted = new Set(
      containers.flatMap((container) => container.Mounts.map((m) => m.Source)),
    );
    for (const dir of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!dir.isDirectory() || !installationPattern.test(dir.name) || dir.name === current)
        continue;
      if (!mounted.has(path.posix.join(this.hostRoot, dir.name)))
        await fs.rm(path.join(this.root, dir.name), { recursive: true, force: true });
    }
  }

  private async run(
    image: string,
    command: string[],
    seconds: number,
    {
      source,
      writable = false,
      readOutput = false,
    }: {
      source?: string;
      writable?: boolean;
      readOutput?: boolean;
    },
  ) {
    const timeout = AbortSignal.timeout((seconds + 12) * 1000);
    const container = await this.docker.createContainer({
      Image: image,
      Entrypoint: ['/usr/bin/timeout', '--kill-after=3s', `${seconds}s`],
      Cmd: command,
      User: '1000:1000',
      Env: ['HOME=/tmp', 'CODEX_HOME=/tmp/codex', 'NPM_CONFIG_USERCONFIG=/dev/null'],
      WorkingDir: '/tmp',
      Tty: readOutput,
      Healthcheck: { Test: ['NONE'] },
      HostConfig: {
        NetworkMode: writable ? 'bridge' : 'none',
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        PidsLimit: 64,
        Memory: 384 * 1024 * 1024,
        MemorySwap: 384 * 1024 * 1024,
        NanoCpus: 500000000,
        Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=128m,mode=1777' },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '64k', 'max-file': '1' } },
        Mounts: source
          ? [{ Type: 'bind', Source: source, Target: CODEX_RUNTIME_MOUNT, ReadOnly: !writable }]
          : [],
      },
      abortSignal: timeout,
    });
    try {
      await container.start({ abortSignal: timeout });
      const result = await container.wait({ abortSignal: timeout });
      if (result.StatusCode !== 0) throw new Error('Codex helper failed');
      if (!readOutput) return '';
      const output = await container.logs({ stdout: true, tail: 3, abortSignal: timeout });
      return output.toString();
    } finally {
      await container.remove({ force: true, v: true }).catch((error: AppError) => {
        if (error.statusCode !== 404) throw error;
      });
    }
  }
}
