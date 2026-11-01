import type { AppError } from '../../shared/contracts/errors.ts';
import type { ApiClient, ApiOptions } from '../../shared/contracts/api.ts';
let csrfToken = '';
export const setCsrfToken = (token: string) => {
  csrfToken = token;
};
export const getCsrfToken = () => csrfToken;
export const api: ApiClient = async (url: string, options: ApiOptions = {}) => {
  const res = await fetch(`/api${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, ...options.headers },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.code === 'STORAGE_FULL' || res.status === 507 || /存储配额不足/.test(data.error || ''))
      window.dispatchEvent(new Event('storage:full'));
    const e: AppError = new Error(data.error || '请求失败');
    e.status = res.status;
    throw e;
  }
  return data;
};
