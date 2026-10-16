import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import Modal from './Modal';

const requestKey = request => String(request.id);
function title(request) {
  return request.method.includes('commandExecution') ? '允许执行这条命令？' : request.method.includes('permissions') ? '允许授予这些权限？' : request.method.includes('elicitation') ? '工具需要你的确认' : '允许这些文件更改？';
}

export default function ApprovalRequests({ requests, socket, status, threads, onDone }) {
  const [deferred, setDeferred] = useState(new Set());
  const current = requests.find(request => !deferred.has(requestKey(request)));
  useEffect(() => { setDeferred(previous => new Set([...previous].filter(id => requests.some(request => requestKey(request) === id)))); }, [requests]);
  return <>
    {requests.map(request => <div className="approval-notice" key={request.id} role="status"><ShieldCheck size={16}/><span>Codex 正在等待批准<small>{threads.find(thread => thread.id === request.params?.threadId)?.title || '执行请求'}</small></span><button type="button" onClick={() => setDeferred(previous => { const next = new Set(previous); next.delete(requestKey(request)); return next; })}>查看请求</button></div>)}
    {current && <ApprovalDialog key={current.id} request={current} socket={socket} status={status} threadTitle={threads.find(thread => thread.id === current.params?.threadId)?.title} onDone={() => onDone(current.id)} onClose={() => setDeferred(previous => new Set([...previous, requestKey(current)]))}/>}
  </>;
}

function ApprovalDialog({ request, socket, status, threadTitle, onDone, onClose }) {
  const [busy, setBusy] = useState(false), [raw, setRaw] = useState(''), [error, setError] = useState('');
  const pending = useRef(false), closing = useRef(false), p = request.params || {};
  const permissions = request.method.includes('permissions'), elicitation = request.method.includes('elicitation');
  async function reply(accept) {
    if (pending.current || closing.current || status !== 'connected') return;
    pending.current = true; setBusy(true); setError('');
    try {
      let result;
      if (permissions) result = { permissions: accept ? p.permissions : {}, scope: 'turn' };
      else if (elicitation) result = { action: accept ? 'accept' : 'decline', content: accept && raw ? JSON.parse(raw) : null };
      else result = { decision: accept ? 'accept' : 'decline' };
      await socket.call('approval/reply', { requestId: request.id, result }); onDone();
    } catch (e) { setError(e.message || '提交失败，请重试'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Modal title={title(request)} subtitle={threadTitle ? `对话：${threadTitle}` : 'Codex 已暂停此操作，正在等待你的决定。'} icon={ShieldCheck} role="alertdialog" className="approval-dialog" dismissible={!busy} onRequestClose={() => { closing.current = true; }} onClose={onClose}>
    <div className="approval-body">
      {p.reason && <p>{p.reason}</p>}
      {p.cwd && <div className="approval-directory"><span>工作目录</span><code>{p.cwd}</code></div>}
      {p.command && <pre>{Array.isArray(p.command) ? p.command.join(' ') : p.command}</pre>}
      {p.grantRoot && <div className="approval-directory"><span>文件访问目录</span><code>{p.grantRoot}</code></div>}
      {permissions && <pre>{JSON.stringify(p.permissions, null, 2)}</pre>}
      {elicitation && <><p>{p.message}</p>{p.url && <a className="secondary" href={p.url} target="_blank" rel="noreferrer">打开授权页面</a>}{p.requestedSchema && <><pre>{JSON.stringify(p.requestedSchema, null, 2)}</pre><label>确认内容<textarea value={raw} onChange={e => setRaw(e.target.value)} placeholder="以 JSON 格式填写工具所需内容" disabled={busy}/></label></>}</>}
      {status !== 'connected' && <p role="status">连接恢复后即可提交决定。</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <footer className="approval-dialog-actions"><button type="button" className="secondary" disabled={busy || status !== 'connected'} onClick={() => reply(false)}>拒绝</button><button type="button" className="primary" disabled={busy || status !== 'connected'} onClick={() => reply(true)}>{busy && <LoaderCircle size={14} className="spin"/>}{busy ? '提交中…' : '允许这一次'}</button></footer>
  </Modal>;
}
