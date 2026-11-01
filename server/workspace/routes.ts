import type { Express } from 'express';
import type { createStore } from '../db/store.ts';
import { fail } from '../files/files.ts';
import { validateMemo } from '../../shared/workspace/memo.ts';
import { createNotifications } from './notifications.ts';

export function workspaceRoutes(
  app: Express,
  store: ReturnType<typeof createStore>,
  notify: (uid?: string) => void = () => {},
) {
  const notifications = createNotifications(store);
  app.get('/api/memo', (req, res) => {
    const row = store.get('SELECT * FROM user_memos WHERE user_id=?', req.user.id);
    res.json(
      row
        ? { nodes: JSON.parse(row.content), version: row.version, updated: row.updated }
        : { nodes: [], version: 0, updated: null },
    );
  });
  app.put('/api/memo', (req, res) => {
    let nodes;
    try {
      nodes = validateMemo(req.body?.nodes);
    } catch (error) {
      fail(400, (error as Error).message);
    }
    const version = req.body?.version;
    if (!Number.isSafeInteger(version) || version < 0) fail(400, '备忘录版本无效');
    if (
      (store.get('SELECT version FROM user_memos WHERE user_id=?', req.user.id)?.version || 0) !==
      version
    )
      fail(409, '备忘录已在其他页面更新，本地内容已保留');
    const updated = Date.now();
    const result = store.run(
      `INSERT INTO user_memos(user_id,content,version,updated) VALUES(?,?,1,?)
      ON CONFLICT(user_id) DO UPDATE SET content=excluded.content,version=user_memos.version+1,updated=excluded.updated WHERE user_memos.version=?`,
      req.user.id,
      JSON.stringify(nodes),
      updated,
      version,
    );
    // A first save must also carry the empty document's version.
    if (!result.changes) fail(409, '备忘录已在其他页面更新，本地内容已保留');
    res.json({
      nodes,
      version: store.get('SELECT version FROM user_memos WHERE user_id=?', req.user.id).version,
      updated,
    });
  });
  app.get('/api/notifications/snapshot', (req, res) =>
    res.json(notifications.snapshot(req.user.id)),
  );
  app.get('/api/notifications', (req, res) => {
    const cursor =
      req.query.cursor === undefined ? Number.MAX_SAFE_INTEGER : Number(req.query.cursor);
    if (!Number.isSafeInteger(cursor) || cursor < 1) fail(400, '消息游标无效');
    res.json(notifications.page(req.user.id, req.query.filter === 'unread', cursor));
  });
  app.post('/api/notifications/read', (req, res) => {
    const { id, through } = req.body || {};
    let changes = 0;
    if (id !== undefined) {
      if (!Number.isSafeInteger(id) || id < 1) fail(400, '消息无效');
      changes = Number(
        store.run(
          'INSERT OR IGNORE INTO notification_reads(user_id,notification_id) SELECT ?,id FROM site_notifications WHERE id=?',
          req.user.id,
          id,
        ).changes,
      );
    } else {
      if (!Number.isSafeInteger(through) || through < 0) fail(400, '消息范围无效');
      changes = Number(
        store.run(
          'INSERT OR IGNORE INTO notification_reads(user_id,notification_id) SELECT ?,id FROM site_notifications WHERE id<=?',
          req.user.id,
          through,
        ).changes,
      );
    }
    if (changes) {
      notifications.changed(req.user.id);
      notify(req.user.id);
    }
    res.json({ ok: true, snapshot: notifications.snapshot(req.user.id) });
  });
  app.post('/api/admin/notifications', (req, res) => {
    if (!['admin', 'superadmin'].includes(store.user(req.user.id)?.role || ''))
      fail(403, '需要管理员权限');
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!title || title.length > 100 || !body || body.length > 10000)
      fail(400, '请填写消息标题（最多 100 字）与正文（最多 10,000 字）');
    if (
      store.get(
        'SELECT COUNT(*) AS n FROM site_notifications WHERE author_id=? AND created>?',
        req.user.id,
        Date.now() - 60000,
      ).n >= 10
    )
      fail(429, '发送过于频繁，请稍后再试');
    const result = store.run(
      'INSERT INTO site_notifications(title,body,author_id,created) VALUES(?,?,?,?)',
      title,
      body,
      req.user.id,
      Date.now(),
    );
    store.audit(req.user.id, `notification:publish:${result.lastInsertRowid}`);
    notifications.changed();
    notify();
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });
  app.delete('/api/admin/notifications/:id', (req, res) => {
    if (!['admin', 'superadmin'].includes(store.user(req.user.id)?.role || ''))
      fail(403, '需要管理员权限');
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) fail(400, '消息无效');
    const result = store.run('DELETE FROM site_notifications WHERE id=?', id);
    store.audit(req.user.id, `notification:delete:${id}`);
    if (result.changes) {
      notifications.changed();
      notify();
    }
    res.json({ ok: true });
  });
  return notifications;
}
