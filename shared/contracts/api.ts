import type { SessionUser, Settings } from './domain.ts';
import type { ProtocolRecord } from './protocol.ts';

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

export interface ApiResponseMap {
  '/session': { user: SessionUser | null; inviteRequired: boolean };
  '/settings': Settings;
}

/** Legacy/provider endpoints can be narrowed at each call using api<T>(). */
export interface ApiClient {
  <K extends keyof ApiResponseMap>(url: K, options?: ApiOptions): Promise<ApiResponseMap[K]>;
  <T = ProtocolRecord>(url: string, options?: ApiOptions): Promise<T>;
}
