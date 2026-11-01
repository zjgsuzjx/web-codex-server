import type WebSocket from 'ws';
import type { StoredUser } from '../shared/contracts/domain.ts';
import type { ProtocolCallback, ProtocolRecord } from '../shared/contracts/protocol.ts';

export interface ServerConfig {
  dataDir: string;
  hostDataDir: string;
  publicUrl: string;
  secure: boolean;
  inviteCode: string;
  workerImage: string;
  workerMemory: number;
  maxWorkers: number;
  enableHostExecution: boolean;
  hostCodexScript: string;
  hostCodexBin: string;
  nestedSandbox: boolean;
  maxUsers: number;
  maxFile: number;
  changingUsers: Set<string>;
  templateDir?: string;
  quota?: number;
  dockerSocket?: string;
  codexFactory?: ProtocolCallback;
  resolveUser?: (id: string) => StoredUser | undefined;
}

export type AppOptions = Partial<ServerConfig>;

export interface ClientSocket extends WebSocket {
  user: StoredUser;
  device: 'desktop' | 'mobile';
  sessionHash: string;
  alive: boolean;
  terminal?: ProtocolRecord | null;
  activeUpload?: ProtocolRecord | null;
}

declare global {
  namespace Express {
    interface Request {
      user: StoredUser;
    }
  }
}
