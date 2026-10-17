import { CircleAlert, LoaderCircle, LockKeyhole, RefreshCw } from 'lucide-react';
import Tooltip from './Tooltip';
import { connectionIndicator } from './connection-state';

function SignalBars({ offline = false, level = 0 }) {
  return <svg className="signal-glyph" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    {[5, 9, 13].map((height, index) => <rect key={height} className={`signal-bar ${index < level ? 'filled' : ''}`} x={4 + index * 6} y={18 - height} width="4" height={height} rx="1.2"/>)}
    {offline && <path className="signal-slash" d="M4 4 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>}
  </svg>;
}

export default function ConnectionSignal({ status, latency }) {
  const view = connectionIndicator(status, latency);
  const Icon = { connecting: LoaderCircle, reconnecting: RefreshCw, timeout: CircleAlert, expired: LockKeyhole }[view.state];
  return <>
    <Tooltip title={view.title} description={view.description}>
      <button type="button" className={`connection-signal signal-${view.level}`} data-state={view.state} aria-label={view.title}>
        {Icon ? <Icon className={view.state === 'connecting' || view.state === 'reconnecting' ? 'signal-spinner' : ''} size={19} strokeWidth={1.75} aria-hidden="true"/> : <SignalBars offline={view.state === 'disconnected'} level={view.level}/>}
      </button>
    </Tooltip>
    <span className="signal-announcement" role="status" aria-atomic="true">{view.announcement}</span>
  </>;
}
