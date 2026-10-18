import React, { memo, useEffect, useState } from 'react';
import { Clock3, Sparkles } from 'lucide-react';
import { currentThought } from '../shared/thinking.js';
import { elapsedTime, formatDuration, isRunning } from '../shared/turn-activity.js';

export default memo(function ThinkingStatus({ turn, sending = false, waitingForInput = false }) {
  const running = isRunning(turn), [now, setNow] = useState(Date.now);
  const startedAt = turn?.timing?.startedAt, completedAt = turn?.timing?.completedAt;
  useEffect(() => {
    if (!running || startedAt == null || completedAt != null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, startedAt, completedAt]);
  const elapsed = !running && completedAt == null ? null : elapsedTime(turn?.timing, now);
  if (!running && !sending && startedAt == null) return null;
  const label = running ? waitingForInput ? '正在等待你的回答' : currentThought(turn) : '正在发送消息';
  const finished = turn?.status === 'failed' ? '执行失败' : turn?.status === 'interrupted' ? '已停止' : '已完成';
  return <div className={`thinking-status ${running || sending ? 'is-active' : 'is-finished'}`}>
    {(running || sending) && <><div className="thinking-symbol" aria-hidden="true"><Sparkles size={16}/></div><div className="thinking-copy"><p className="thinking-text" role="status">{label}</p>{elapsed != null && <div className="thinking-time"><Clock3 size={12} aria-hidden="true"/><span>已用 <time>{formatDuration(elapsed)}</time></span></div>}</div></>}
    {!running && !sending && <div className="thinking-time"><Clock3 size={12} aria-hidden="true"/><span>{finished} · {elapsed == null ? '计时已中断' : <>用时 <time>{formatDuration(elapsed)}</time></>}</span></div>}
  </div>;
});
