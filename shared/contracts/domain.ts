/** The finite application-owned values shared by browser and gateway. */
export type Role = 'user' | 'admin' | 'superadmin';
export type Theme = 'light' | 'dark';
export type Device = 'desktop' | 'mobile';
export type ExecutionTarget = 'workspace' | 'server';
export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'expired';
export type TabCloseMode = 'single' | 'others' | 'right' | 'all' | 'saved';

export interface Settings {
  model: string;
  effort: string;
  approvalPolicy: 'untrusted' | 'on-request' | 'never';
  sandbox: 'readOnly' | 'workspaceWrite' | 'dangerFullAccess';
  networkAccess: boolean;
  mode: 'default' | 'plan';
  executionTarget: ExecutionTarget;
}

export interface Project {
  id: string;
  name: string;
  user_id?: string;
  created?: number;
}

export interface FileEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  created?: number | null;
  modified?: number | null;
  lazy?: boolean;
  source?: string;
}

export interface EditorTab {
  path: string;
  kind?: 'text' | 'image';
  content?: string;
  original?: string;
  etag?: string;
  size?: number;
  mime?: string;
  imageUrl?: string;
  url?: string;
  modified?: number;
}

export interface UploadFile extends File {
  uploadPath?: string;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  url?: string;
  previewUrl?: string;
  thread_id?: string;
  user_id?: string;
  turn_id?: string | null;
  message_text?: string | null;
}

export interface TurnTiming {
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface Question {
  id: string;
  header?: string;
  question: string;
  options?: { label: string; description?: string }[];
  isSecret?: boolean;
  isOther?: boolean;
}

export interface AnswerDraft {
  custom?: boolean;
  text?: string;
  option?: string;
}

export type AnswerDrafts = Record<string, AnswerDraft>;

export interface SkinConfig {
  name: string;
  description: string;
  mode: Theme;
  palette: { background: string; surface: string; accent: string };
  wallpaper: { fit: 'cover' | 'contain'; x: number; y: number; shade: number };
}

export interface SkinPreset {
  id: string;
  device: Device;
  imageUrl: string;
  config: SkinConfig;
  created?: number;
}

export interface SkinSnapshot {
  presets: SkinPreset[];
  active: Partial<Record<Device, string>>;
  jobs: import('./protocol.ts').ProtocolRecord[];
}

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
  csrf: string;
  settings: Settings;
  avatarUrl?: string | null;
  skins?: SkinSnapshot;
  hostProjectBase?: string;
  nestedSandbox?: boolean;
  hostExecution?: boolean;
}

export interface StoredUser {
  id: string;
  username: string;
  password: string;
  role: Role;
  settings: string;
  created?: number;
  csrf?: string;
  session_hash?: string;
  expires?: number;
}

export interface Thread {
  id: string;
  project_id: string;
  title: string;
  user_id?: string;
  created?: number;
  activeTurn?: import('./protocol.ts').Turn | null;
  tokenUsage?: TokenUsage | null;
}

export interface TokenUsage {
  last?: { totalTokens?: number };
  total?: { totalTokens?: number };
  modelContextWindow?: number;
}

export interface DraftAttachment extends Omit<Attachment, 'mime'> {
  file: UploadFile;
  mime?: string;
  saved?: Attachment;
}
