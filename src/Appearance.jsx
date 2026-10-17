import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ImagePlus, LoaderCircle, Monitor, Palette, RotateCcw, Smartphone, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { avatarDimensions } from '../shared/avatar.js';
import { skinDevice, skinTokens, WALLPAPER_MAX_BYTES } from '../shared/skins.js';
import Select from './Select';
import Modal from './Modal';
import './appearance.css';

const AppearanceContext = createContext(null);
export const useAppearance = () => useContext(AppearanceContext);
export function AppearanceProvider({ user, fallbackTheme, children }) {
  const [preview, setPreview] = useState(null), device = skinDevice(navigator.userAgent);
  const snapshot = user.skins || { presets: [], active: {}, jobs: [] };
  const saved = snapshot.presets.find(p => p.id === snapshot.active[device]);
  const current = preview || saved, theme = current?.config.mode || fallbackTheme;
  const tokens = useMemo(() => current ? skinTokens(current.config) : null, [current]);
  useEffect(() => {
    const root = document.documentElement, properties = [];
    root.dataset.theme = theme;
    if (current && tokens) {
      root.dataset.skin = 'custom';
      const values = { ...tokens, 'scroll-thumb': tokens.line, 'scroll-hover': tokens.muted, 'scroll-active': tokens.accent,
        'diff-add': tokens.success, 'diff-remove': tokens.danger, 'diff-add-bg': `color-mix(in srgb,${tokens.success} 12%,${tokens.panel})`, 'diff-remove-bg': `color-mix(in srgb,${tokens.danger} 12%,${tokens.panel})`,
        'permission-full': tokens.warning, 'permission-full-bg': `color-mix(in srgb,${tokens.warning} 10%,${tokens.panel})`, 'permission-full-line': tokens.warning,
        wallpaper: `url("${current.imageUrl}")`, 'wallpaper-fit': current.config.wallpaper.fit, 'wallpaper-position': `${current.config.wallpaper.x}% ${current.config.wallpaper.y}%`, 'wallpaper-shade': current.config.wallpaper.shade };
      for (const [key, value] of Object.entries(values)) { root.style.setProperty(`--${key}`, value); properties.push(`--${key}`); }
    } else delete root.dataset.skin;
    window.dispatchEvent(new Event('appearancechange'));
    return () => { for (const property of properties) root.style.removeProperty(property); delete root.dataset.skin; root.dataset.theme = fallbackTheme; };
  }, [current, theme, tokens]);
  return <AppearanceContext.Provider value={{ snapshot, preview, setPreview, saved, current, device, theme }}>{children}</AppearanceContext.Provider>;
}

async function prepareWallpaper(file) {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('请选择不超过 20 MB 的 JPG、PNG 或 WebP 图片');
  avatarDimensions(new Uint8Array(await file.arrayBuffer()));
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url; await image.decode();
    const scale = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight), Math.sqrt(4_000_000 / (image.naturalWidth * image.naturalHeight)));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale));
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('图片处理失败，请重新选择');
    // Reduce very detailed photographs until the canonical raster fits the upload budget.
    while (blob.size > WALLPAPER_MAX_BYTES && canvas.width > 640 && canvas.height > 640) {
      const smaller = document.createElement('canvas'); smaller.width = Math.floor(canvas.width * .8); smaller.height = Math.floor(canvas.height * .8);
      smaller.getContext('2d').drawImage(canvas, 0, 0, smaller.width, smaller.height);
      canvas.width = smaller.width; canvas.height = smaller.height; canvas.getContext('2d').drawImage(smaller, 0, 0);
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    }
    if (!blob || blob.size > WALLPAPER_MAX_BYTES) throw new Error('图片内容过大，请缩小后重试');
    return new File([blob], 'wallpaper.png', { type: 'image/png' });
  } finally { URL.revokeObjectURL(url); }
}

export default function Appearance({ api, socket, onUpdate, onReset, notify }) {
  const { snapshot, setPreview, saved, current, device } = useAppearance();
  const [target, setTarget] = useState(device), [draft, setDraft] = useState(() => snapshot.drafts?.find(d => d.device === device) || null), [hint, setHint] = useState(''), [busy, setBusy] = useState(''), [progress, setProgress] = useState(0), [error, setError] = useState('');
  const [job, setJob] = useState(() => snapshot.jobs?.find(j => j.device === device) || null);
  const [immersive, setImmersive] = useState(false);
  const input = useRef(), pending = useRef(false), mounted = useRef(true), controller = useRef();
  const editable = target === device, presets = snapshot.presets.filter(p => p.device === target);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); setPreview(null); }; }, []);
  useEffect(() => {
    let stopped = false;
    api('/skins').then(next => {
      if (stopped) return;
      onUpdate(next);
      const latest = next.jobs?.find(j => j.device === device);
      setDraft(latest?.status === 'completed' ? { wallpaperId: latest.wallpaperId, imageUrl: `/api/skins/wallpapers/${latest.wallpaperId}`, config: latest.config } : next.drafts?.find(d => d.device === device) || null);
      setJob(latest || null);
      if (!latest) setError('');
    }).catch(e => { if (!stopped) setError(e.message); });
    return () => { stopped = true; };
  }, []);
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    let stopped = false, timer;
    async function poll() {
      try { const next = await api(`/skins/jobs/${job.id}`); if (!stopped) { setJob(next); if (next.status === 'running') timer = setTimeout(poll, 1400); } }
      catch (e) { if (!stopped) { setError(e.message); if (/任务不存在/.test(e.message)) setJob({ ...job, status: 'failed', error: '服务已重新启动或任务已过期，请重新智能适配。' }); else timer = setTimeout(poll, 4000); } }
    }
    poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (job?.status === 'completed') { setDraft({ wallpaperId: job.wallpaperId, imageUrl: `/api/skins/wallpapers/${job.wallpaperId}`, config: job.config }); setError(''); }
    if (job?.status === 'failed') setError(job.error);
  }, [job?.id, job?.status]);
  async function run(label, action) {
    if (pending.current) return; pending.current = true; setBusy(label); setError('');
    try { await action(); } catch (e) { if (mounted.current) setError(e.message); }
    finally { pending.current = false; if (mounted.current) setBusy(''); }
  }
  async function discard() {
    setPreview(null);
    if (draft && !snapshot.presets.some(p => p.wallpaperId === draft.wallpaperId)) onUpdate(await api(`/skins/wallpapers/${draft.wallpaperId}`, { method: 'DELETE' }));
    setDraft(null); setJob(null);
  }
  async function choose(file) {
    if (!file || !editable || pending.current || job?.status === 'running') return;
    await run('正在处理图片', async () => {
      const canonical = await prepareWallpaper(file);
      if (!mounted.current) return;
      await discard(); controller.current = new AbortController(); setBusy('正在上传壁纸'); setProgress(0);
      const [uploaded] = await socket.upload({ scope: 'wallpaper', device }, [canonical], p => { if (mounted.current) setProgress(Math.round(p.done / p.total * 100)); }, controller.current.signal);
      if (mounted.current) setDraft({ ...uploaded, config: null });
    });
  }
  function adjust(next) { const updated = { ...draft, config: next }; setDraft(updated); if (current?.wallpaperId === draft.wallpaperId) setPreview(updated); }
  function save() { return run('正在保存预设', async () => { const next = await api('/skins/presets', { method: 'POST', body: { device, wallpaperId: draft.wallpaperId, config: draft.config } }); onUpdate(next); setPreview(null); setDraft(null); setJob(null); setImmersive(false); notify('已保存并应用到当前设备'); }); }
  const generating = job?.status === 'running', disabled = !!busy || generating;
  const candidate = draft?.config ? draft : saved;
  const previewing = current && current !== saved;
  return <><div className="appearance-panel">
    <div className="appearance-heading"><span className="appearance-icon"><Palette size={21}/></span><div><h3>让工作区，有你的风格。</h3><p>一张壁纸，一整套协调的界面。</p></div></div>
    <div className="appearance-devices" aria-label="外观适用设备">{[['desktop', Monitor, '桌面'], ['mobile', Smartphone, '手机']].map(([id, Icon, label]) => <button type="button" key={id} aria-pressed={target === id} onClick={() => { setTarget(id); setPreview(null); setError(''); }}><Icon size={16}/>{label}<small>{device === id ? '当前设备' : '需在此设备设置'}</small></button>)}</div>
    {!editable ? <div className="appearance-device-note"><Smartphone size={25}/><strong>请在{target === 'mobile' ? '手机' : '电脑'}上设置这套外观</strong><p>在对应设备上查看实际效果，再上传、适配和切换预设。两端的设置独立保存。</p></div> : <>
      <div className="appearance-preview" style={candidate ? { ...Object.fromEntries(Object.entries(skinTokens(candidate.config)).map(([k,v])=>[`--${k}`,v])), backgroundImage: `linear-gradient(transparent, color-mix(in srgb, var(--bg) 45%, transparent)), url("${candidate.imageUrl}")`, backgroundSize: candidate.config.wallpaper.fit, backgroundPosition: `${candidate.config.wallpaper.x}% ${candidate.config.wallpaper.y}%` } : undefined}>
        <div className="appearance-mini-sidebar"><span/><i/><i/><i/><b/></div><div className="appearance-mini-main"><div className="appearance-mini-bar"><i/><i/><i/></div><div className="appearance-mini-message"><Sparkles size={17}/><div><strong>把灵感带进工作区</strong><span>颜色与壁纸，自然相衬。</span></div></div><div className="appearance-mini-input"><span>从一个想法开始…</span><b>↑</b></div></div>
        <span className="appearance-preview-label">{candidate ? candidate.config.name : 'Starvalley · 默认外观'}</span>
      </div>
      <div className="appearance-upload-row"><div><strong>你的壁纸，Codex 来搭配</strong><p>JPG、PNG、WebP · 最大 20 MB · 自动优化尺寸</p></div><button type="button" className="secondary" disabled={disabled} onClick={() => input.current.click()}><Upload size={14}/>{draft ? '更换图片' : '上传壁纸'}</button><input hidden ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { choose(e.target.files?.[0]); e.target.value = ''; }}/></div>
      {draft && <div className="appearance-draft"><div className="appearance-draft-image"><img src={draft.imageUrl} alt="待适配的壁纸"/><div><strong>{draft.config ? draft.config.name : '壁纸已准备好'}</strong><p>{draft.config?.description || 'Codex 将根据壁纸的色调与主体，搭配整套界面。'}</p></div></div><label>风格偏好 <span className="optional">可选</span><input value={hint} maxLength={300} disabled={disabled} onChange={e=>setHint(e.target.value)} placeholder="例如：温暖柔和、保留山峰、深色界面"/></label><button type="button" className="primary full" disabled={disabled} onClick={() => run('正在启动适配', async () => { const next = await api('/skins/generate', { method: 'POST', body: { device, wallpaperId: draft.wallpaperId, hint, width: innerWidth, height: innerHeight } }); setJob(next); })}><Sparkles size={15}/>{draft.config ? '重新智能适配' : '让 Codex 智能适配'}</button><p className="field-hint">使用你的 Codex 账号和当前模型，会消耗模型额度。生成前请先连接支持图片的模型。</p>
        {draft.config && <><div className="appearance-swatches">{Object.entries(draft.config.palette).map(([key, color])=><span key={key} style={{background:color}} title={`${key}: ${color}`}/>)}<span>{draft.config.mode === 'dark' ? '深色' : '浅色'} · 已校正文字对比度</span></div><label>预设名称<input value={draft.config.name} maxLength={40} disabled={disabled} onChange={e=>adjust({...draft.config,name:e.target.value})}/></label><div className="appearance-controls"><label>画面适配<Select value={draft.config.wallpaper.fit} disabled={disabled} onChange={e=>adjust({...draft.config,wallpaper:{...draft.config.wallpaper,fit:e.target.value}})}><option value="cover">铺满 · 等比裁切</option><option value="contain">完整显示 · 保留全图</option></Select></label>{[['x','水平焦点',0,100],['y','垂直焦点',0,100],['shade','阅读遮罩',12,70]].map(([key,label,min,max])=><label key={key}>{label}<input type="range" min={min} max={max} disabled={disabled} value={key==='shade'?Math.round(draft.config.wallpaper[key]*100):draft.config.wallpaper[key]} onChange={e=>adjust({...draft.config,wallpaper:{...draft.config.wallpaper,[key]:Number(e.target.value)/(key==='shade'?100:1)}})}/></label>)}</div><div className="appearance-actions"><button type="button" className="secondary" disabled={disabled} onClick={()=>{setPreview(draft);setImmersive(true);}}><ImagePlus size={14}/>全页预览</button><button type="button" className="primary" disabled={disabled||!draft.config.name.trim()} onClick={save}><Check size={14}/>保存并应用</button></div></>}
        <button type="button" className="appearance-discard" disabled={disabled} onClick={()=>run('正在移除草稿',discard)}><X size={13}/>放弃这张壁纸</button></div>}
      {(busy || generating) && <div className="appearance-progress" role="status"><LoaderCircle size={17} className="spin"/><div><strong>{generating ? 'Codex 正在感受这张壁纸…' : busy}{busy==='正在上传壁纸' ? ` · ${progress}%` : ''}</strong><span>{generating ? '分析色调、选择构图、搭配界面。你可以关闭设置，稍后回来查看。' : '请稍候，完成后即可继续。'}</span></div></div>}
      {previewing && <div className="appearance-preview-notice" role="status"><span>正在预览，保存后才会生效</span><button type="button" onClick={()=>setPreview(null)}>退出预览</button></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </>}
    <div className="appearance-section-title"><h4>我的{target === 'mobile' ? '手机' : '桌面'}预设</h4><span>{presets.length} / 12</span></div>
    <div className="appearance-presets"><button type="button" className={`appearance-default ${!snapshot.active[target]?'selected':''}`} disabled={!editable||disabled} onClick={()=>run('正在还原默认',async()=>{onUpdate(await api('/skins/active',{method:'PUT',body:{device,presetId:null}}));setPreview(null);onReset();notify('已还原初始浅色外观');})}><span className="appearance-default-art"><RotateCcw size={22}/></span><strong>初始外观</strong><small>清爽蓝白 · 一键还原</small>{!snapshot.active[target]&&<Check size={15}/>}</button>{presets.map(p=><div className={`appearance-preset ${snapshot.active[target]===p.id?'selected':''}`} key={p.id}><button type="button" disabled={!editable||disabled} onClick={()=>run('正在应用预设',async()=>{onUpdate(await api('/skins/active',{method:'PUT',body:{device,presetId:p.id}}));setPreview(null);notify('外观已切换');})}><img src={p.imageUrl} alt=""/><strong>{p.config.name}</strong><small>{p.config.mode==='dark'?'深色':'浅色'} · {snapshot.active[target]===p.id?'使用中':'点击应用'}</small></button>{snapshot.active[target]===p.id&&<Check size={15}/>}<button type="button" className="appearance-preset-delete" aria-label={`删除预设 ${p.config.name}`} disabled={!editable||disabled} onClick={()=>run('正在删除预设',async()=>{onUpdate(await api(`/skins/presets/${p.id}`,{method:'DELETE'}));setPreview(null);notify('预设已删除');})}><Trash2 size={13}/></button></div>)}</div>
    <p className="field-hint appearance-footer">预设仅本人可见，随账号保存。切换预设无需再次调用 Codex。</p>
  </div>{immersive && <Modal title="外观预览" subtitle="尚未保存，应用后仅更新当前设备。" icon={Palette} className="appearance-full-modal" onClose={()=>setImmersive(false)} dismissible={!busy}><div className="appearance-full-actions"><button type="button" className="secondary" disabled={!!busy} onClick={()=>setImmersive(false)}>返回调整</button><button type="button" className="primary" disabled={!!busy} onClick={save}><Check size={14}/>{busy||'保存并应用'}</button></div>{error&&<p className="form-error" role="alert">{error}</p>}</Modal>}</>;
}
