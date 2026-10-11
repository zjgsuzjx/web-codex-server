import path from 'node:path';
import { fail } from './files.js';

export const ROLES = ['user', 'admin', 'superadmin'];
export const isAdministrator = user => ['admin', 'superadmin'].includes(user?.role);
export function executionTarget(user) {
  const target = JSON.parse(user.settings || '{}').executionTarget || 'workspace';
  if (!['workspace', 'server'].includes(target)) fail(400, '执行环境无效');
  if (target === 'server' && user.role !== 'superadmin') fail(403, '只有超级管理员可以操作服务器');
  return target;
}
export function projectCwd(config, user, projectId) {
  return executionTarget(user) === 'server'
    ? path.posix.join(config.hostDataDir.replaceAll('\\', '/'), 'users', user.username, 'projects', projectId)
    : `/workspace/${projectId}`;
}
export function hostCommand(config, user, command, cwd = '/') {
  if (executionTarget(user) !== 'server') fail(403, '需要超级管理员服务器模式');
  const home = path.posix.join(config.hostDataDir.replaceAll('\\', '/'), 'users', user.username);
  return ['nsenter', '--target=1', '--mount', '--uts', '--ipc', '--net', '--pid', '--root', `--wd=/proc/1/root${cwd}`, '--',
    '/usr/bin/env', `HOME=${home}`, `CODEX_HOME=${home}/codex`, `PATH=${config.hostCodexBin || '/usr/local/bin'}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`, ...command];
}
export function workerSpec(config, user) {
  const target = executionTarget(user), hostDir = path.join(config.hostDataDir, 'users', user.username).replaceAll('\\', '/');
  const shared = { name: `sv-codex-${user.id}`, Image: config.workerImage, Cmd: ['sleep', 'infinity'],
    Labels: { 'starvalley.owner': user.id, 'starvalley.managed': 'true', 'starvalley.execution': target } };
  if (target === 'server') {
    if (!config.enableHostExecution || !config.hostCodexScript?.startsWith('/')) fail(503, '服务器操作通道尚未配置');
    if (JSON.parse(user.settings || '{}').networkAccess === false) fail(400, '服务器模式需要启用网络；网络隔离请使用用户工作区');
    // This deliberately grants host root ONLY after server-side superadmin checks.
    // The gateway and ordinary workers never receive these settings or mounts.
    return { ...shared, User: '0:0', WorkingDir: '/', HostConfig: { Privileged: true, PidMode: 'host', NetworkMode: 'host',
      ReadonlyRootfs: true, PidsLimit: 128, Memory: config.workerMemory * 1024 * 1024, NanoCpus: 750000000, RestartPolicy: { Name: 'no' } } };
  }
  return { ...shared, User: '1000:1000', WorkingDir: '/workspace', Env: ['HOME=/home/node', 'CODEX_HOME=/home/node/.codex'],
    HostConfig: { NetworkMode: JSON.parse(user.settings || '{}').networkAccess === false ? 'none' : 'bridge',
      Binds: [`${hostDir}/projects:/workspace`, `${hostDir}/codex:/home/node/.codex`], ReadonlyRootfs: true, CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'], PidsLimit: 128, Memory: config.workerMemory * 1024 * 1024,
      MemorySwap: config.workerMemory * 2 * 1024 * 1024, NanoCpus: 750000000,
      Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=128m', '/home/node/.cache': 'rw,nosuid,nodev,uid=1000,gid=1000,size=32m' }, RestartPolicy: { Name: 'no' } } };
}
