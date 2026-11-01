import type { Express } from 'express';
import type { createStore } from '../db/store.ts';
import { fail } from '../files/files.ts';
import { validateMemo } from '../../shared/workspace/memo.ts';

export function workspaceRoutes(app: Express, store: ReturnType<typeof createStore>) {
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
}
