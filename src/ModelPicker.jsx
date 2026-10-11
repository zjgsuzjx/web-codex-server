import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import ModelControls from './ModelControls';
import { effortTone, modelOptions } from './model-options';

export default function ModelPicker({ settings, models, onLoad, onChange, onPreview, onSaving, disabled }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ model: settings.model, effort: settings.effort }), [error, setError] = useState(''), [position, setPosition] = useState({});
  const trigger = useRef(), panel = useRef(), busy = useRef(false), mounted = useRef(true), id = useId();
  const modelName = modelOptions(models, settings.model).find(option => option.value === settings.model)?.label;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setDraft({ model: settings.model, effort: settings.effort }); }, [settings.model, settings.effort]);
  function close(restoreFocus = false) {
    setOpen(false); onPreview(null);
    if (restoreFocus) trigger.current?.focus();
  }
  async function load() {
    setLoading(true); setError('');
    try { if (await onLoad() === false && mounted.current) setError('模型读取失败，请重试'); }
    catch (e) { if (mounted.current) setError(e.message || '模型读取失败，请重试'); }
    finally { if (mounted.current) setLoading(false); }
  }
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current.getBoundingClientRect(), width = Math.min(280, innerWidth - 24);
      const height = panel.current.offsetHeight || 150, above = rect.top - height - 8;
      setPosition({ width, left: Math.max(12, Math.min(rect.right - width, innerWidth - width - 12)), top: Math.max(12, above >= 12 ? above : Math.min(rect.bottom + 8, innerHeight - height - 12)), maxHeight: innerHeight - 24 });
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(panel.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = e => { if (!panel.current?.contains(e.target) && !trigger.current?.contains(e.target)) close(); };
    const escape = e => { if (e.key === 'Escape') { e.preventDefault(); close(true); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => { if (disabled && open) close(); }, [disabled]);
  useEffect(() => {
    if (open && !loading && document.activeElement === trigger.current) panel.current?.querySelector('[role=combobox]')?.focus();
  }, [open, loading]);
  async function save(next) {
    if (busy.current || disabled || loading) return;
    if (next.model === settings.model && next.effort === settings.effort) return;
    const focused = panel.current?.contains(document.activeElement) ? document.activeElement : null;
    busy.current = true; setSaving(true); onSaving(true); setError('');
    setDraft({ model: next.model, effort: next.effort }); onPreview(next.effort);
    try { await onChange({ ...settings, model: next.model, effort: next.effort }); }
    catch (e) { if (mounted.current) { setDraft({ model: settings.model, effort: settings.effort }); setError(e.message || '保存失败，请重试'); } }
    finally {
      busy.current = false; onSaving(false);
      if (mounted.current) {
        setSaving(false); onPreview(null);
        requestAnimationFrame(() => { if (focused && panel.current?.contains(focused) && document.activeElement === document.body) focused.focus(); });
      }
    }
  }
  function toggle() {
    if (open) { close(); return; }
    setDraft({ model: settings.model, effort: settings.effort }); setOpen(true); load();
  }
  return <>
    <button ref={trigger} type="button" className="model-picker-trigger" data-tone={effortTone(settings.effort)} aria-label={`选择模型与推理强度，当前${modelName}，${settings.effort}`} title={`${modelName} · ${settings.effort}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled || saving} onClick={toggle}>
      <span className="model-picker-name">{modelName}</span><span className="model-picker-divider" aria-hidden="true">·</span><span className="model-picker-effort">{settings.effort}</span>{saving ? <LoaderCircle size={12} className="spin"/> : <ChevronDown size={12}/>}
    </button>
    {open && createPortal(<section ref={panel} className="model-picker-panel" style={position} id={id} role="dialog" aria-label="模型与推理强度" onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget) && e.relatedTarget !== trigger.current) close(); }}>
      <ModelControls models={models} value={{ ...settings, ...draft }} onChange={save} disabled={saving || loading}/>
      {(loading || saving || error) && <div className="model-picker-status" role="status">{loading || saving ? <><LoaderCircle size={12} className="spin"/>{loading ? '正在读取模型…' : '正在保存…'}</> : <><span>{error}</span>{error.startsWith('模型读取') && <button type="button" onClick={load}>重试</button>}</>}</div>}
    </section>, document.body)}
  </>;
}
