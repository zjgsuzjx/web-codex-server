import { Bell, ChevronDown, Inbox, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../../../shared/contracts/api.ts';
import type {
  NotificationPage,
  NotificationSnapshot,
} from '../../../../shared/workspace/notifications.ts';

const empty: NotificationPage = { version: '', items: [], unread: 0, latest: 0, nextCursor: null };
export default function NotificationCenter({
  api,
  snapshot,
}: {
  api: ApiClient;
  snapshot: NotificationSnapshot | null;
}) {
  const [open, setOpen] = useState(false),
    [pinned, setPinned] = useState(false),
    [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const [pages, setPages] = useState({ all: empty, unread: empty }),
    [busy, setBusy] = useState(true),
    [acting, setActing] = useState(false),
    [error, setError] = useState(''),
    [expanded, setExpanded] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    request = useRef(0),
    version = useRef('');
  const page = pages[filter];
  const accept = useCallback((next: NotificationSnapshot) => {
    if (next.version === version.current) return;
    version.current = next.version;
    request.current++;
    setPages({ all: next.all, unread: next.unread });
    setBusy(false);
    setError('');
  }, []);
  useEffect(() => {
    if (snapshot) accept(snapshot);
  }, [snapshot, accept]);
  const resync = useCallback(async () => {
    const epoch = ++request.current;
    setBusy(true);
    try {
      const next = await api('/notifications/snapshot');
      if (epoch === request.current) accept(next);
    } catch (caught) {
      if (epoch === request.current) setError((caught as Error).message);
    } finally {
      if (epoch === request.current) setBusy(false);
    }
  }, [api, accept]);
  const loadMore = useCallback(
    async (cursor: number) => {
      const epoch = ++request.current;
      setBusy(true);
      try {
        const next = await api<NotificationPage>(
          `/notifications?filter=${filter}&cursor=${cursor}`,
        );
        if (epoch !== request.current) return;
        if (next.version !== version.current) {
          await resync();
          return;
        }
        setPages((previous) => ({
          ...previous,
          [filter]: {
            ...next,
            items: [
              ...previous[filter].items,
              ...next.items.filter(
                (item) => !previous[filter].items.some((old) => old.id === item.id),
              ),
            ],
          },
        }));
        setError('');
      } catch (caught) {
        if (epoch === request.current) setError((caught as Error).message);
      } finally {
        if (epoch === request.current) setBusy(false);
      }
    },
    [api, filter, resync],
  );
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        setPinned(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  async function mark(body: { id?: number; through?: number }) {
    if (acting) return;
    setActing(true);
    try {
      const epoch = request.current;
      const response = await api<{ snapshot: NotificationSnapshot }>('/notifications/read', {
        method: 'POST',
        body,
      });
      if (epoch === request.current) accept(response.snapshot);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setActing(false);
    }
  }
  return (
    <div
      className="notification-center"
      ref={root}
      onMouseEnter={() => {
        clearTimeout(closeTimer.current);
        setOpen(true);
      }}
      onMouseLeave={() => {
        if (!pinned) closeTimer.current = setTimeout(() => setOpen(false), 220);
      }}
      onBlur={(e) => {
        if (!pinned && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className="workspace-tool notification-trigger"
        aria-label={page.unread ? `提醒，${page.unread} 条未读消息` : '提醒'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="notification-panel"
        ref={trigger}
        onClick={() => {
          clearTimeout(closeTimer.current);
          if (pinned) {
            setPinned(false);
            setOpen(false);
          } else {
            setPinned(true);
            setOpen(true);
          }
        }}
      >
        <Bell size={18} strokeWidth={1.75} />
        {page.unread > 0 && (
          <span className="notification-badge">{page.unread > 99 ? '99+' : page.unread}</span>
        )}
      </button>
      {open && (
        <section
          id="notification-panel"
          className="notification-panel"
          role="dialog"
          aria-label="消息通知"
        >
          <div className="notification-controls">
            <div className="notification-tabs" role="group" aria-label="消息筛选">
              <button
                aria-pressed={filter === 'unread'}
                onClick={() => {
                  setFilter('unread');
                  setExpanded(null);
                }}
              >
                未读
              </button>
              <button
                aria-pressed={filter === 'all'}
                onClick={() => {
                  setFilter('all');
                  setExpanded(null);
                }}
              >
                全部
              </button>
            </div>
          </div>
          {error && (
            <p className="notification-error" role="alert">
              {error}
              <button onClick={() => void resync()}>重试</button>
            </p>
          )}
          <div className="notification-list" aria-busy={busy}>
            {!page.items.length ? (
              <div className="notification-empty">
                {busy ? (
                  <LoaderCircle size={22} className="spin" />
                ) : (
                  <Inbox size={24} strokeWidth={1.4} />
                )}
                <strong>
                  {busy
                    ? '正在读取消息…'
                    : filter === 'unread'
                      ? '未读消息已清空'
                      : '暂时还没有消息'}
                </strong>
              </div>
            ) : (
              page.items.map((item) => (
                <article
                  key={item.id}
                  className={`notification-item${item.read ? '' : ' is-unread'}`}
                >
                  <button
                    className="notification-item-main"
                    aria-expanded={expanded === item.id}
                    onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                  >
                    <div className="notification-item-title">
                      <span className="notification-dot" />
                      <strong>{item.title}</strong>
                      <ChevronDown size={14} className={expanded === item.id ? 'expanded' : ''} />
                    </div>
                    <p className={expanded === item.id ? 'expanded' : ''}>{item.body}</p>
                    <span className="notification-meta">
                      {item.author}
                      <i />
                      {new Date(item.created).toLocaleString([], {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </button>
                  {!item.read && (
                    <button
                      className="notification-mark"
                      disabled={acting}
                      onClick={() => void mark({ id: item.id })}
                    >
                      标为已读
                    </button>
                  )}
                </article>
              ))
            )}
            {page.nextCursor && (
              <button
                className="notification-load"
                disabled={busy}
                onClick={() => void loadMore(page.nextCursor!)}
              >
                {busy ? '正在加载…' : '查看更早的消息'}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
