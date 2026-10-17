import { LockKeyhole, RefreshCw } from 'lucide-react';
import Tooltip from './Tooltip';
import { connectionIndicator } from './connection-state';

function SignalBars({ level }) {
  return <span className="signal-bars" aria-hidden="true">
    {[0, 1, 2, 3].map(index => <i key={index} className={index < level ? 'is-on' : undefined}/>)}
  </span>;
}

export default function ConnectionSignal({ status, latency, onRetry }) {
  const view = connectionIndicator(status, latency);
  const retry = view.state === 'disconnected' && onRetry;
  const card = <div className="signal-card" data-state={view.state} data-quality={view.quality}>
    <div className="signal-card-heading"><i aria-hidden="true"/>{view.heading}</div>
    {view.state === 'connected' ? <>
      <div className="signal-card-row"><b className="signal-card-ms">{view.latency}<small>ms</small></b><span className="signal-card-quality">{view.qualityLabel}</span></div>
      <p className="signal-card-note">{view.description}</p>
    </> : <p className="signal-card-detail">{view.state === 'disconnected' && !retry ? '暂时无法连接服务器，将自动重试。' : view.description}</p>}
  </div>;
  return <>
    <Tooltip title={view.title} content={card} variant="connection">
      <button type="button" className="workspace-tool connection-signal" data-state={view.state} data-quality={view.quality} aria-label={`${view.title}${retry ? '，点击重试连接' : ''}`} onClick={retry || undefined}>
        <SignalBars level={view.level}/>
        {view.state === 'disconnected' && <span className="signal-error-dot" aria-hidden="true"/>}
        {view.state === 'reconnecting' && <span className="signal-state-badge" aria-hidden="true"><RefreshCw size={8}/></span>}
        {view.state === 'timeout' && <span className="signal-state-badge" aria-hidden="true">!</span>}
        {view.state === 'expired' && <span className="signal-state-badge" aria-hidden="true"><LockKeyhole size={8}/></span>}
      </button>
    </Tooltip>
    <span className="signal-announcement" role="status" aria-atomic="true">{view.announcement}</span>
  </>;
}
