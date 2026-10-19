// null means no application-level entry-count cap. Byte quotas are independent.
export const USER_FILE_ENTRY_LIMIT = 100_000;
export function fileEntryLimit(user) { return user?.role === 'superadmin' ? null : USER_FILE_ENTRY_LIMIT; }
export function fileEntryLimitMessage(limit) { return `文件或文件夹数量超过上限（${limit.toLocaleString('en-US')} 项）`; }
