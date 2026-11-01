import { AlertTriangle, Check, LoaderCircle, Pencil, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { AppError } from '../../../shared/contracts/errors.ts';
import type { ProtocolCallback, ProtocolRecord } from '../../../shared/contracts/protocol.ts';
import Modal, { DIALOG_CLOSE_MS } from './Modal.tsx';
export interface ActionDialogProps {
  request: ProtocolRecord;
  onFinish: ProtocolCallback;
}

// A single queue keeps confirmations independent; cancellation never approves a
// queued action. Duplicate activations of the same action are ignored.
export default function useActionDialog() {
  const [request, setRequest] = useState<ProtocolRecord | null | undefined>(null),
    queue = useRef<ProtocolRecord[]>([]),
    nextId = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const item of queue.current) item.resolve(null);
      queue.current = [];
    };
  }, []);
  const open = useCallback(
    (options: any) =>
      new Promise((resolve) => {
        if (
          !mounted.current ||
          (options.key && queue.current.some((item) => item.key === options.key))
        ) {
          resolve(null);
          return;
        }
        const item = {
          ...options,
          returnFocus: document.activeElement,
          id: ++nextId.current,
          resolve,
        };
        queue.current.push(item);
        if (queue.current.length === 1) setRequest(item);
      }),
    [],
  );
  const finish = useCallback((id: any, value: any) => {
    if (queue.current[0]?.id !== id) return;
    queue.current.shift()!.resolve(value);
    if (mounted.current) setRequest(queue.current[0] || null);
  }, []);
  const input = useCallback((options: any) => open({ ...options, kind: 'input' }), [open]);
  const confirm = useCallback((options: any) => open({ ...options, kind: 'confirm' }), [open]);
  return {
    input,
    confirm,
    open: !!request,
    element: request && <ActionDialog key={request.id} request={request} onFinish={finish} />,
  };
}

function ActionDialog({ request, onFinish }: ActionDialogProps) {
  const {
    kind,
    title,
    description,
    detail,
    label,
    hint,
    placeholder,
    maxLength = 1000,
    initialValue = '',
    confirmLabel = '确认',
    cancelLabel = '取消',
    danger = false,
  } = request;
  const [value, setValue] = useState(initialValue),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [closing, setClosing] = useState(false);
  const input = useRef<HTMLInputElement>(undefined!),
    cancel = useRef<HTMLButtonElement>(undefined!),
    pending = useRef(false),
    alive = useRef(true),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined!),
    uid = useId();
  const Icon = request.icon || (kind === 'input' ? Pencil : danger ? AlertTriangle : ShieldCheck);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  function finish(result: null) {
    pending.current = true;
    setClosing(true);
    timer.current = setTimeout(
      () => onFinish(request.id, result),
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : DIALOG_CLOSE_MS,
    );
  }
  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (pending.current) return;
    const result = kind === 'input' ? value.trim() : true;
    if (kind === 'input' && !result) {
      setError(`请输入${label || '内容'}`);
      input.current.focus({ preventScroll: true });
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await request.onConfirm?.(result);
      if (alive.current) finish(result);
    } catch (caughtError) {
      const e = caughtError as AppError;
      if (alive.current) {
        setError(e.message || '操作失败，请重试');
        pending.current = false;
        setBusy(false);
        requestAnimationFrame(() =>
          (kind === 'input' ? input.current : cancel.current)?.focus({ preventScroll: true }),
        );
      }
    }
  }
  return (
    <Modal
      title={title}
      subtitle={description}
      icon={Icon}
      className={`action-dialog ${danger ? 'action-danger' : ''}`}
      role={kind === 'input' ? 'dialog' : 'alertdialog'}
      initialFocus={kind === 'input' ? input : cancel}
      selectInitialFocus={kind === 'input'}
      returnFocus={request.returnFocus}
      dismissible={!busy && !closing}
      exiting={closing}
      onRequestClose={() => {
        pending.current = true;
        setClosing(true);
      }}
      onClose={() => onFinish(request.id, null)}
    >
      <form className="action-form" onSubmit={submit} noValidate aria-busy={busy}>
        {detail && <div className="action-detail">{detail}</div>}
        {kind === 'input' && (
          <>
            <label htmlFor={uid}>
              {label}
              <input
                ref={input}
                id={uid}
                value={value}
                maxLength={maxLength}
                placeholder={placeholder}
                disabled={busy || closing}
                aria-invalid={!!error}
                aria-describedby={`${uid}-hint${error ? ` ${uid}-error` : ''}`}
                onChange={(e) => {
                  setValue((e.target as HTMLInputElement).value);
                  setError('');
                }}
              />
            </label>
            <div className="action-input-hint" id={`${uid}-hint`}>
              <span>{hint || '输入完成后，按 Enter 确认。'}</span>
              {maxLength <= 200 && (
                <span>
                  {value.length}/{maxLength}
                </span>
              )}
            </div>
          </>
        )}
        {error && (
          <p id={`${uid}-error`} className="action-error" role="alert">
            <AlertTriangle size={15} />
            <span>{error}</span>
          </p>
        )}
        <div className="action-footer">
          <button
            ref={cancel}
            type="button"
            className="secondary"
            disabled={busy || closing}
            onClick={() => finish(null)}
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            className={`primary ${danger ? 'danger-button' : ''}`}
            disabled={busy || closing}
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{' '}
            {busy ? '正在处理…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
