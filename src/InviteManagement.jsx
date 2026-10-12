import { useEffect, useState } from 'react';
import { Copy, Plus, RefreshCw } from 'lucide-react';
import LoadingPlaceholder from './LoadingPlaceholder';

export default function InviteManagement({api, notify}) {
  const [invites,setInvites]=useState(null),[label,setLabel]=useState(''),[days,setDays]=useState(7),[created,setCreated]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const load = () => api('/admin/invites').then(setInvites);
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function run(fn) {setBusy(true);try{await fn();await load();}catch(e){notify(e.message,true);}finally{setBusy(false);}}
  return <div className="invite-management"><h3>邀请码</h3><p className="field-hint">生成单次使用的邀请码，可查看注册用户和使用时间。完整邀请码只在生成时显示一次。</p>
    <form onSubmit={e=>{e.preventDefault();run(async()=>{setCreated(await api('/admin/invites',{method:'POST',body:{label,days:Number(days)}}));setLabel('');});}}><div className="field-row"><label>备注<input value={label} onChange={e=>setLabel(e.target.value)} maxLength={80} placeholder="例如：设计团队"/></label><label>有效天数<input type="number" min="1" max="90" required value={days} onChange={e=>setDays(e.target.value)}/></label></div><button className="secondary" disabled={busy}><Plus size={14}/>生成邀请码</button><button type="button" className="secondary" disabled={busy} onClick={()=>run(load)}><RefreshCw size={14}/>刷新</button></form>
    {created&&<div className="invite-created"><p>请复制并妥善交给注册用户</p><code>{created.code}</code><button type="button" className="secondary" onClick={()=>navigator.clipboard.writeText(created.code).then(()=>notify('邀请码已复制')).catch(()=>notify('复制失败，请手动复制',true))}><Copy size={13}/>复制邀请码</button></div>}
    {invites ? <div className="invite-list">{invites.length ? invites.map(i=><div className="invite-row" key={i.id}><div><strong>{i.label||'未备注'}</strong><small>{i.usedBy ? `已由 ${i.usedBy} 注册 · ${new Date(i.used_at).toLocaleString('zh-CN')}` : i.revoked ? '已撤销' : i.expires<Date.now() ? '已过期' : `待使用 · ${new Date(i.expires).toLocaleDateString('zh-CN')} 到期`}</small></div>{!i.usedBy&&!i.revoked&&i.expires>Date.now()&&<button type="button" className="danger-text" disabled={busy} onClick={()=>run(()=>api(`/admin/invites/${i.id}`,{method:'DELETE'}))}>撤销</button>}</div>) : <p className="field-hint">还没有生成邀请码。</p>}</div> : error ? <p className="form-error">{error}</p> : <LoadingPlaceholder label="正在读取邀请码…" rows={3}/>}
  </div>;
}
