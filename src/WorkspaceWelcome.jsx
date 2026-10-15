import { useEffect, useState } from 'react';
import { ArrowRight, Check, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import UserAvatar from './UserAvatar';

export default function WorkspaceWelcome({ user, ready = false, error, onContinue, onRetry, onExited }) {
  const [minimum, setMinimum] = useState(false), [slow, setSlow] = useState(false), [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMinimum(true), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900);
    const timeout = setTimeout(() => setSlow(true), 8000);
    return () => { clearTimeout(timer); clearTimeout(timeout); };
  }, []);
  useEffect(() => { if (ready && minimum) setLeaving(true); }, [ready, minimum]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(onExited, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420);
    return () => clearTimeout(timer);
  }, [leaving, onExited]);
  return <section className={`workspace-welcome ${leaving ? 'is-leaving' : ''}`} aria-label="进入工作区">
    <div className="entry-ambient" aria-hidden="true"><i/><i/></div>
    <div className="entry-brand"><Sparkles size={16}/> STARVALLEY <b>WORKSPACE</b></div>
    <div className="entry-content">
      <div className={`entry-portrait ${ready ? 'is-ready' : ''}`}><span className="entry-orbit" aria-hidden="true"/><span className="entry-orbit outer" aria-hidden="true"/><UserAvatar user={user}/><span className="entry-badge" aria-hidden="true">{ready ? <Check size={16}/> : <Sparkles size={16}/>}</span></div>
      <p className="entry-kicker">YOUR SPACE, YOUR NEXT IDEA</p>
      <h1>{user ? <>欢迎回来，<strong>{user.username}</strong></> : '美好的创造，即将开始'}</h1>
      <div className="entry-status" role="status" aria-live="polite">{error ? <span className="entry-error">{error}</span> : <>{ready ? <Check size={15}/> : <LoaderCircle size={15} className="spin"/>}<span>{ready ? '工作区已就绪，即将进入' : user ? '正在连接工作区…' : '正在验证登录状态…'}</span></>}</div>
      <div className={`entry-track ${ready ? 'is-ready' : ''}`} aria-hidden="true"><span/></div>
      <p className="entry-note">留一点空间，让想法自由生长。</p>
      {(error || slow && !ready) && onContinue && <div className="entry-recovery"><p>{error ? '可以重新连接，或先进入页面。' : '连接比平时稍久，正在继续尝试。'}</p><div><button type="button" className="secondary" onClick={onRetry}><RefreshCw size={14}/>重新连接</button><button type="button" className="text-button" onClick={onContinue}>先进入页面<ArrowRight size={14}/></button></div></div>}
    </div>
    <footer className="entry-footer"><span className="entry-dot"/>属于你的独立工作区</footer>
  </section>;
}
