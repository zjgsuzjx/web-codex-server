import { Bell, ChevronDown, LoaderCircle, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../../../shared/contracts/api.ts';
import type {
  NotificationPage,
  SiteNotification,
} from '../../../../shared/workspace/notifications.ts';

export default function NotificationManagement({
  api,
  notify,
}: {
  api: ApiClient;
  notify: (message: string, error?: boolean) => void;
}) {
  const [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [items, setItems] = useState<SiteNotification[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [deleting, setDeleting] = useState<number | null>(null),
    [expanded, setExpanded] = useState<number | null>(null);
  const pending = useRef(false),
    epoch = useRef(0);
  const load = useCallback(
    async (cursor?: number) => {
      const request = ++epoch.current;
      setLoading(true);
      try {
        const page = await api<NotificationPage>(
          `/notifications?filter=all${cursor ? `&cursor=${cursor}` : ''}`,
        );
        if (request !== epoch.current) return;
        setItems((previous) => (cursor ? [...previous, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setError('');
      } catch (caught) {
        if (request === epoch.current) setError((caught as Error).message);
      } finally {
        if (request === epoch.current) setLoading(false);
      }
    },
    [api],
  );
  useEffect(() => {
    void load();
    return () => {
      epoch.current++;
    };
  }, [load]);
  return (
    <section className="site-notification-management" aria-label="网站消息管理">
      <div className="site-section-heading">
        <span>
          <Bell size={16} />
        </span>
        <div>
          <h4>网站消息</h4>
          <p>向所有网站用户发布公告或提醒。</p>
        </div>
      </div>
      <form
        className="site-message-compose"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending.current || !title.trim() || !body.trim()) return;
          pending.current = true;
          setBusy(true);
          try {
            await api('/admin/notifications', { method: 'POST', body: { title, body } });
            setTitle('');
            setBody('');
            notify('网站消息已发布');
            await load();
            window.dispatchEvent(new Event('site:notifications'));
          } catch (caught) {
            notify((caught as Error).message, true);
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <label>
          消息标题
          <input
            placeholder="给这条消息一个清晰的标题"
            maxLength={100}
            required
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          消息内容
          <textarea
            placeholder="写下需要与大家分享的内容…"
            maxLength={10000}
            required
            rows={4}
            value={body}
            disabled={busy}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <div className="site-compose-footer">
          <span>发布后，所有用户都可以在提醒中查看。</span>
          <button className="primary" disabled={busy || !title.trim() || !body.trim()}>
            {busy ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />}发布消息
          </button>
        </div>
      </form>
      <div className="site-history-heading">
        <h4>已发布消息</h4>
        <span>所有管理员发布的消息</span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
          <button onClick={() => void load()}>重试</button>
        </p>
      )}
      {!items.length && (
        <p className="site-history-empty">
          {loading ? '正在读取…' : '还没有发布消息，写下第一条公告吧。'}
        </p>
      )}
      <div className="site-message-history">
        {items.map((item) => (
          <article key={item.id}>
            <button
              className="site-history-content"
              aria-expanded={expanded === item.id}
              onClick={() => setExpanded(expanded === item.id ? null : item.id)}
            >
              <strong>
                {item.title}
                <ChevronDown size={13} />
              </strong>
              <p className={expanded === item.id ? 'expanded' : ''}>{item.body}</p>
              <small>
                {item.author} · {new Date(item.created).toLocaleString()}
              </small>
            </button>
            <button
              className="memo-icon danger-text"
              aria-label={`删除消息：${item.title}`}
              disabled={busy}
              onClick={() => setDeleting(item.id)}
            >
              <Trash2 size={15} />
            </button>
            {deleting === item.id && (
              <div className="site-delete-confirm">
                <span>删除后，所有用户将无法再查看。</span>
                <button onClick={() => setDeleting(null)}>取消</button>
                <button
                  className="danger-text"
                  disabled={busy}
                  onClick={async () => {
                    if (pending.current) return;
                    pending.current = true;
                    setBusy(true);
                    try {
                      await api(`/admin/notifications/${item.id}`, { method: 'DELETE' });
                      setDeleting(null);
                      await load();
                      window.dispatchEvent(new Event('site:notifications'));
                      notify('消息已删除');
                    } catch (caught) {
                      notify((caught as Error).message, true);
                    } finally {
                      pending.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  确认删除
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {cursor && (
        <button className="secondary full" disabled={loading} onClick={() => void load(cursor)}>
          加载更早的消息
        </button>
      )}
    </section>
  );
}
