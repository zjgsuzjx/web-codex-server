import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
export default function TerminalView({ socket, project, notify, theme = 'light' }) {
  const container = useRef();
  useEffect(() => {
    let disposed = false, ready = false, input = '', timer;
    const term = new Terminal({ fontSize: 12, fontFamily: "Consolas, 'Cascadia Code', monospace", cursorBlink: true, scrollback: 3000, theme: theme === 'light' ? { background: '#ffffff', foreground: '#172d50', cursor: '#2563eb', selectionBackground: '#c8dcff' } : { background: '#101b30', foreground: '#e8efff', cursor: '#86afff', selectionBackground: '#32547e' } });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(container.current); fit.fit();
    const unsubscribe = socket.subscribe(msg => { if (msg.type === 'terminal/data') { const raw = atob(msg.data); term.write(Uint8Array.from(raw, c => c.charCodeAt(0))); } if (msg.type === 'terminal/closed') { ready = false; term.writeln('\r\n[终端已关闭]'); } });
    const data = term.onData(text => { if (!ready) return; input += text; if (!timer) timer = setTimeout(() => { const chunk = input; input = ''; timer = null; socket.call('terminal/input', { data: chunk }).catch(e => notify(e.message, true)); }, 35); });
    const observer = new ResizeObserver(() => { fit.fit(); if (ready) socket.call('terminal/resize', { cols: term.cols, rows: term.rows }).catch(() => {}); }); observer.observe(container.current);
    socket.call('terminal/start', { projectId: project.id, cols: term.cols, rows: term.rows }).then(() => { if (disposed) socket.call('terminal/stop').catch(() => {}); else { ready = true; term.focus(); } }).catch(e => { term.writeln(e.message); notify(e.message, true); });
    return () => { disposed = true; clearTimeout(timer); unsubscribe(); data.dispose(); observer.disconnect(); term.dispose(); socket.call('terminal/stop').catch(() => {}); };
  }, [project.id, theme]);
  return <div className="live-terminal" ref={container}/>;
}
