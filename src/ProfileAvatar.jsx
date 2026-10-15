import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle, RotateCcw, Upload } from 'lucide-react';
import UserAvatar from './UserAvatar';
import { AVATAR_SIZE, AVATAR_MAX_BYTES, AVATAR_SOURCE_MAX_BYTES, AVATAR_MAX_PIXELS, avatarCrop, avatarDimensions } from '../shared/avatar.js';
import { roleName } from './UserManagement';

async function loadImage(file) {
  if (!file.size || file.size > AVATAR_SOURCE_MAX_BYTES) throw new Error('请选择不超过 5 MB 的图片');
  avatarDimensions(new Uint8Array(await file.arrayBuffer()));
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url;
    try { await image.decode(); } catch { throw new Error('图片无法读取，请选择其他图片'); }
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) throw new Error('图片无法读取，请选择其他图片');
    if (width * height > AVATAR_MAX_PIXELS || Math.max(width, height) > 8192) throw new Error('图片过大，请缩小至 1600 万像素以内，且单边不超过 8192 像素');
    return { url, image, width, height };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

export default function ProfileAvatar({ user, socket, api, onUpdate, notify, Dialog }) {
  const picker = useRef(), generation = useRef(0), sourceRef = useRef(), controller = useRef(), pending = useRef(false);
  const [source, setSource] = useState(null), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [removing, setRemoving] = useState(false), [error, setError] = useState('');
  useEffect(() => () => { ++generation.current; URL.revokeObjectURL(sourceRef.current?.url); controller.current?.abort(); }, []);
  function close() { ++generation.current; URL.revokeObjectURL(sourceRef.current?.url); sourceRef.current = null; setSource(null); setError(''); }
  async function choose(file) {
    if (!file || pending.current) return;
    const request = ++generation.current; setLoading(true); setError('');
    try {
      const next = await loadImage(file);
      if (request !== generation.current) { URL.revokeObjectURL(next.url); return; }
      URL.revokeObjectURL(sourceRef.current?.url); sourceRef.current = next; setSource(next);
    } catch (e) { if (request === generation.current) setError(e.message || '图片无法读取，请选择其他图片'); }
    finally { if (request === generation.current) setLoading(false); }
  }
  async function save(crop) {
    if (pending.current) return;
    pending.current = true; setSaving(true); setError(''); controller.current = new AbortController();
    try {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = AVATAR_SIZE;
      const context = canvas.getContext('2d'); context.imageSmoothingQuality = 'high';
      context.drawImage(source.image, crop.x, crop.y, crop.side, crop.side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob || blob.size > AVATAR_MAX_BYTES) throw new Error('裁剪后的头像超过 256 KB，请选择较简单的图片');
      const [result] = await socket.upload({ scope: 'avatar' }, [new File([blob], 'avatar.png', { type: 'image/png' })], () => {}, controller.current.signal);
      onUpdate(result.avatarUrl); close(); notify('头像已更新');
    } catch (e) { setError(e.message); }
    finally { pending.current = false; setSaving(false); controller.current = null; }
  }
  async function remove() {
    if (pending.current) return;
    pending.current = true; setRemoving(true); setError('');
    try { const result = await api('/avatar', { method: 'DELETE' }); onUpdate(result.avatarUrl); notify('已恢复默认头像'); }
    catch (e) { setError(e.message); }
    finally { pending.current = false; setRemoving(false); }
  }
  return <div className="profile-avatar-section">
    <div className="profile-info"><button type="button" className="profile-avatar-button" aria-label="更换头像" disabled={loading || saving || removing} onClick={() => picker.current.click()}><UserAvatar user={user}/><span className="avatar-camera"><Camera size={12}/></span></button><div><strong>{user.username}</strong><p>{roleName(user.role)}</p></div></div>
    <div className="avatar-actions"><button type="button" className="secondary" disabled={loading || saving || removing} onClick={() => picker.current.click()}>{loading ? <LoaderCircle size={14} className="spin"/> : <Upload size={14}/>}更换头像</button>{user.avatarUrl && <button type="button" className="text-button" disabled={loading || saving || removing} onClick={remove}>{removing ? '正在恢复…' : '恢复默认'}</button>}</div>
    <p className="field-hint avatar-hint">支持 JPG、PNG、WebP，最大 5 MB。裁剪后保存为 256 × 256，最多 256 KB。</p>
    {!source && error && <p className="form-error" role="alert">{error}</p>}
    <input hidden ref={picker} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { choose(e.target.files?.[0]); e.target.value = ''; }}/>
    {source && <AvatarCropper key={source.url} source={source} saving={saving} error={error} onSave={save} onClose={close} Dialog={Dialog}/>}
  </div>;
}

function AvatarCropper({ source, saving, error, onSave, onClose, Dialog }) {
  const [zoom, setZoom] = useState(1), [position, setPosition] = useState({ x: 0, y: 0 }), view = useRef(), drag = useRef();
  const crop = avatarCrop(source.width, source.height, zoom, position);
  function move(dx, dy, start = position) {
    const scale = crop.side / view.current.getBoundingClientRect().width;
    setPosition({ x: crop.travelX ? Math.max(-1, Math.min(1, start.x + dx * scale / crop.travelX)) : 0, y: crop.travelY ? Math.max(-1, Math.min(1, start.y + dy * scale / crop.travelY)) : 0 });
  }
  return <Dialog title="裁剪头像" subtitle="拖动图片调整位置，缩放到喜欢的构图。" dismissible={!saving} onClose={onClose}>
    <div className="avatar-cropper" aria-busy={saving}>
      <div ref={view} className="avatar-crop-view" role="group" tabIndex={saving ? -1 : 0} aria-label="头像裁剪区域" aria-describedby="avatar-crop-help" aria-disabled={saving}
        onPointerDown={e => { if (saving || e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, position }; }}
        onPointerMove={e => { if (saving || drag.current?.id !== e.pointerId) return; move(e.clientX - drag.current.x, e.clientY - drag.current.y, drag.current.position); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={e => { const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!direction || saving) return; e.preventDefault(); move(direction[0] * (e.shiftKey ? 20 : 5), direction[1] * (e.shiftKey ? 20 : 5)); }}>
        <img src={source.url} alt="" draggable="false" style={{ width: `${source.width / crop.side * 100}%`, height: `${source.height / crop.side * 100}%`, left: `${-crop.x / crop.side * 100}%`, top: `${-crop.y / crop.side * 100}%` }}/><span className="avatar-crop-mask"/>
      </div>
      <p id="avatar-crop-help" className="avatar-crop-help">圆形区域为头像预览，也可用方向键移动。</p>
      <label className="avatar-zoom">缩放 <input type="range" min="1" max="3" step="0.01" aria-label="头像缩放" disabled={saving} value={zoom} onChange={e => setZoom(Number(e.target.value))}/><output>{Math.round(zoom * 100)}%</output></label>
      <button type="button" className="text-button avatar-reset" disabled={saving} onClick={() => { setZoom(1); setPosition({ x: 0, y: 0 }); }}><RotateCcw size={13}/>重置位置</button>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="avatar-crop-actions"><button type="button" className="secondary" disabled={saving} onClick={onClose}>取消</button><button type="button" className="primary" disabled={saving} onClick={() => onSave(crop)}>{saving ? <LoaderCircle size={15} className="spin"/> : <Camera size={15}/>} {saving ? '正在保存…' : '保存头像'}</button></div>
    </div>
  </Dialog>;
}
