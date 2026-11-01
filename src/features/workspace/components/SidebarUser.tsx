import { Settings as SettingsIcon } from 'lucide-react';
import type { SessionUser } from '../../../../shared/contracts/domain.ts';
import type { ProtocolCallback } from '../../../../shared/contracts/protocol.ts';
import IconButton from '../../../components/ui/IconButton.tsx';
import UserAvatar from '../../appearance/components/UserAvatar.tsx';
import { roleName } from '../../settings/components/UserManagement.tsx';
import { connectionIndicator } from '../lib/connection-state.ts';
export interface SidebarUserProps {
  user: SessionUser;
  status: import('../../../../shared/contracts/domain.ts').ConnectionStatus;
  disabled?: boolean;
  onOpenProfile: ProtocolCallback;
  onOpenSettings: ProtocolCallback;
}

export default function SidebarUser({
  user,
  status,
  disabled,
  onOpenProfile,
  onOpenSettings,
}: SidebarUserProps) {
  const role = roleName(user.role),
    connection = connectionIndicator(status, undefined);
  return (
    <div className="sidebar-user-wrap">
      <div className="sidebar-user">
        <button
          type="button"
          className="sidebar-user__profile"
          disabled={disabled}
          onClick={onOpenProfile}
          aria-label={`${user.username}，${role}，${connection.announcement}。打开个人账号`}
          aria-haspopup="dialog"
        >
          <span className="sidebar-user__avatar">
            <UserAvatar user={user} />
            <span
              className="sidebar-user__status"
              data-status={status}
              title={connection.announcement}
              aria-hidden="true"
            />
          </span>
          <span className="sidebar-user__info">
            <span className="sidebar-user__name" title={user.username}>
              {user.username}
            </span>
            <span className="sidebar-user__role" data-role={user.role}>
              {role}
            </span>
          </span>
        </button>
        <IconButton
          title="设置"
          className="sidebar-user__gear"
          disabled={disabled}
          aria-haspopup="dialog"
          onClick={onOpenSettings}
        >
          <SettingsIcon size={18} strokeWidth={1.75} />
        </IconButton>
      </div>
    </div>
  );
}
