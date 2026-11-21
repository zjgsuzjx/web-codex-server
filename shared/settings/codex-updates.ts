export interface CodexUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  phase: 'idle' | 'installing' | 'installed' | 'failed';
  error: string | null;
}
