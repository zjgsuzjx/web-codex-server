import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ChevronDown, FileDiff, Files } from 'lucide-react';

export function ChangeStats({ added, removed, unknown = 0 }) {
  return <span className="change-stats" aria-label={`新增 ${added ?? '未知'} 行，删除 ${removed ?? '未知'} 行`}><span className="lines-added">{added == null ? '—' : `+${added}`}</span><span className="lines-removed">{removed == null ? '—' : `-${removed}`}</span>{unknown > 0 && <span className="change-unknown" title="部分文件无法统计行数">*</span>}</span>;
}

export default function ChangeSummary({ turn, threadId, onReview }) {
  const summary = turn.changes, files = summary?.files || [], done = turn.status !== 'inProgress';
  const [open, setOpen] = useState(false), [expanded, setExpanded] = useState(false), [limit, setLimit] = useState(50), [position, setPosition] = useState(null);
  const trigger = useRef(), panel = useRef(), timer = useRef(), restoring = useRef(false), id = useId();
  const close = () => { clearTimeout(timer.current); setOpen(false); };
  const show = () => { clearTimeout(timer.current); setOpen(true); };
  const leave = () => { timer.current = setTimeout(close, 150); };
  const review = path => { close(); onReview({ threadId, turnId: turn.id, path }); };
  useEffect(() => { close(); }, [done, files.length === 0]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open || done || !files.length) return;
    function positionPanel() {
      const anchor = trigger.current.getBoundingClientRect(), width = Math.min(360, window.innerWidth - 24);
      const availableAbove = anchor.top - 20, availableBelow = window.innerHeight - anchor.bottom - 20;
      const height = Math.min(320, Math.max(availableAbove, availableBelow));
      const above = availableAbove >= availableBelow;
      setPosition({ width, maxHeight: Math.max(100, height), left: Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)), ...(above ? { bottom: window.innerHeight - anchor.top + 7 } : { top: anchor.bottom + 7 }) });
    }
    const outside = e => { if (!trigger.current.contains(e.target) && !panel.current?.contains(e.target)) close(); };
    const keyboard = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); restoring.current = true; trigger.current.querySelector('button').focus(); restoring.current = false; } };
    positionPanel(); window.addEventListener('resize', positionPanel); document.addEventListener('scroll', positionPanel, true);
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keyboard, true);
    return () => { window.removeEventListener('resize', positionPanel); document.removeEventListener('scroll', positionPanel, true); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keyboard, true); };
  }, [open, done, files.length]);
  if (!files.length) return null;
  const fileRows = shown => shown.map(file => <button key={file.path} type="button" className="change-file-row" onClick={() => review(file.path)} title={file.path}><FileDiff size={14}/><span>{file.path}</span><ChangeStats {...file}/></button>);
  return done ? <section className="change-summary-card" aria-label="本轮文件变更"><header><span className="change-summary-icon"><Files size={20}/></span><div><strong>已编辑 {files.length} 个文件</strong><ChangeStats {...summary}/></div><button type="button" className="change-review-button" onClick={() => review()}>查看变更<ArrowRight size={13}/></button></header>
    <div className="change-summary-files">{fileRows(expanded ? files.slice(0, limit) : files.slice(0, 3))}</div>
    {files.length > 3 && <button className="change-expand" type="button" aria-expanded={expanded} onClick={() => { if (expanded && limit < files.length) setLimit(value => value + 50); else setExpanded(!expanded); }}>{!expanded ? `再显示 ${files.length - 3} 个文件` : limit < files.length ? `再显示 ${Math.min(50, files.length - limit)} 个文件` : '收起文件列表'}<ChevronDown size={13}/></button>}
    {summary.warning && <p className="change-summary-note">{summary.warning}</p>}{summary.unknown > 0 && <p className="change-summary-note">部分文件无法统计行数，详情中可查看原因。</p>}
  </section> : <span className="change-summary-trigger" ref={trigger} onPointerEnter={e => { if (e.pointerType !== 'touch') show(); }} onPointerLeave={leave} onFocus={e => { if (!restoring.current && e.target.matches(':focus-visible')) show(); }} onBlur={e => { if (!trigger.current.contains(e.relatedTarget) && !panel.current?.contains(e.relatedTarget)) close(); }}>
    <button type="button" className="change-summary-pill" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => review()} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); show(); requestAnimationFrame(() => panel.current?.querySelector('button').focus()); } }}><FileDiff size={14}/>{files.length} 个文件已更改<ChangeStats {...summary}/></button>
    {open && createPortal(<div className="change-file-popover" id={id} ref={panel} style={{ ...position, visibility: position ? 'visible' : 'hidden' }} aria-label="本轮修改的文件" onPointerEnter={show} onPointerLeave={leave} onFocus={show} onBlur={e => { if (!trigger.current.contains(e.relatedTarget) && !panel.current.contains(e.relatedTarget)) close(); }}><div className="change-popover-title">本轮修改</div>{fileRows(files.slice(0, limit))}{files.length > limit && <button className="change-expand" type="button" onClick={() => setLimit(value => value + 50)}>显示更多文件<ChevronDown size={13}/></button>}<button type="button" className="change-popover-all" onClick={() => review()}>查看全部变更<ArrowRight size={13}/></button></div>, document.body)}
  </span>;
}
