import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import UserInputRequest from './UserInputRequest';

export default function UserInputRequests({ requests, socket, status, drafts, onDraft, onDone, threads, enabled = true }) {
  const [deferred, setDeferred] = useState(new Set());
  const pending = requests;
  const current = pending.find(request => !deferred.has(String(request.id)));
  const keys = pending.map(request => String(request.id)).join('\n');
  useEffect(() => { const active = new Set(keys.split('\n')); setDeferred(previous => new Set([...previous].filter(id => active.has(id)))); }, [keys]);
  return <>
    {pending.map(request => <div className="approval-notice" key={request.id} role="status"><MessageCircle size={16}/><span>Codex 正在等待你的回答<small>{threads.find(thread => thread.id === request.params?.threadId)?.title || '问答请求'}</small></span><button type="button" onClick={() => setDeferred(previous => { const next = new Set(previous); next.delete(String(request.id)); return next; })}>回答问题</button></div>)}
    {enabled && current && <UserInputRequest key={current.id} request={current} socket={socket} status={status} draft={drafts[current.id]} onDraft={draft => onDraft(current.id, draft)} onDone={() => onDone(current.id)} threadTitle={threads.find(thread => thread.id === current.params?.threadId)?.title} onClose={() => setDeferred(previous => new Set([...previous, String(current.id)]))}/>}
  </>;
}
