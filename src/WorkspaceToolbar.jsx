import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Code2, Moon, MoreHorizontal, Palette, Settings, Sun, Terminal } from 'lucide-react';
import ConnectionSignal from './ConnectionSignal';
import Tooltip from './Tooltip';

function ToolButton({ label, description, icon: Icon, children, buttonRef, disabled, ...props }) {
  return <Tooltip title={label} description={description} disabled={disabled}>
    <button type="button" className="workspace-tool" aria-label={label} ref={buttonRef} disabled={disabled} {...props}>
      <Icon size={17} strokeWidth={1.75}/>{children}
    </button>
  </Tooltip>;
}

function MoreTools({ theme, customSkin, onAppearance, onTheme, onTerminal, hasProject }) {
  const [open, setOpen] = useState(false);
  const root = useRef(), trigger = useRef(), menu = useRef(), firstItem = useRef(0), id = useId();
  const ThemeIcon = theme === 'dark' ? Moon : Sun;
  const themeLabel = `切换到${theme === 'dark' ? '浅色' : '深色'}主题`;
  const items = () => [...menu.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
  useLayoutEffect(() => { if (open) items().at(firstItem.current)?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current.contains(event.target)) setOpen(false); };
    const resize = () => {
      // A breakpoint can hide the focused item before the resize event arrives.
      if (root.current.contains(document.activeElement) || document.activeElement === document.body) {
        if (window.matchMedia('(min-width: 641px)').matches) document.querySelector('.workspace-toolbar [aria-label="壁纸与外观"]')?.focus();
        else trigger.current.focus();
      }
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('resize', resize);
    };
  }, [open]);
  function run(action) {
    setOpen(false);
    trigger.current.focus();
    action();
  }
  function keydown(event) {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current.focus();
    } else if (event.key === 'Tab' && open) {
      setOpen(false); trigger.current.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) { firstItem.current = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 0; setOpen(true); return; }
      const buttons = items(), index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }
  return <div className="workspace-more" ref={root} onKeyDown={keydown}>
    <button type="button" className="workspace-tool" ref={trigger} title="更多工具" aria-label="更多工具" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { firstItem.current = 0; setOpen(!open); }}><MoreHorizontal size={18} strokeWidth={1.75}/></button>
    {open && <div className="workspace-tool-menu" id={id} role="menu" aria-label="更多工作区工具" ref={menu}>
      <div className="workspace-menu-heading" aria-hidden="true">工作区工具</div>
      <button type="button" role="menuitem" onClick={() => run(onAppearance)}><Palette size={17} strokeWidth={1.75}/><span>壁纸与外观</span></button>
      {!customSkin && <button type="button" role="menuitem" onClick={() => run(onTheme)}><ThemeIcon size={17} strokeWidth={1.75}/><span>{themeLabel}</span></button>}
      <div className="workspace-menu-divider" role="separator"/>
      <button type="button" role="menuitem" disabled={!hasProject} onClick={() => run(onTerminal)}><Terminal size={17} strokeWidth={1.75}/><span>网页终端{!hasProject && <small>请先选择项目</small>}</span></button>
    </div>}
  </div>;
}

export default function WorkspaceToolbar({ theme, customSkin, status, latency, hasProject, editor, editorToggle, settingsDisabled, onAppearance, onTheme, onTerminal, onEditor, onSettings }) {
  const ThemeIcon = theme === 'dark' ? Moon : Sun;
  return <div className="workspace-toolbar" role="group" aria-label="工作区工具">
    <div className="workspace-tool-group workspace-appearance-tools" role="group" aria-label="外观">
      <ToolButton label="壁纸与外观" description="壁纸、智能配色与个人预设" icon={Palette} onClick={onAppearance}/>
      {!customSkin && <ToolButton label={`切换到${theme === 'dark' ? '浅色' : '深色'}主题`} icon={ThemeIcon} onClick={onTheme}/>}
    </div>
    <ConnectionSignal status={status} latency={latency}/>
    <div className="workspace-tool-group" role="group" aria-label="工作区操作">
      <span className="workspace-terminal-tool"><ToolButton label="网页终端" description={hasProject ? '在当前项目中打开终端' : '请先选择项目'} icon={Terminal} disabled={!hasProject} onClick={onTerminal}/></span>
      <ToolButton label={editor ? '收起代码面板' : '打开代码面板'} icon={Code2} buttonRef={editorToggle} aria-pressed={editor} aria-expanded={editor} aria-controls="workspace-editor" onClick={onEditor}><span className="workspace-code-label">代码</span></ToolButton>
      <span className="workspace-tool-divider" aria-hidden="true"/>
      <ToolButton label="设置" description={settingsDisabled ? '正在保存配置，请稍候' : '模型、账号与工作区偏好'} icon={Settings} disabled={settingsDisabled} onClick={onSettings}/>
      <MoreTools theme={theme} customSkin={customSkin} onAppearance={onAppearance} onTheme={onTheme} onTerminal={onTerminal} hasProject={hasProject}/>
    </div>
  </div>;
}
