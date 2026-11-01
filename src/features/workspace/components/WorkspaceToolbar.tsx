import {
  StickyNote,
  Code,
  Moon,
  MoreHorizontal,
  Palette,
  Settings as SettingsIcon,
  Sun,
  Terminal,
} from 'lucide-react';
import type * as React from 'react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Theme } from '../../../../shared/contracts/domain.ts';
import type { ProtocolCallback } from '../../../../shared/contracts/protocol.ts';
import Tooltip from '../../../components/ui/Tooltip.tsx';
import type { FocusableElement } from '../../../types/dom.ts';
import ConnectionSignal from './ConnectionSignal.tsx';
import NotificationCenter from '../../notifications/components/NotificationCenter.tsx';
import type { ApiClient } from '../../../../shared/contracts/api.ts';
export interface ToolButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'onChange' | 'children'> {
  label: string;
  tooltip?: string;
  description?: string;
  icon: React.ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;
  buttonRef?: React.Ref<HTMLButtonElement>;
  disabled?: boolean;
}
export interface ThemeSwitchProps {
  theme: Theme;
  onChange: (value: Theme) => void;
}
export interface MoreToolsProps {
  theme: Theme;
  customSkin: boolean;
  onAppearance: ProtocolCallback;
  onTheme: (value: Theme) => void;
  onTerminal: ProtocolCallback;
  hasProject: boolean;
}
export interface WorkspaceToolbarProps {
  api: ApiClient;
  memoOpen: boolean;
  onMemo: () => void;
  theme: Theme;
  customSkin: boolean;
  status: import('../../../../shared/contracts/domain.ts').ConnectionStatus;
  latency: number | null;
  hasProject: boolean;
  terminalOpen: boolean;
  editor: boolean;
  editorToggle: React.Ref<HTMLButtonElement>;
  settingsDisabled: boolean;
  onAppearance: ProtocolCallback;
  onTheme: (value: Theme) => void;
  onTerminal: ProtocolCallback;
  onEditor: ProtocolCallback;
  onSettings: ProtocolCallback;
  onRetry?: ProtocolCallback;
}

function ToolButton({
  label,
  tooltip = label,
  description,
  icon: Icon,
  buttonRef,
  disabled,
  ...props
}: ToolButtonProps) {
  return (
    <Tooltip title={tooltip} description={description} disabled={disabled} variant="toolbar">
      <button
        type="button"
        className="workspace-tool"
        aria-label={label}
        ref={buttonRef}
        disabled={disabled}
        {...props}
      >
        <Icon size={18} strokeWidth={1.75} />
      </button>
    </Tooltip>
  );
}

function ThemeSwitch({ theme, onChange }: ThemeSwitchProps) {
  const root = useRef<HTMLDivElement>(undefined!);
  const modes: { value: Theme; label: string; Icon: typeof Sun }[] = [
    { value: 'light', label: '浅色主题', Icon: Sun },
    { value: 'dark', label: '深色主题', Icon: Moon },
  ];
  function keydown(event: {
    key: string;
    preventDefault: () => void;
    stopPropagation: () => void;
  }) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    event.stopPropagation();
    const value =
      event.key === 'Home'
        ? 'light'
        : event.key === 'End'
          ? 'dark'
          : theme === 'dark'
            ? 'light'
            : 'dark';
    root.current.querySelector<FocusableElement>(`[data-mode="${value}"]`)!.focus();
    onChange(value);
  }
  return (
    <div
      className="workspace-theme"
      role="radiogroup"
      aria-label="主题"
      data-value={theme}
      ref={root}
      onKeyDown={keydown}
    >
      {modes.map(({ value, label, Icon }) => (
        <Tooltip key={value} title={label} variant="toolbar">
          <button
            type="button"
            role="radio"
            aria-checked={theme === value}
            aria-label={label}
            data-mode={value}
            tabIndex={theme === value ? 0 : -1}
            onClick={() => onChange(value)}
          >
            <Icon size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

function MoreTools({
  theme,
  customSkin,
  onAppearance,
  onTheme,
  onTerminal,
  hasProject,
}: MoreToolsProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(undefined!),
    trigger = useRef<HTMLButtonElement>(undefined!),
    menu = useRef<HTMLDivElement>(undefined!),
    firstItem = useRef(0),
    id = useId();
  const ThemeIcon = theme === 'dark' ? Moon : Sun;
  const themeLabel = `切换到${theme === 'dark' ? '浅色' : '深色'}主题`;
  const items = () => [
    ...menu.current.querySelectorAll<FocusableElement>('[role="menuitem"]:not(:disabled)'),
  ];
  useLayoutEffect(() => {
    if (open) items().at(firstItem.current)?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!root.current.contains(event.target as Node)) setOpen(false);
    };
    const resize = () => {
      // A breakpoint can hide the focused item before the resize event arrives.
      if (
        root.current.contains(document.activeElement) ||
        document.activeElement === document.body
      ) {
        if (window.matchMedia('(min-width: 641px)').matches)
          document
            .querySelector<FocusableElement>('.workspace-toolbar [aria-label="壁纸与外观"]')
            ?.focus();
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
  function run(action: { (...args: any[]): any; (): any; (...args: any[]): any; (): void }) {
    setOpen(false);
    trigger.current.focus();
    action();
  }
  function keydown(event: {
    key: string;
    preventDefault: () => void;
    stopPropagation: () => void;
  }) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current.focus();
    } else if (event.key === 'Tab' && open) {
      setOpen(false);
      trigger.current.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        firstItem.current = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 0;
        setOpen(true);
        return;
      }
      const buttons = items(),
        index = buttons.indexOf(document.activeElement as FocusableElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }
  return (
    <div className="workspace-more" ref={root} onKeyDown={keydown}>
      <ToolButton
        label="更多工具"
        icon={MoreHorizontal}
        buttonRef={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          firstItem.current = 0;
          setOpen(!open);
        }}
      />
      {open && (
        <div
          className="workspace-tool-menu"
          id={id}
          role="menu"
          aria-label="更多工作区工具"
          ref={menu}
        >
          <div className="workspace-menu-heading" aria-hidden="true">
            工作区工具
          </div>
          <button type="button" role="menuitem" onClick={() => run(onAppearance)}>
            <Palette size={17} strokeWidth={1.75} />
            <span>壁纸与外观</span>
          </button>
          {!customSkin && (
            <button
              type="button"
              role="menuitem"
              onClick={() => run(() => onTheme(theme === 'dark' ? 'light' : 'dark'))}
            >
              <ThemeIcon size={17} strokeWidth={1.75} />
              <span>{themeLabel}</span>
            </button>
          )}
          <div className="workspace-menu-divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            disabled={!hasProject}
            onClick={() => run(onTerminal)}
          >
            <Terminal size={17} strokeWidth={1.75} />
            <span>网页终端{!hasProject && <small>请先选择项目</small>}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function WorkspaceToolbar({
  api,
  memoOpen,
  onMemo,
  theme,
  customSkin,
  status,
  latency,
  hasProject,
  terminalOpen,
  editor,
  editorToggle,
  settingsDisabled,
  onAppearance,
  onTheme,
  onTerminal,
  onEditor,
  onSettings,
  onRetry,
}: WorkspaceToolbarProps) {
  return (
    <div className="workspace-toolbar" role="group" aria-label="工作区工具">
      <div
        className="workspace-tool-group workspace-appearance-tools"
        role="group"
        aria-label="外观"
      >
        <ToolButton
          label="壁纸与外观"
          tooltip="外观 / 皮肤"
          icon={Palette}
          onClick={onAppearance}
        />
        {!customSkin && <ThemeSwitch theme={theme} onChange={onTheme} />}
      </div>
      <span
        className="workspace-tool-separator workspace-appearance-separator"
        aria-hidden="true"
      />
      <div className="workspace-tool-group" role="group" aria-label="工作区面板">
        <span className="workspace-terminal-tool">
          <ToolButton
            label="网页终端"
            tooltip="终端"
            description={hasProject ? undefined : '请先选择项目'}
            icon={Terminal}
            disabled={!hasProject}
            aria-pressed={terminalOpen}
            aria-haspopup="dialog"
            onClick={onTerminal}
          />
        </span>
        <ToolButton
          label={editor ? '收起代码面板' : '打开代码面板'}
          tooltip="代码编辑器"
          icon={Code}
          buttonRef={editorToggle}
          aria-pressed={editor}
          aria-expanded={editor}
          aria-controls="workspace-editor"
          onClick={onEditor}
        />
        <ToolButton
          label="备忘录"
          icon={StickyNote}
          aria-pressed={memoOpen}
          aria-expanded={memoOpen}
          aria-controls="workspace-memo"
          onClick={onMemo}
        />
      </div>
      <span className="workspace-tool-separator" aria-hidden="true" />
      <div className="workspace-tool-group" role="group" aria-label="状态与设置">
        <ConnectionSignal status={status} latency={latency} onRetry={onRetry} />
        <NotificationCenter api={api} />
        <ToolButton
          label="设置"
          description={settingsDisabled ? '正在保存配置，请稍候' : undefined}
          icon={SettingsIcon}
          disabled={settingsDisabled}
          onClick={onSettings}
        />
        <MoreTools
          theme={theme}
          customSkin={customSkin}
          onAppearance={onAppearance}
          onTheme={onTheme}
          onTerminal={onTerminal}
          hasProject={hasProject}
        />
      </div>
    </div>
  );
}
