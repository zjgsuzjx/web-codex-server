import type { StructuredPatch } from 'diff';
import type { Attachment, Question, TurnTiming } from './domain.ts';

/**
 * CLI/tool payloads are extensible across provider versions. Unknown provider
 * fields remain at this explicit interop boundary; application-owned records
 * belong in domain.ts. These types do not replace runtime validation or auth.
 */
export type ProtocolRecord = Record<string, any>;
export type ProtocolCallback = (...args: any[]) => any;

export interface ContentBlock extends ProtocolRecord {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  imageUrl?: string;
  image_url?: string;
  url?: string;
}

export interface ChatItem extends ProtocolRecord {
  id: string;
  type: string;
  text?: string;
  status?: string;
  content?: ContentBlock[];
  summary?: (ContentBlock | string)[];
  attachments?: Attachment[];
  contentItems?: ContentBlock[];
  streamedSummaryParts?: string[];
  streamedContentParts?: string[];
}

export interface FileChange {
  path: string;
  kind: string;
  added: number | null;
  removed: number | null;
  reason?: string;
  patches?: StructuredPatch[];
  previousPath?: string;
  previewWarning?: string;
}

export interface ChangeSummary {
  revision: number;
  status: string;
  source: string;
  warning?: string;
  added: number;
  removed: number;
  unknown: number;
  files: FileChange[];
}

export interface Turn extends ProtocolRecord {
  id: string;
  status?: string;
  items?: ChatItem[];
  timing?: TurnTiming;
  changes?: ChangeSummary;
}

export interface CodexEvent {
  method: string;
  params: ProtocolRecord;
  id?: string | number;
}

export interface ServerRequest extends CodexEvent {
  deadline?: number | null;
  expiresAt?: number | null;
  id: string | number;
  params: ProtocolRecord & { threadId?: string; turnId?: string; questions?: Question[] };
}

export interface RateWindow {
  usedPercent?: number;
  windowDurationMins?: number;
  resetsAt?: number;
}

export interface RateBucket extends ProtocolRecord {
  limitId?: string;
  primary?: RateWindow;
  secondary?: RateWindow;
}

export interface QuotaSnapshot {
  rateLimits?: RateBucket;
  rateLimitsByLimitId?: Record<string, RateBucket>;
}
