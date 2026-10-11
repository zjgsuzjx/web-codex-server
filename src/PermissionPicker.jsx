import Select from './Select';
import { memo, useEffect, useRef, useState } from 'react';
import { ShieldCheck, ChevronDown, X } from 'lucide-react';
const labels = { untrusted: '谨慎执行', 'on-request': '按需批准', never: '自动执行' };
export default memo(function PermissionPicker({ settings, nestedSandbox, role, hostExecution, onChange, disabled }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [position, setPosition] = useState({}), root = useRef();
  useEffect(() => {
    if (!open) return;
    const close = e => { if (e.key === 'Escape' || (e.type === 'pointerdown' && !root.current.contains(e.target))) setOpen(false); };
    const resized=()=>setOpen(false);
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);window.addEventListener('resize',resized);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close);window.removeEventListener('resize',resized); };
  }, [open]);
  async function change(key, value) { setBusy(true); try { await onChange({ ...settings, [key]: value, ...(key==='executionTarget'&&value==='server'?{sandbox:'dangerFullAccess',networkAccess:true}:{}) }); } catch {} finally { setBusy(false); } }
  function toggle() { const rect = root.current.getBoundingClientRect(), width = Math.min(290, window.innerWidth - 24); setPosition({ position: 'fixed', width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), bottom: window.innerHeight - rect.top + 10 }); setOpen(!open); }
  return <div className="permission-picker" ref={root}>
    <button type="button" className={`permission-button ${settings.executionTarget==='server'?'server-mode':''}`} aria-expanded={open} aria-controls="chat-permissions" onClick={toggle}><ShieldCheck size={14}/><span>{settings.executionTarget==='server'?'服务器 · root':labels[settings.approvalPolicy]}</span><ChevronDown size={12}/></button>
    {open && <section className="permission-menu" style={position} id="chat-permissions" aria-label="聊天执行权限"><header><strong>执行权限</strong><button type="button" aria-label="关闭权限选择" onClick={() => setOpen(false)}><X size={15}/></button></header>
      <fieldset disabled={disabled || busy}>{role==='superadmin'&&<label>执行环境<Select aria-label="执行环境" disabled={disabled||busy} value={settings.executionTarget||'workspace'} onChange={e=>change('executionTarget',e.target.value)}><option value="workspace">我的用户工作区</option><option value="server" disabled={!hostExecution}>服务器 · root 权限</option></Select></label>}<label>命令审批<Select disabled={disabled||busy} value={settings.approvalPolicy} onChange={e => change('approvalPolicy', e.target.value)}><option value="untrusted">谨慎 · 不可信命令需批准</option><option value="on-request">标准 · 需要时询问</option><option value="never">自动执行</option></Select></label>
        <label>文件访问<Select disabled={disabled||busy||settings.executionTarget==='server'} value={settings.sandbox} onChange={e => change('sandbox', e.target.value)}><option value="dangerFullAccess">{settings.executionTarget==='server'?'整台服务器（含系统文件）':'我的独立用户容器'}</option><option value="workspaceWrite" disabled={!nestedSandbox}>当前项目（此服务器暂不支持）</option><option value="readOnly" disabled={!nestedSandbox}>只读（此服务器暂不支持）</option></Select></label></fieldset>
      <p>{settings.executionTarget==='server'?'服务器模式：Codex 和终端拥有真实 root 权限，可修改系统文件和服务。':'Codex 只能访问你自己的项目和配置，不能修改服务器系统文件。切换执行环境前需停止任务并关闭终端。'}</p>{busy && <span className="permission-saving" role="status">正在保存…</span>}
    </section>}
  </div>;
});
