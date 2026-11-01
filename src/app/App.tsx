import { useEffect, useState } from 'react';
import type { SessionUser, Theme } from '../../shared/contracts/domain.ts';
import {
  AppearanceProvider,
  useAppearance,
} from '../features/appearance/components/Appearance.tsx';
import { BrowserGraphicsProvider } from '../features/appearance/components/BrowserGraphics.tsx';
import Auth from '../features/auth/components/Auth.tsx';
import WorkspaceWelcome from '../features/workspace/components/WorkspaceWelcome.tsx';

import { api, setCsrfToken } from '../lib/api.ts';
import Workspace, { type WorkspaceProps } from './Workspace.tsx';
export default function App() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined),
    [inviteRequired, setInvite] = useState(true),
    [theme, setTheme] = useState<Theme>((localStorage.getItem('theme-v2') || 'light') as Theme);
  useEffect(() => {
    api('/session')
      .then((r) => {
        setUser(r.user);
        setInvite(r.inviteRequired);
      })
      .catch(() => setUser(null));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme-v2', theme);
  }, [theme]);
  setCsrfToken(user?.csrf || '');
  if (user === undefined) return <WorkspaceWelcome />;
  return user ? (
    <AppearanceProvider key={user.id} user={user} fallbackTheme={theme}>
      <ThemedWorkspace user={user} setUser={setUser} setTheme={setTheme} />
    </AppearanceProvider>
  ) : (
    <Auth
      onLogin={setUser}
      inviteRequired={inviteRequired}
      request={api}
      theme={theme}
      setTheme={setTheme}
    />
  );
}
function ThemedWorkspace(props: Omit<WorkspaceProps, 'theme'>) {
  const appearance = useAppearance();
  return (
    <BrowserGraphicsProvider>
      <Workspace {...props} theme={appearance.theme} />
    </BrowserGraphicsProvider>
  );
}
