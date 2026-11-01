import { useState } from 'react';
import type { SessionUser } from '../../../../shared/contracts/domain.ts';
import type { ProtocolRecord } from '../../../../shared/contracts/protocol.ts';
export interface UserAvatarProps {
  user: SessionUser;
  className?: string;
}

export default function UserAvatar({ user, className = '' }: UserAvatarProps) {
  const [failed, setFailed] = useState<string | null>(null),
    url = user?.avatarUrl;
  return (
    <span className={`avatar user-avatar ${className}`} aria-hidden="true">
      {url && failed !== url ? (
        <img src={url} alt="" draggable="false" onError={() => setFailed(url)} />
      ) : (
        (user?.username?.[0] || 'S').toUpperCase()
      )}
    </span>
  );
}
