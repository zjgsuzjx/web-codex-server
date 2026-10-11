import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, LoaderCircle, RotateCcw, Zap } from 'lucide-react';
import { availableModels, compatibleEffort, effortLabel, effortTone, modelId, reasoningEfforts, selectedModel } from './model-options';

export default function ModelPicker({ settings, models, onLoad, onChange, onPreview, onSaving, disabled }) {
  const [open, setOpen] = useState(false), [choosingModel, setChoosingModel] = useState(false);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [draft, setDraft] = useState(settings.effort), [position, setPosition] = useState({});
  const trigger = useRef(), panel = useRef(), range = useRef(), busy = useRef(false), mounted = useRef(true);
  const id = useId(), choices = availableModels(models), model = selectedModel(choices, settings.model);
  const efforts = reasoningEfforts(model), index = Math.max(0, efforts.indexOf(draft));
  const tone = effortTone(draft), modelName = model?.displayName || settings.model || '默认模型';

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setDraft(settings.effort); }, [settings.effort, settings.model]);
  function close(restoreFocus = false) {
    setOpen(false); setChoosingModel(false); setDraft(settings.effort); onPreview(null);
    if (restoreFocus) trigger.current?.focus();
  }
  async function load() {
    setLoading(true); setError('');
    try { const result = await onLoad(); if (result === false && mounted.current) setError('模型读取失败，请重试'); }
    catch (e) { if (mounted.current) setError(e.message || '模型读取失败，请重试'); }
    finally { if (mounted.current) setLoading(false); }
  }
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current.getBoundingClientRect(), width = Math.min(384, window.innerWidth - 24);
      const height = panel.current?.offsetHeight || 160;
      const above = rect.top - height - 12;
      setPosition({ width, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), top: Math.max(12, above >= 12 ? above : Math.min(rect.bottom + 12, window.innerHeight - height - 12)), maxHeight: window.innerHeight - 24 });
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(panel.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    range.current?.focus();
    const outside = e => { if (!panel.current?.contains(e.target) && !trigger.current?.contains(e.target)) close(); };
    const escape = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); choosingModel ? setChoosingModel(false) : close(true); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, choosingModel, settings.effort]);
  useEffect(() => { if (disabled && open) close(); }, [disabled]);
  useEffect(() => {
    if (open && !loading && !choosingModel && document.activeElement === trigger.current) {
      (range.current || panel.current?.querySelector('button'))?.focus();
    }
  }, [open, loading, choosingModel]);

  async function save(next) {
    if (busy.current || disabled || loading) return;
    if (next.model === settings.model && next.effort === settings.effort) { onPreview(null); return; }
    busy.current = true; setSaving(true); onSaving(true); setError('');
    try { await onChange({ ...settings, ...next }); }
    catch (e) { setDraft(settings.effort); setError(e.message || '保存失败，请重试'); }
    finally { busy.current = false; onSaving(false); if (mounted.current) { setSaving(false); onPreview(null); } }
  }
  function preview(value) { setDraft(value); onPreview(value); }
  function commit(value) { preview(value); save({ model: settings.model, effort: value }); }
  function choose(value) {
    const nextModel = selectedModel(choices, value), effort = compatibleEffort(nextModel, settings.effort);
    setChoosingModel(false); setDraft(effort); onPreview(effort); save({ model: value, effort });
  }
  function toggle() {
    if (open) { close(); return; }
    setDraft(settings.effort); setOpen(true); load();
  }
  return <>
    <button ref={trigger} type="button" className="model-picker-trigger" data-tone={effortTone(settings.effort)} aria-label={`选择模型与推理强度，当前${modelName}，${effortLabel(settings.effort)}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled || saving} onClick={toggle}>
      <span>选择强度</span>{saving ? <LoaderCircle size={13} className="spin"/> : <ChevronDown size={13}/>}
    </button>
    {open && createPortal(<section ref={panel} className="model-picker-panel" data-tone={tone} style={position} id={id} role="dialog" aria-label="模型与推理强度" onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget) && e.relatedTarget !== trigger.current) close(); }}>
      <div className="model-picker-heading">
        <Zap className="model-picker-energy" size={21} strokeWidth={1.7}/>
        <div className="model-picker-title"><strong>{efforts.length ? effortLabel(draft) : '默认强度'}</strong><button type="button" className="model-picker-model" aria-expanded={choosingModel} disabled={saving || loading} onClick={()=>setChoosingModel(!choosingModel)}>{loading ? <><LoaderCircle size={13} className="spin"/>正在读取模型</> : <><span>{modelName}</span><ChevronRight size={14}/></>}</button></div>
        <button type="button" className="model-picker-reset" aria-label="恢复模型默认强度" title="恢复模型默认强度" disabled={saving || loading || !efforts.length} onClick={()=>commit(compatibleEffort(model, model?.defaultReasoningEffort || 'medium'))}><RotateCcw size={20} strokeWidth={1.7}/></button>
      </div>
      {choosingModel ? <div className="model-picker-models" role="group" aria-label="选择模型">
        {[{ id: '', displayName: '默认模型', description: '跟随当前 Codex 配置' }, ...choices].map(item => { const value = modelId(item) || ''; return <button type="button" key={value} aria-pressed={settings.model === value} disabled={saving} onClick={()=>choose(value)}><span><strong>{item.displayName || value}</strong>{item.description && <small>{item.description}</small>}</span>{settings.model === value && <Check size={16}/>}</button>; })}
        {!choices.length && <p className="model-picker-note">当前没有返回可切换的模型</p>}
      </div> : efforts.length ? <div className="model-picker-slider" style={{ '--progress': `${efforts.length > 1 ? index / (efforts.length - 1) * 100 : 100}%` }}>
        <div className="model-picker-track" aria-hidden="true"><div className="model-picker-fill"/>{efforts.map((value, i)=><i key={value} className={i <= index ? 'filled' : ''} style={{ left: `${efforts.length > 1 ? i / (efforts.length - 1) * 100 : 50}%` }}/>)}</div>
        <input ref={range} type="range" min="0" max={Math.max(0, efforts.length - 1)} step="1" value={index} aria-label="推理强度" aria-valuetext={effortLabel(draft)} disabled={saving || efforts.length < 2 || loading} onChange={e=>preview(efforts[Number(e.target.value)])} onPointerUp={e=>commit(efforts[Number(e.currentTarget.value)])} onKeyUp={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))commit(efforts[Number(e.currentTarget.value)]);}}/>
      </div> : <p className="model-picker-note">此模型使用默认推理强度</p>}
      {(saving || error) && <div className="model-picker-status" role="status">{saving ? '正在保存…' : <><span>{error}</span>{error.startsWith('模型读取') && <button type="button" onClick={load}>重试</button>}</>}</div>}
    </section>, document.body)}
  </>;
}
