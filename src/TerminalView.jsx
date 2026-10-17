import { useEffect, useRef, useState } from 'react';
import LoadingPlaceholder from './LoadingPlaceholder';
import { appearanceColors } from './appearance-runtime';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
export default function TerminalView({ socket, project, notify }) {
  const container = useRef();
  const [connecting, setConnecting] = useState(true);
  useEffect(() => {
    setConnecting(true);
    let disposed = false, ready = false, input = '', timer;
    const colors = () => { const c = appearanceColors(); return { background: c.background, foreground: c.foreground, cursor: c.accent, selectionBackground: c.selection }; };
    const term = new Terminal({ fontSize: 12, fontFamily: "Consolas, 'Cascadia Code', monospace", cursorBlink: true, scrollback: 3000, theme: colors() });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(container.current); fit.fit();
    const recolor = () => { term.options.theme = colors(); };
    recolor(); window.addEventListener('appearancechange', recolor);
    const unsubscribe = socket.subscribe(msg => { if (msg.type === 'terminal/data') { const raw = atob(msg.data); term.write(Uint8Array.from(raw, c => c.charCodeAt(0))); } if (msg.type === 'terminal/closed') { ready = false; term.writeln('\r\n[终端已关闭]'); } });
    const data = term.onData(text => { if (!ready) return; input += text; if (!timer) timer = setTimeout(() => { const chunk = input; input = ''; timer = null; socket.call('terminal/input', { data: chunk }).catch(e => notify(e.message, true)); }, 35); });
    const observer = new ResizeObserver(() => { fit.fit(); if (ready) socket.call('terminal/resize', { cols: term.cols, rows: term.rows }).catch(() => {}); }); observer.observe(container.current);
    socket.call('terminal/start', { projectId: project.id, cols: term.cols, rows: term.rows }).then(() => { if (disposed) socket.call('terminal/stop').catch(() => {}); else { ready = true; setConnecting(false); term.focus(); } }).catch(e => { if (disposed) return; setConnecting(false); term.writeln(e.message); notify(e.message, true); });
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('appearancechange', recolor); unsubscribe(); data.dispose(); observer.disconnect(); term.dispose(); socket.call('terminal/stop').catch(() => {}); };
  }, [project.id]);
  return <div className="live-terminal"><div className="terminal-surface" ref={container} aria-busy={connecting}/>{connecting&&<div className="terminal-loading"><LoadingPlaceholder label="正在连接终端…" variant="code" rows={8}/></div>}</div>;
}
