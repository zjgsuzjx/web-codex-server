export function createTurnActivity(store, now = Date.now) {
  // A gateway restart disconnects its app-server processes. Do not leave old
  // tasks spinning forever, or invent a precise end time during the downtime.
  store.run("UPDATE turn_activity SET status='interrupted' WHERE status='inProgress'");
  const read = (threadId, turnId) => store.get('SELECT * FROM turn_activity WHERE thread_id=? AND turn_id=?', threadId, turnId);
  const publicTurn = row => ({ id: row.turn_id, status: row.status, timing: { startedAt: row.started_at, completedAt: row.completed_at } });
  function observe(thread, turn) {
    if (!turn?.id || !['inProgress', 'completed', 'interrupted', 'failed'].includes(turn.status)) return;
    const row = read(thread.id, turn.id);
    if (!row) {
      // Historical completed turns have no observed start; their duration is unknown.
      if (turn.status === 'inProgress') store.run('INSERT INTO turn_activity(thread_id,turn_id,status,started_at) VALUES(?,?,?,?)', thread.id, turn.id, turn.status, now());
    } else if (row.status === 'inProgress' && turn.status !== 'inProgress') {
      store.run('UPDATE turn_activity SET status=?,completed_at=MAX(started_at,?) WHERE thread_id=? AND turn_id=?', turn.status, now(), thread.id, turn.id);
    } else if (turn.status !== 'inProgress' && row.status !== turn.status) {
      store.run('UPDATE turn_activity SET status=? WHERE thread_id=? AND turn_id=?', turn.status, thread.id, turn.id);
    }
  }
  return {
    observe,
    decorate(thread, turn) {
      if (read(thread.id, turn.id)) observe(thread, turn);
      const row = read(thread.id, turn.id);
      return row ? { ...turn, ...publicTurn(row) } : turn;
    },
    active(userId) {
      return store.all("SELECT a.* FROM turn_activity a JOIN threads t ON t.id=a.thread_id WHERE t.user_id=? AND t.archived=0 AND a.status='inProgress'", userId).map(row => ({ threadId: row.thread_id, turn: publicTurn(row) }));
    },
    disconnect(userId) {
      const stopped = this.active(userId);
      for (const { threadId, turn } of stopped) observe({ id: threadId }, { ...turn, status: 'interrupted' });
      return stopped.map(({ threadId, turn }) => ({ threadId, turn: publicTurn(read(threadId, turn.id)) }));
    },
    fork(from, to) {
      store.run("INSERT INTO turn_activity(thread_id,turn_id,status,started_at,completed_at) SELECT ?,turn_id,status,started_at,completed_at FROM turn_activity WHERE thread_id=? AND status!='inProgress'", to, from);
    }
  };
}
