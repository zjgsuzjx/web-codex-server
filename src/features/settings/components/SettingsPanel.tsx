import ShortcutSettings from './ShortcutSettings.tsx';
import {
  BookOpen,
  ChevronRight,
  Code2,
  KeyRound,
  LoaderCircle,
  LogOut,
  Monitor,
  Palette,
  Plug,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  Wrench,
  Zap,
  LayoutDashboard,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ApiClient } from '../../../../shared/contracts/api.ts';
import type { SessionUser, Settings } from '../../../../shared/contracts/domain.ts';
import type { AppError } from '../../../../shared/contracts/errors.ts';
import type { ProtocolCallback, ProtocolRecord } from '../../../../shared/contracts/protocol.ts';
import IconButton from '../../../components/ui/IconButton.tsx';
import LoadingPlaceholder from '../../../components/ui/LoadingPlaceholder.tsx';
import Modal from '../../../components/ui/Modal.tsx';
import Select from '../../../components/ui/Select.tsx';
import Appearance from '../../appearance/components/Appearance.tsx';
import { BrowserGraphicsCheck } from '../../appearance/components/BrowserGraphics.tsx';
import ProfileAvatar from '../../appearance/components/ProfileAvatar.tsx';
import ChatGPTLogin from '../../auth/components/ChatGPTLogin.tsx';
import ModelControls from '../../chat/components/ModelControls.tsx';
import InviteManagement from './InviteManagement.tsx';
import UserManagement from './UserManagement.tsx';
import NotificationManagement from './NotificationManagement.tsx';
export interface SettingsHeadingProps {
  page: ProtocolRecord;
}
export interface SettingsPanelProps {
  api: ApiClient;
  user: SessionUser;
  onAvatar: ProtocolCallback;
  onSkins: ProtocolCallback;
  onResetAppearance: ProtocolCallback;
  initialTab?: string;
  settings: Settings;
  settingsQueue: ReturnType<
    typeof import('../../../../shared/settings/settings-save.ts').createSettingsQueue
  >;
  socket: import('../../../lib/socket.ts').LiveSocket;
  models: ProtocolRecord[];
  account: ProtocolRecord;
  reload: ProtocolCallback;
  notify: (message: string, error?: boolean) => void;
  onClose: ProtocolCallback;
  onLogout: ProtocolCallback;
}

const settingsPages = [
  {
    id: 'general',
    icon: SettingsIcon,
    name: '通用',
    title: '模型与执行',
  },
  { id: 'appearance', icon: Palette, name: '壁纸与外观' },
  {
    id: 'browser',
    icon: Monitor,
    name: '浏览器',
    title: '浏览器与性能',
  },
  {
    id: 'account',
    icon: KeyRound,
    name: 'Codex 账号',
    title: 'Codex 账号',
  },
  {
    id: 'advanced',
    icon: Code2,
    name: '高级配置',
    title: '高级配置',
  },
  {
    id: 'tools',
    icon: Sparkles,
    name: '工具与技能',
    title: '工具与技能',
  },
  {
    id: 'profile',
    icon: ShieldCheck,
    name: '个人账号',
    title: '个人账号',
  },
  {
    id: 'site',
    icon: LayoutDashboard,
    name: '网站管理',
    title: '网站管理',
  },
];
function SettingsHeading({ page }: SettingsHeadingProps) {
  return (
    <header className="settings-page-heading">
      <h3>{page.title}</h3>
    </header>
  );
}

export default function SettingsPanel({
  api,
  user,
  onAvatar,
  onSkins,
  onResetAppearance,
  initialTab = 'general',
  settings,
  settingsQueue,
  socket,
  models,
  account,
  reload,
  notify,
  onClose,
  onLogout,
}: SettingsPanelProps) {
  const canManage = ['admin', 'superadmin'].includes(user.role);
  const [tab, setTab] = useState(initialTab === 'site' && !canManage ? 'profile' : initialTab),
    [toml, setToml] = useState(''),
    [loadedConfig, setLoadedConfig] = useState(false),
    [configError, setConfigError] = useState(false),
    [apiKey, setApiKey] = useState(''),
    [result, setResult] = useState<ProtocolRecord | null | undefined>(null),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const {
    value: draft,
    pending: saving,
    error: saveError,
  } = useSyncExternalStore(settingsQueue.subscribe, settingsQueue.getSnapshot);
  useEffect(() => {
    settingsQueue.sync(settings);
  }, [settings, settingsQueue]);
  function applySettings(next: any) {
    settingsQueue.update(next).catch(() => {}); // The queue rolls back and reports the failed fields.
  }
  useEffect(() => {
    let cancelled = false;
    if (tab === 'advanced' && !loadedConfig) {
      setConfigError(false);
      api('/config')
        .then((r) => {
          if (!cancelled) {
            setToml(r.toml);
            setLoadedConfig(true);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setConfigError(true);
            notify(e.message, true);
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [tab]);
  async function run(fn: ProtocolCallback) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (caughtError) {
      const e = caughtError as AppError;
      notify(e.message, true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title="设置"
      className={`settings-dialog${tab === 'appearance' ? ' appearance-settings' : ''}`}
      dismissible={!busy}
      onClose={onClose}
      wide
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          {settingsPages
            .filter((page) => page.id !== 'site' || canManage)
            .map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'active' : ''}
                onClick={() => {
                  setTab(t.id);
                  setResult(null);
                }}
                aria-current={tab === t.id ? 'page' : undefined}
              >
                <t.icon size={16} />
                {t.name}
              </button>
            ))}
        </nav>
        <div className="settings-content" key={tab}>
          {tab !== 'appearance' && (
            <SettingsHeading page={settingsPages.find((page) => page.id === tab)!} />
          )}
          {tab === 'appearance' && (
            <Appearance
              api={api}
              socket={socket}
              onUpdate={onSkins}
              onReset={onResetAppearance}
              notify={notify}
            />
          )}
          {tab === 'browser' && <BrowserGraphicsCheck />}
          {tab === 'general' && (
            <div className="settings-general">
              <ModelControls
                models={models}
                value={draft}
                onChange={applySettings}
                disabled={busy}
              />
              <label>
                对话模式
                <Select
                  value={draft.mode}
                  disabled={busy}
                  onChange={(e) =>
                    applySettings({
                      ...draft,
                      mode: (e.target as HTMLInputElement).value,
                    })
                  }
                >
                  <option value="default">执行模式</option>
                  <option value="plan">计划模式</option>
                </Select>
              </label>
              {saving && (
                <p className="settings-apply-status" role="status">
                  <LoaderCircle size={13} className="spin" />
                  正在保存…
                </p>
              )}
              {saveError && (
                <p className="form-error" role="alert">
                  {saveError}
                </p>
              )}
            </div>
          )}
          {tab === 'account' && (
            <>
              <div className="account-status">
                <KeyRound size={22} />
                <div>
                  <strong>
                    {account?.account?.type === 'chatgpt'
                      ? account.account.email
                      : account?.account?.type === 'apiKey'
                        ? 'API Key 已配置'
                        : account?.requiresOpenaiAuth === false
                          ? '使用自定义服务商'
                          : '尚未连接 Codex 账号'}
                  </strong>
                  {account?.account?.planType && <span>{account.account.planType}</span>}
                </div>
                <div className="account-actions">
                  <IconButton title="刷新账号状态" disabled={busy} onClick={() => run(reload)}>
                    <RefreshCw size={15} />
                  </IconButton>
                  {account?.account && (
                    <IconButton
                      title="退出 ChatGPT 账号"
                      className="account-logout"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await socket.call('account/logout');
                          await reload();
                          notify('ChatGPT 账号已退出');
                        })
                      }
                    >
                      <LogOut size={15} />
                    </IconButton>
                  )}
                </div>
              </div>
              <h4>使用 ChatGPT 账号</h4>
              <ChatGPTLogin socket={socket} reload={reload} notify={notify} disabled={busy} />
              <div className="settings-divider" />
              <h4>使用 API Key</h4>
              <label>
                OpenAI API Key
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey((e.target as HTMLInputElement).value)}
                  placeholder="sk-…"
                />
              </label>
              <button
                className="primary full"
                disabled={busy || !apiKey}
                onClick={() =>
                  run(async () => {
                    await socket.call('account/login/start', {
                      type: 'apiKey',
                      apiKey,
                    });
                    setApiKey('');
                    reload();
                    notify('API Key 已保存');
                  })
                }
              >
                连接 API Key
              </button>
            </>
          )}
          {tab === 'advanced' && (
            <>
              <h4>config.toml</h4>
              <p className="field-hint">保存将重启 Codex，请先停止运行中的任务。</p>
              {!loadedConfig &&
                (configError ? (
                  <p className="form-error" role="alert">
                    配置读取失败，请切换标签后重试。
                  </p>
                ) : (
                  <LoadingPlaceholder label="正在读取配置…" variant="code" rows={7} />
                ))}
              <textarea
                hidden={!loadedConfig}
                className="toml-editor"
                aria-label="Codex TOML 配置"
                spellCheck="false"
                value={toml}
                onChange={(e) => setToml((e.target as HTMLTextAreaElement).value)}
              />
              <button
                className="primary full"
                disabled={busy || !loadedConfig}
                onClick={() =>
                  run(async () => {
                    await api('/config', {
                      method: 'PUT',
                      body: {
                        toml,
                      },
                    });
                    notify('配置已保存，Codex 将重新连接');
                    reload();
                  })
                }
              >
                保存并重启 Codex
              </button>
            </>
          )}
          {tab === 'tools' && (
            <>
              <ShortcutSettings userId={user.id} />
              <div className="settings-section-heading">
                <h4>工作区能力</h4>
                <div className="settings-section-actions">
                  <IconButton
                    title="高级配置"
                    description="在 config.toml 中管理 MCP 和功能开关。"
                    disabled={busy}
                    onClick={() => {
                      setTab('advanced');
                      setResult(null);
                    }}
                  >
                    <SlidersHorizontal size={15} />
                  </IconButton>
                  <IconButton
                    title="重新加载 MCP"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await socket.call('config/mcpServer/reload');
                        notify('MCP 配置已重新加载');
                      })
                    }
                  >
                    <RefreshCw size={15} />
                  </IconButton>
                </div>
              </div>
              <div className="tool-buttons">
                {[
                  { method: 'skills/list', title: '技能', icon: BookOpen },
                  { method: 'mcpServerStatus/list', title: 'MCP 工具', icon: Wrench },
                  { method: 'app/list', title: '连接器', icon: Plug },
                  { method: 'experimentalFeature/list', title: '功能开关', icon: Zap },
                ].map(({ method, title, icon: Icon }) => (
                  <button
                    type="button"
                    disabled={busy}
                    key={method}
                    onClick={() =>
                      run(async () => {
                        setResult(
                          await socket.call(method, {
                            limit: 100,
                          }),
                        );
                      })
                    }
                  >
                    <Icon size={16} />
                    <span>{title}</span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
              {result && <pre className="settings-result">{JSON.stringify(result, null, 2)}</pre>}
            </>
          )}
          {tab === 'profile' && (
            <>
              <ProfileAvatar
                user={user}
                socket={socket}
                api={api}
                onUpdate={onAvatar}
                notify={notify}
                Dialog={Modal}
              />
              <h4>修改密码</h4>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const values = Object.fromEntries(new FormData(e.currentTarget));
                  run(async () => {
                    await api('/password', {
                      method: 'POST',
                      body: values,
                    });
                    notify('密码已修改，请重新登录');
                    location.reload();
                  });
                }}
              >
                <label>
                  原密码
                  <input
                    type="password"
                    name="oldPassword"
                    required
                    autoComplete="current-password"
                  />
                </label>
                <label>
                  新密码
                  <input
                    type="password"
                    name="newPassword"
                    minLength={10}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <button className="secondary full" disabled={busy}>
                  修改密码
                </button>
              </form>
              <div className="settings-divider" />
              <button className="secondary full danger-text" onClick={() => run(onLogout)}>
                <LogOut size={15} />
                退出登录
              </button>
            </>
          )}
          {tab === 'site' && canManage && (
            <>
              <NotificationManagement api={api} notify={notify} />
              <div className="settings-divider" />
              <UserManagement api={api} user={user} notify={notify} />
              {user.role === 'superadmin' && (
                <>
                  <div className="settings-divider" />
                  <InviteManagement api={api} notify={notify} />
                </>
              )}
              <div className="settings-divider" />
              <button
                className="secondary full"
                onClick={() => run(async () => setResult(await api('/admin/audit')))}
              >
                查看操作记录
              </button>
              {result && <pre className="settings-result">{JSON.stringify(result, null, 2)}</pre>}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
