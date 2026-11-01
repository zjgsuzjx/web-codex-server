import { randomUUID } from 'node:crypto';
import type {
  NotificationPage,
  NotificationSnapshot,
  SiteNotification,
} from '../../shared/workspace/notifications.ts';
import type { createStore } from '../db/store.ts';

/** Snapshots are generated synchronously with mutations and sent over the existing authenticated WS. */
export function createNotifications(store: ReturnType<typeof createStore>) {
  const epoch = randomUUID(),
    reads = new Map<string, number>();
  let revision = 0;
  const version = (uid: string) => `${epoch}:${revision}:${reads.get(uid) || 0}`;
  function page(
    uid: string,
    unreadOnly = false,
    cursor = Number.MAX_SAFE_INTEGER,
  ): NotificationPage {
    const rows = store.all<Omit<SiteNotification, 'read'> & { read: number }>(
      `SELECT n.id,n.title,n.body,n.created,u.username AS author,CASE WHEN r.notification_id IS NULL THEN 0 ELSE 1 END AS read
       FROM site_notifications n JOIN users u ON u.id=n.author_id
       LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=?
       WHERE n.id<? ${unreadOnly ? 'AND r.notification_id IS NULL' : ''} ORDER BY n.id DESC LIMIT 31`,
      uid,
      cursor,
    );
    return {
      version: version(uid),
      items: rows.slice(0, 30).map((row) => ({ ...row, read: !!row.read })),
      unread: store.get(
        `SELECT COUNT(*) AS n FROM site_notifications n WHERE NOT EXISTS(SELECT 1 FROM notification_reads r WHERE r.notification_id=n.id AND r.user_id=?)`,
        uid,
      ).n,
      nextCursor: rows.length > 30 ? rows[29]!.id : null,
      latest: store.get('SELECT COALESCE(MAX(id),0) AS id FROM site_notifications').id,
    };
  }
  return {
    page,
    snapshot(uid: string): NotificationSnapshot {
      return { version: version(uid), all: page(uid), unread: page(uid, true) };
    },
    changed(uid?: string) {
      if (uid) reads.set(uid, (reads.get(uid) || 0) + 1);
      else revision++;
    },
  };
}
