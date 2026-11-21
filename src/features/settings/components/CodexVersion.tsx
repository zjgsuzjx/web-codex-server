import {
  ArrowDownToLine,
  ArrowRight,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Package,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ApiClient } from '../../../../shared/contracts/api.ts';
import type { AppError } from '../../../../shared/contracts/errors.ts';
import type { CodexUpdateStatus } from '../../../../shared/settings/codex-updates.ts';
import useActionDialog from '../../../components/ui/ActionDialog.tsx';

interface CodexVersionProps {
  api: ApiClient;
  canUpdate: boolean;
}

export default function CodexVersion({ api, canUpdate }: CodexVersionProps) {
  const titleId = useId();
  const dialog = useActionDialog();
  const [status, setStatus] = useState<CodexUpdateStatus>();
  const [error, setError] = useState('');
  const [operation, setOperation] = useState<'read' | 'check' | null>('read');
  const [readAttempt, setReadAttempt] = useState(0);
  const request = useRef(false);
  const installing = status?.phase === 'installing';
  const shouldRead = installing || operation === 'read';
  useEffect(() => {
    if (!shouldRead) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function read() {
      try {
        const result = await api('/codex/version', { signal: abort.signal });
        if (!cancelled) {
          setStatus(result);
          setError('');
        }
      } catch (caughtError) {
        if (!cancelled) setError((caughtError as AppError).message || '暂时无法读取 Codex 版本');
      } finally {
        if (!cancelled) {
          setOperation((current) => (current === 'read' ? null : current));
          if (installing) timer = setTimeout(read, 1800);
        }
      }
    }
    if (installing) timer = setTimeout(read, 1000);
    else void read();
    return () => {
      cancelled = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [api, installing, readAttempt, shouldRead]);

  async function check() {
    if (request.current) return;
    request.current = true;
    setOperation('check');
    setError('');
    try {
      setStatus(await api('/codex/version/check', { method: 'POST' }));
    } catch (caughtError) {
      setError((caughtError as AppError).message || '暂时无法检查更新');
    } finally {
      request.current = false;
      setOperation(null);
    }
  }

  function install(version: string) {
    void dialog.confirm({
      key: 'codex-version-install',
      title: `更新到 v${version}？`,
      description: '新版将供所有工作区使用。已运行的工作区将在下次启动后切换。',
      icon: ArrowDownToLine,
      confirmLabel: '安装更新',
      onConfirm: async () => {
        setStatus(await api('/codex/version/install', { method: 'POST', body: { version } }));
        setError('');
      },
    });
  }

  const nextVersion = canUpdate && status?.updateAvailable ? status.latestVersion : null;
  const messageError = error || (canUpdate ? status?.error : null);
  const statusMessage = installing
    ? '正在安装并验证新版本…'
    : status?.phase === 'installed'
      ? '安装完成。已运行的工作区将在下次启动后切换。'
      : nextVersion
        ? '有新的稳定版本可用'
        : canUpdate && status?.latestVersion
          ? '当前已是最新版本'
          : null;
  const StatusIcon = installing ? LoaderCircle : nextVersion ? ArrowDownToLine : CircleCheck;
  const checking = operation === 'check';

  return (
    <section className="codex-version" aria-labelledby={titleId}>
      <div className="codex-version-header">
        <div className="codex-version-identity">
          <div className="codex-version-icon" aria-hidden="true">
            <Package size={21} />
          </div>
          <div>
            <h4 id={titleId}>Codex CLI</h4>
            <div className="codex-version-numbers">
              <span>工作区默认版本</span>
              {status ? (
                <span className="codex-version-pair">
                  <code>v{status.currentVersion}</code>
                  {nextVersion && (
                    <>
                      <ArrowRight size={13} aria-hidden="true" />
                      <code className="codex-version-next" aria-label={`可用版本 v${nextVersion}`}>
                        v{nextVersion}
                      </code>
                    </>
                  )}
                </span>
              ) : (
                <span>{operation === 'read' ? '读取中…' : '暂不可用'}</span>
              )}
            </div>
          </div>
        </div>
        <div className="codex-version-actions">
          {!status && operation !== 'read' && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setError('');
                setOperation('read');
                setReadAttempt((attempt) => attempt + 1);
              }}
            >
              <RefreshCw size={14} aria-hidden="true" /> 重新读取
            </button>
          )}
          {canUpdate && status && !installing && (
            <button type="button" className="secondary" disabled={checking} onClick={check}>
              {checking ? (
                <LoaderCircle size={14} className="spin" aria-hidden="true" />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
              {checking ? '正在检查…' : '检查更新'}
            </button>
          )}
          {nextVersion && !installing && (
            <button
              type="button"
              className="primary"
              disabled={checking}
              onClick={() => install(nextVersion)}
            >
              <ArrowDownToLine size={14} aria-hidden="true" /> 在线更新
            </button>
          )}
        </div>
      </div>
      {messageError ? (
        <div className="codex-version-status is-error" role="alert">
          <CircleAlert size={15} aria-hidden="true" /> {messageError}
        </div>
      ) : (
        statusMessage &&
        !checking && (
          <div
            className={`codex-version-status${!installing && !nextVersion ? ' is-success' : ''}`}
            role="status"
          >
            <StatusIcon size={15} className={installing ? 'spin' : undefined} aria-hidden="true" />{' '}
            {statusMessage}
          </div>
        )
      )}
      {dialog.element}
    </section>
  );
}
