import type { ApiClient } from '../../shared/contracts/api.ts';
import type { FileEntry, Role, Settings } from '../../shared/contracts/domain.ts';
import type { ServerRequest } from '../../shared/contracts/protocol.ts';

declare const api: ApiClient;
const session = await api('/session');
const role: Role | undefined = session.user?.role;
const settings: Settings = await api('/settings');
void role;
void settings;

// @ts-expect-error Roles are owned by the application, never arbitrary strings.
const invalidRole: Role = 'owner';
// @ts-expect-error An execution target must be an explicitly supported backend.
const invalidTarget: Settings['executionTarget'] = 'host';
// @ts-expect-error A file-tree record must preserve its path identity.
const missingPath: FileEntry = { name: 'file.txt', type: 'file' };
// @ts-expect-error Server requests require a method and parameters, not only an ID.
const invalidRequest: ServerRequest = { id: 'request' };
// @ts-expect-error The typed session endpoint cannot be treated as a file list.
const files: FileEntry[] = await api('/session');
void [invalidRole, invalidTarget, missingPath, invalidRequest, files];
