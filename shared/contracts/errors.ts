/** Errors arriving from Node, HTTP or RPC retain their original runtime shape. */
export interface AppError extends Error {
  code?: string;
  status?: number;
  statusCode?: number;
  conflictCount?: number;
  conflicts?: { path: string }[];
  editDraft?: { text: string; attachments: import('./domain.ts').Attachment[] };
}
