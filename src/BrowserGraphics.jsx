import { createContext, useContext, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Monitor, RefreshCw, X } from 'lucide-react';
import { browserGraphicsGuide, detectBrowserGraphics } from '../shared/browser-graphics.js';
import Modal from './Modal';

const GraphicsContext = createContext();
const labels = {
  hardware: '检测到 GPU 渲染',
  software: '检测到软件渲染，建议检查图形加速',
  unavailable: 'WebGL 不可用，建议检查浏览器设置',
  unknown: '无法自动确认图形加速状态',
};

export function BrowserGraphicsProvider({ children }) {
  const [result, setResult] = useState(null), [revision, setRevision] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setResult(detectBrowserGraphics()), 0);
    return () => clearTimeout(timer);
  }, [revision]);
  function refresh() { setResult(null); setRevision(value => value + 1); }
  return <GraphicsContext.Provider value={{ result, refresh }}>{children}</GraphicsContext.Provider>;
}

export function BrowserGraphicsCheck() {
  const { result, refresh } = useContext(GraphicsContext);
  const [copyStatus, setCopyStatus] = useState('');
  const guide = browserGraphicsGuide(navigator.userAgent);
  const Icon = result === 'hardware' ? CheckCircle2 : Monitor;
  return <section className="browser-graphics-check" aria-label="浏览器图形加速">
    <div className="graphics-result" data-state={result || 'checking'} role="status"><Icon size={21}/><strong>{result ? labels[result] : '正在检查图形渲染…'}</strong></div>
    <p>网页无法直接读取“使用图形加速（如果可用）”开关。{result === 'hardware' ? '当前 WebGL 使用 GPU 渲染；若页面仍卡顿，请检查下面的浏览器设置。' : result === 'software' ? '当前 WebGL 使用软件渲染，可能是图形加速未开启，也可能与显卡驱动或浏览器策略有关。' : result === 'unavailable' ? '浏览器未提供 WebGL，可能与图形加速、隐私设置、显卡驱动或浏览器策略有关。' : '浏览器可能隐藏了渲染信息，请按下面的步骤手动确认。'}</p>
    <ol>
      <li>打开 {guide.name} 的{guide.path}。</li>
      <li>确认“使用图形加速（如果可用）”已开启；如果未开启，请将它打开。</li>
      <li><strong>保存未提交的编辑内容，再点击浏览器的“重启”或“重新启动”使更改生效。</strong>只刷新网页不会应用该设置。</li>
    </ol>
    {guide.address && <div className="graphics-address"><input aria-label="浏览器设置地址" readOnly value={guide.address} onFocus={event => event.target.select()}/><button type="button" className="secondary" onClick={async () => {
      try { await navigator.clipboard.writeText(guide.address); setCopyStatus('设置地址已复制，请粘贴到浏览器地址栏。'); }
      catch { setCopyStatus('复制失败，请选中并手动复制设置地址。'); }
    }}><Copy size={14}/>复制地址</button></div>}
    <p className="field-hint">{guide.address ? '将设置地址粘贴到地址栏打开。' : '部分浏览器或移动设备没有此开关，请以浏览器提供的设置为准。'}网页无法替你修改此设置或重启浏览器。</p>
    <p className="graphics-copy-status" role="status">{copyStatus}</p>
    <button type="button" className="secondary" disabled={!result} onClick={refresh}><RefreshCw size={14} className={!result ? 'spin' : ''}/>重新检测</button>
  </section>;
}

export function BrowserGraphicsNotice() {
  const { result } = useContext(GraphicsContext);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('graphics-notice-dismissed') === '1'; } catch { return false; }
  });
  const [open, setOpen] = useState(false);
  function dismiss() {
    setDismissed(true);
    try { sessionStorage.setItem('graphics-notice-dismissed', '1'); } catch { /* In-memory dismissal still works. */ }
  }
  return <>{!dismissed && (result === 'software' || result === 'unavailable') && <aside className="graphics-notice" aria-label="图形加速提醒">
    <AlertTriangle size={18}/><div role="status"><strong>建议检查浏览器图形加速</strong><p>{result === 'software' ? '检测到软件渲染，页面动效可能卡顿。' : 'WebGL 不可用，可能影响页面流畅度。'}请确认图形加速已开启，修改后需重启浏览器。</p></div>
    <button type="button" className="secondary" onClick={() => setOpen(true)}>查看开启方法</button><button type="button" className="icon-button" aria-label="本次不再提醒图形加速" onClick={dismiss}><X size={16}/></button>
  </aside>}{open && <Modal title="检查浏览器图形加速" icon={Monitor} onClose={() => setOpen(false)}><BrowserGraphicsCheck/></Modal>}</>;
}
