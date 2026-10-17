import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Settings, Palette, KeyRound, Code2, Sparkles, ShieldCheck, RefreshCw, LogOut, ChevronRight, LoaderCircle, Check } from 'lucide-react';
import Modal from './Modal';
import IconButton from './IconButton';
import Select from './Select';
import ModelControls from './ModelControls';
import Appearance from './Appearance';
import ProfileAvatar from './ProfileAvatar';
import UserManagement from './UserManagement';
import InviteManagement from './InviteManagement';
import ChatGPTLogin from './ChatGPTLogin';
import LoadingPlaceholder from './LoadingPlaceholder';

const settingsPages = [
  { id:'general', icon:Settings, name:'通用', title:'模型与执行', description:'选择适合当前任务的模型与工作方式。' },
  { id:'appearance', icon:Palette, name:'壁纸与外观' },
  { id:'account', icon:KeyRound, name:'Codex 账号', title:'Codex 账号', description:'管理工作区使用的账号与连接方式。' },
  { id:'advanced', icon:Code2, name:'高级配置', title:'高级配置', description:'精细调整你的 Codex 工作环境。' },
  { id:'tools', icon:Sparkles, name:'工具与技能', title:'工具与技能', description:'查看和管理工作区可用的能力。' },
  { id:'profile', icon:ShieldCheck, name:'个人账号', title:'个人账号', description:'让工作区更像你，也更适合你。' },
];
function SettingsHeading({ page }) {
  const Icon = page.icon;
  return <header className="settings-page-heading"><span aria-hidden="true"><Icon size={20}/></span><div><h3>{page.title}</h3><p>{page.description}</p></div></header>;
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
  onLogout
}) {
  const [tab, setTab] = useState(initialTab),
    [toml, setToml] = useState(''),
    [loadedConfig, setLoadedConfig] = useState(false),
    [configError, setConfigError] = useState(false),
    [apiKey, setApiKey] = useState(''),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const { value: draft, pending: saving, error: saveError } = useSyncExternalStore(settingsQueue.subscribe, settingsQueue.getSnapshot);
  useEffect(() => { settingsQueue.sync(settings); }, [settings, settingsQueue]);
  function applySettings(next) {
    settingsQueue.update(next).catch(() => {}); // The queue rolls back and reports the failed fields.
  }
  useEffect(() => {
    let cancelled = false;
    if (tab === 'advanced' && !loadedConfig) {
      setConfigError(false);
      api('/config').then(r => {
        if (!cancelled) {
          setToml(r.toml);
          setLoadedConfig(true);
        }
      }).catch(e => {
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
  async function run(fn) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(e.message, true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return <Modal title="工作区设置" subtitle="让 Codex 按照你的方式工作。" className={`settings-dialog${tab === 'appearance' ? ' appearance-settings' : ''}`} dismissible={!busy} onClose={onClose} wide><div className="settings-layout"><nav className="settings-nav" aria-label="设置分类">{settingsPages.map(t => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => {
          setTab(t.id);
          setResult(null);
        }} aria-current={tab === t.id ? "page" : undefined}><t.icon size={16} />{t.name}</button>)}</nav><div className="settings-content" key={tab}>{tab !== "appearance" && <SettingsHeading page={settingsPages.find(page => page.id === tab)} />}
    {tab === 'appearance' && <Appearance api={api} socket={socket} onUpdate={onSkins} onReset={onResetAppearance} notify={notify} />}
    {tab === 'general' && <><ModelControls models={models} value={draft} onChange={applySettings} disabled={busy} /><p className="field-hint">执行审批可在聊天输入框旁直接选择。</p><label>对话模式<Select value={draft.mode} disabled={busy} onChange={e => applySettings({
              ...draft,
              mode: e.target.value
            })}><option value="default">执行模式</option><option value="plan">计划模式</option></Select></label><label className="checkbox-label"><input type="checkbox" checked={draft.networkAccess} disabled={busy || draft.executionTarget === 'server'} onChange={e => applySettings({
              ...draft,
              networkAccess: e.target.checked
            })} />允许用户容器访问网络</label><p className="field-hint">{draft.executionTarget === 'server' ? '当前为服务器 root 模式。返回聊天框的执行权限菜单，可切回用户工作区。' : '工作区可以操作你自己的全部项目，不能修改服务器系统文件。切换网络权限会重启工作区。'}</p><p className="settings-apply-status" role="status">{saving ? <><LoaderCircle size={13} className="spin" />正在保存更改…</> : saveError ? '部分更改未保存' : <><Check size={13} />更改会立即应用</>}</p>{saveError && <p className="form-error" role="alert">{saveError}</p>}</>}
    {tab === 'account' && <><div className="account-status"><KeyRound size={22} /><div><strong>{account?.account?.type === 'chatgpt' ? account.account.email : account?.account?.type === 'apiKey' ? 'API Key 已配置' : account?.requiresOpenaiAuth === false ? '使用自定义服务商' : '尚未连接 Codex 账号'}</strong><span>{account?.account?.planType || '账号凭据仅存储在你的工作区'}</span></div><div className="account-actions"><IconButton title="刷新账号状态" disabled={busy} onClick={() => run(reload)}><RefreshCw size={15} /></IconButton>{account?.account && <IconButton title="退出 ChatGPT 账号" className="account-logout" disabled={busy} onClick={() => run(async () => {
                await socket.call('account/logout');
                await reload();
                notify('ChatGPT 账号已退出');
              })}><LogOut size={15} /></IconButton>}</div></div><h4>使用 ChatGPT 账号</h4><ChatGPTLogin socket={socket} reload={reload} notify={notify} disabled={busy} /><div className="settings-divider" /><h4>使用 API Key</h4><label>OpenAI API Key<input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-…" /></label><button className="primary full" disabled={busy || !apiKey} onClick={() => run(async () => {
            await socket.call('account/login/start', {
              type: 'apiKey',
              apiKey
            });
            setApiKey('');
            reload();
            notify('API Key 已保存');
          })}>连接 API Key</button></>}
    {tab === 'advanced' && <><p className="field-hint">这里直接编辑你工作区的 config.toml，支持自定义服务商、MCP、功能开关、配置档案及其他 CLI 设置。保存会重启该用户的 Codex 进程，请先停止运行中的任务。</p>{!loadedConfig && (configError ? <p className="form-error" role="alert">配置读取失败，请切换标签后重试。</p> : <LoadingPlaceholder label="正在读取配置…" variant="code" rows={7} />)}<textarea hidden={!loadedConfig} className="toml-editor" aria-label="Codex TOML 配置" spellCheck="false" value={toml} onChange={e => setToml(e.target.value)} /><button className="primary full" disabled={busy || !loadedConfig} onClick={() => run(async () => {
            await api('/config', {
              method: 'PUT',
              body: {
                toml
              }
            });
            notify('配置已保存，Codex 将重新连接');
            reload();
          })}>保存并重启 Codex</button></>}
    {tab === 'tools' && <><p className="field-hint">MCP 和功能开关可以在高级配置中管理。项目内的 AGENTS.md、技能和代码会被 Codex 自动读取。</p><div className="tool-buttons">{[['skills/list', '查看已安装技能'], ['mcpServerStatus/list', '查看 MCP 工具'], ['app/list', '查看连接器'], ['experimentalFeature/list', '查看功能开关']].map(([method, title]) => <button className="secondary" disabled={busy} key={method} onClick={() => run(async () => {
              setResult(await socket.call(method, {
                limit: 100
              }));
            })}>{title}<ChevronRight size={14} /></button>)}</div><button className="secondary full" disabled={busy} onClick={() => run(async () => {
            await socket.call('config/mcpServer/reload');
            notify('MCP 配置已重新加载');
          })}><RefreshCw size={14} />重新加载 MCP</button>{result && <pre className="settings-result">{JSON.stringify(result, null, 2)}</pre>}</>}
    {tab === 'profile' && <><ProfileAvatar user={user} socket={socket} api={api} onUpdate={onAvatar} notify={notify} Dialog={Modal} /><h4>修改密码</h4><form onSubmit={e => {
            e.preventDefault();
            const values = Object.fromEntries(new FormData(e.target));
            run(async () => {
              await api('/password', {
                method: 'POST',
                body: values
              });
              notify('密码已修改，请重新登录');
              location.reload();
            });
          }}><label>原密码<input type="password" name="oldPassword" required autoComplete="current-password" /></label><label>新密码<input type="password" name="newPassword" minLength={10} maxLength={128} required autoComplete="new-password" /></label><button className="secondary full" disabled={busy}>修改密码</button></form>{['admin', 'superadmin'].includes(user.role) && <><div className="settings-divider" /><UserManagement api={api} user={user} notify={notify} />{user.role === 'superadmin' && <><div className="settings-divider" /><InviteManagement api={api} notify={notify} /></>}<button className="secondary full" onClick={() => run(async () => setResult(await api('/admin/audit')))}>查看操作记录</button></>}{result && <pre className="settings-result">{JSON.stringify(result, null, 2)}</pre>}<div className="settings-divider" /><button className="secondary full danger-text" onClick={() => run(onLogout)}><LogOut size={15} />退出登录</button></>}
  </div></div></Modal>;
}
