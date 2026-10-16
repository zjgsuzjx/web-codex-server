import Select from './Select';
import { memo, useEffect, useRef, useState } from 'react';
import { Hand, ShieldCheck, ShieldAlert, ChevronDown, X } from 'lucide-react';
const permissions = { untrusted: { label: '请求批准', icon: Hand }, 'on-request': { label: '帮我批准', icon: ShieldCheck }, never: { label: '完全访问权限', icon: ShieldAlert } };
export default memo(function PermissionPicker({ settings, role, hostExecution, onChange, disabled }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [position, setPosition] = useState({}), root = useRef(), pending = useRef(false);
  const current = permissions[settings.approvalPolicy] || permissions['on-request'], fullAccess = settings.approvalPolicy === 'never' || settings.executionTarget === 'server', Icon = current.icon;
  useEffect(() => {
    if (!open) return;
    const close = e => { if (e.key === 'Escape' || (e.type === 'pointerdown' && !root.current.contains(e.target))) setOpen(false); };
    const resized=()=>setOpen(false);
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);window.addEventListener('resize',resized);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close);window.removeEventListener('resize',resized); };
  }, [open]);
  async function change(key, value) { if (pending.current || disabled) return; pending.current = true; setBusy(true); try { await onChange({ ...settings, [key]: value, ...(key==='executionTarget'&&value==='server'?{sandbox:'dangerFullAccess',networkAccess:true}:{}) }); } catch {} finally { pending.current = false; setBusy(false); } }
  function toggle() { const rect = root.current.getBoundingClientRect(), width = Math.min(290, window.innerWidth - 24); setPosition({ position: 'fixed', width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), bottom: window.innerHeight - rect.top + 10 }); setOpen(!open); }
  return <div className="permission-picker" ref={root}>
    <button type="button" className={`permission-button ${fullAccess ? 'full-access' : ''}`} aria-expanded={open} aria-controls="chat-permissions" onClick={toggle}><Icon size={15}/><span>{settings.executionTarget==='server'?'服务器 · root':current.label}</span><ChevronDown size={12}/></button>
    {open && <section className="permission-menu" style={position} id="chat-permissions" aria-label="聊天执行权限"><header><strong>执行权限</strong><button type="button" aria-label="关闭权限选择" onClick={() => setOpen(false)}><X size={15}/></button></header>
      <fieldset disabled={disabled || busy}>{role==='superadmin'&&<label>执行环境<Select aria-label="执行环境" disabled={disabled||busy} value={settings.executionTarget||'workspace'} onChange={e=>change('executionTarget',e.target.value)}><option value="workspace">我的用户工作区</option><option value="server" disabled={!hostExecution}>服务器 · root 权限</option></Select></label>}<label>命令审批<Select disabled={disabled||busy} value={settings.approvalPolicy} onChange={e => change('approvalPolicy', e.target.value)}>{Object.entries(permissions).map(([value, permission]) => <option key={value} value={value}>{permission.label}</option>)}</Select></label></fieldset>
      {busy && <span className="permission-saving" role="status">正在应用…</span>}
    </section>}
  </div>;
});
