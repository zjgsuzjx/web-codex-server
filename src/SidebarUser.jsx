import { Settings } from 'lucide-react';
import IconButton from './IconButton';
import UserAvatar from './UserAvatar';
import { roleName } from './UserManagement';
import { connectionIndicator } from './connection-state';

export default function SidebarUser({ user, status, disabled, onOpenProfile, onOpenSettings }) {
  const role = roleName(user.role), connection = connectionIndicator(status);
  return <div className="sidebar-user-wrap">
    <div className="sidebar-user">
      <button type="button" className="sidebar-user__profile" disabled={disabled} onClick={onOpenProfile}
        aria-label={`${user.username}，${role}，${connection.announcement}。打开个人账号`} aria-haspopup="dialog">
        <span className="sidebar-user__avatar">
          <UserAvatar user={user}/>
          <span className="sidebar-user__status" data-status={status} title={connection.announcement} aria-hidden="true"/>
        </span>
        <span className="sidebar-user__info">
          <span className="sidebar-user__name" title={user.username}>{user.username}</span>
          <span className="sidebar-user__role" data-role={user.role}>{role}</span>
        </span>
      </button>
      <IconButton title="设置" className="sidebar-user__gear" disabled={disabled} aria-haspopup="dialog" onClick={onOpenSettings}>
        <Settings size={18} strokeWidth={1.75}/>
      </IconButton>
    </div>
  </div>;
}
