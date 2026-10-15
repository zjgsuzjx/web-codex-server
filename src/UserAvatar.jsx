import { useState } from 'react';

export default function UserAvatar({ user, className = '' }) {
  const [failed, setFailed] = useState(null), url = user?.avatarUrl;
  return <span className={`avatar user-avatar ${className}`} aria-hidden="true">
    {url && failed !== url ? <img src={url} alt="" draggable="false" onError={() => setFailed(url)}/> : (user?.username?.[0] || 'S').toUpperCase()}
  </span>;
}
