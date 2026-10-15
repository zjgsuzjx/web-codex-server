import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ListChecks, LoaderCircle, Play } from 'lucide-react';

const modes = [
  { value: 'default', label: '执行模式', description: '直接编写代码、修改文件并执行任务。', icon: Play },
  { value: 'plan', label: '计划模式', description: '先讨论方案和步骤，再开始实现。', icon: ListChecks }
];
export default function ModePicker({ value, disabled, onChange, onSaving }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [position, setPosition] = useState({});
  const root = useRef(), trigger = useRef(), menu = useRef(), pending = useRef(false), uid = useId(), current = modes.find(mode => mode.value === value) || modes[0];
  function close(focus = false) { setOpen(false); if (focus) trigger.current?.focus({ preventScroll: true }); }
  function show() {
    if (disabled || pending.current) return;
    const rect = trigger.current.getBoundingClientRect(), width = Math.min(302, innerWidth - 24);
    const above = rect.top - 20, below = innerHeight - rect.bottom - 20;
    setPosition({ position: 'fixed', width, left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)), maxHeight: Math.max(120, Math.max(above, below)), ...(above > below ? { bottom: innerHeight - rect.top + 10 } : { top: rect.bottom + 10 }) });
    setError(''); setOpen(true);
  }
  useEffect(() => {
    if (!open) return;
    menu.current.querySelector(`[data-mode="${current.value}"]`)?.focus();
    const outside = e => { if (!root.current.contains(e.target) && !pending.current) close(); };
    const resize = () => { if (!pending.current) close(true); };
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', resize); document.addEventListener('scroll', resize, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize); document.removeEventListener('scroll', resize, true); };
  }, [open]);
  useEffect(() => { if (disabled && !pending.current) setOpen(false); }, [disabled]);
  async function choose(mode) {
    if (pending.current || disabled) return;
    if (mode.value === value) { close(true); return; }
    pending.current = true; setBusy(true); setError(''); onSaving(true);
    try { await onChange(mode.value); close(true); }
    catch (e) { setError(e.message || '模式切换失败，请重试'); }
    finally { pending.current = false; setBusy(false); onSaving(false); }
  }
  function keys(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) close(true); }
    if (e.key === 'Tab') { if (!busy) close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); const options = [...menu.current.querySelectorAll('[role=menuitemradio]')], index = options.indexOf(document.activeElement);
    options[e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
  }
  return <div className="mode-picker" ref={root}><button ref={trigger} type="button" className={`mode-trigger ${value === 'plan' ? 'is-plan' : ''}`} disabled={disabled || busy} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? uid : undefined} aria-label={`对话模式：${current.label}`} onClick={() => open ? close() : show()} onKeyDown={e => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); show(); } }}>{busy ? <LoaderCircle size={14} className="spin"/> : <current.icon size={14}/>}<span>{current.label}</span><ChevronDown size={12} className={open ? 'is-open' : ''}/></button>
    {open && <div ref={menu} id={uid} className="mode-menu" role="menu" aria-label="对话模式" style={position} onKeyDown={keys}><header>选择工作方式</header>{modes.map(mode => <button key={mode.value} type="button" role="menuitemradio" aria-checked={mode.value === value} data-mode={mode.value} disabled={busy} onClick={() => choose(mode)}><span className="mode-option-icon"><mode.icon size={18}/></span><span><strong>{mode.label}</strong><small>{mode.description}</small></span>{mode.value === value && <Check size={15}/>}</button>)}{error && <p className="mode-error" role="alert">{error}</p>}</div>}
  </div>;
}
