import type * as React from 'react';
import { useEffect, useState } from 'react';
import type { ApiClient } from '../../../../shared/contracts/api.ts';
import type { SessionUser } from '../../../../shared/contracts/domain.ts';
import type { AppError } from '../../../../shared/contracts/errors.ts';
import type { ProtocolRecord } from '../../../../shared/contracts/protocol.ts';
import LoadingPlaceholder from '../../../components/ui/LoadingPlaceholder.tsx';
import Select from '../../../components/ui/Select.tsx';
export interface UserManagementProps {
  api: ApiClient;
  user: SessionUser;
  notify: (message: string, error?: boolean) => void;
}
export const roleName = (role: string) =>
  ({ superadmin: '超级管理员', admin: '管理员', user: '成员' })[role] || role;
export default function UserManagement({ api, user, notify }: UserManagementProps) {
  const [users, setUsers] = useState<ProtocolRecord | null | undefined>(null),
    [busy, setBusy] = useState<ProtocolRecord | null | undefined>(null),
    [error, setError] = useState(false);
  const load = () => api('/admin/users').then(setUsers);
  useEffect(() => {
    load().catch((e) => {
      setError(true);
      notify(e.message, true);
    });
  }, []);
  async function change(
    target: { id: React.SetStateAction<ProtocolRecord | null | undefined> },
    role: any,
  ) {
    setBusy(target.id);
    try {
      await api(`/admin/users/${target.id}/role`, { method: 'PATCH', body: { role } });
      await load();
      notify('角色已更新，该用户需要重新登录');
    } catch (caughtError) {
      const e = caughtError as AppError;
      notify(e.message, true);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="user-management">
      <h3>账号角色</h3>
      <p className="field-hint">
        超级管理员可以选择服务器模式，以 root 权限操作服务器。管理员和成员的 Codex
        只在自己的独立工作区运行。
      </p>
      {users ? (
        users.map((target: any) => (
          <div className="managed-user" key={target.id}>
            <div>
              <strong>
                {target.username}
                {target.id === user.id ? '（我）' : ''}
              </strong>
              <small>{roleName(target.role)}</small>
            </div>
            {user.role === 'superadmin' ? (
              <Select
                aria-label={`${target.username} 的角色`}
                value={target.role}
                disabled={!!busy}
                onChange={(e) => change(target, (e.target as HTMLInputElement).value)}
              >
                <option value="user">成员</option>
                <option value="admin">管理员</option>
                <option value="superadmin">超级管理员</option>
              </Select>
            ) : (
              <span>{roleName(target.role)}</span>
            )}
          </div>
        ))
      ) : error ? (
        <p className="form-error" role="alert">
          账号列表读取失败，请重新打开设置重试。
        </p>
      ) : (
        <LoadingPlaceholder label="正在读取账号…" variant="list" rows={4} />
      )}
    </div>
  );
}
