import { useId, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, Moon, ShieldCheck, Sun, UserRound } from 'lucide-react';
import { BrandMark } from './components/BrandMark';

// Fixed positions keep the decorative sky stable through form updates.
const stars = Array.from({ length: 28 }, (_, i) => ({
  left: `${(i * 37 + 7) % 100}%`, top: `${(i * 23 + 3) % 72}%`,
  width: `${i % 3 + 1}px`, height: `${i % 3 + 1}px`, animationDelay: `${i % 7 * -.7}s`,
}));
// Match the reference's amplitude, wavelength, waterline and animation for each layer.
const waves = [
  [26, 600, .46, '--auth-wave-one', .55, 48, false],
  [20, 400, .34, '--auth-wave-two', .6, 34, true],
  [15, 300, .2, '--auth-wave-three', .72, 24, false],
].map(([amplitude, period, waterline, color, opacity, duration, reverse], i) => {
  const y = 200 * (1 - waterline), segments = 2400 / (period / 2);
  let path = `M0 ${y} Q${period / 4} ${y - amplitude * 2} ${period / 2} ${y}`;
  for (let k = 2; k <= segments; k++) path += ` T${period / 2 * k} ${y}`;
  return {
    path: `${path} V200 H0Z`,
    style: {
      '--auth-wave-color': `var(${color})`, opacity,
      animationDuration: `${duration}s, ${5 + i * 1.6}s`,
      animationDirection: `${reverse ? 'reverse' : 'normal'}, alternate`,
      animationDelay: `${-i * 9}s`,
    },
  };
});
// Generate once so the reference's randomized reflections stay stable while typing.
const seaGlints = Array.from({ length: 38 }, () => {
  const y = .5 + Math.random() * .45, spread = .25 + .75 * (y - .5) / .45;
  return {
    top: `${y * 100}%`, left: `${50 + (Math.random() - .5) * spread * 100}%`,
    width: `${10 + spread * 46}px`, animationDuration: `${2.4 + Math.random() * 3}s`,
    animationDelay: `${-Math.random() * 5}s`,
  };
});

function AuthBackdrop() {
  return <div className="auth-backdrop" aria-hidden="true">
    <div className="auth-cloud auth-cloud-one"/><div className="auth-cloud auth-cloud-two"/>
    <div className="auth-dots"/>
    <div className="auth-stars">{stars.map((style, i) => <i key={i} style={style}/>)}</div>
    <div className="auth-sea">
      {waves.map(({ path, style }, i) => <svg key={i} className={`auth-wave auth-wave-${i}`} viewBox="0 0 2400 200" preserveAspectRatio="none" style={style}><path d={path}/></svg>)}
      <div className="auth-sea-light"/>
      <div className="auth-sea-glints">{seaGlints.map((style, i) => <i key={i} style={style}/>)}</div>
    </div>
  </div>;
}

export default function Auth({ onLogin, inviteRequired, request, theme, setTheme }) {
  const [register, setRegister] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const pending = useRef(false), tabs = useRef([]), id = useId();
  const mode = register ? 'register' : 'login';

  function changeMode(next) {
    if (pending.current) return;
    setRegister(next); setError(''); setShowPassword(false);
  }
  function tabKeyDown(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (pending.current) return;
    const next = event.key === 'Home' ? false : event.key === 'End' ? true : !register;
    changeMode(next); tabs.current[Number(next)]?.focus();
  }
  async function submit(event) {
    event.preventDefault();
    if (pending.current) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    pending.current = true; setError(''); setBusy(true);
    try {
      const result = await request(register ? '/register' : '/login', { method: 'POST', body: data });
      onLogin(result.user);
    } catch (err) { setError(err.message); }
    finally { pending.current = false; setBusy(false); }
  }

  return <main className="auth-layout" data-mode={mode}>
    <AuthBackdrop/>
    <header className="auth-header">
      <div className="auth-brand"><BrandMark size={30} mini className="brand-mark"/><span>STARVALLEY <b>WORKSPACE</b></span></div>
      <button type="button" className="auth-theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}>
        {theme === 'dark' ? <Moon size={18} aria-hidden="true"/> : <Sun size={18} aria-hidden="true"/>}
      </button>
    </header>
    <section className="auth-card" aria-labelledby={`${id}-title`}>
      <div className="auth-hero">
        <div className="auth-symbol"><BrandMark size={60} className="brand-mark"/></div>
        <h1 id={`${id}-title`}>{register ? '开始创造。' : '欢迎回来。'}</h1>
      </div>
      <div className="auth-tabs" role="tablist" aria-label="账号访问" onKeyDown={tabKeyDown}>
        {['登录', '注册'].map((label, i) => <button key={label} ref={node => { tabs.current[i] = node; }} type="button" role="tab" id={`${id}-${i ? 'register' : 'login'}`} aria-selected={register === !!i} aria-controls={`${id}-panel`} tabIndex={register === !!i ? 0 : -1} disabled={busy} onClick={() => changeMode(!!i)}>{label}</button>)}
      </div>
      <form id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${mode}`} onSubmit={submit} onChange={() => error && setError('')} aria-busy={busy}>
        <div className="auth-field">
          <label htmlFor={`${id}-username`}>用户名</label>
          <div className="auth-input"><UserRound size={18} aria-hidden="true"/><input id={`${id}-username`} name="username" autoComplete="username" required minLength={3} maxLength={32} placeholder="你的用户名" pattern="[a-zA-Z][a-zA-Z0-9_\-]{2,31}"/></div>
        </div>
        <div className="auth-field">
          <div className="auth-field-heading"><label htmlFor={`${id}-password`}>密码</label>{register && <span id={`${id}-password-hint`}>至少 10 个字符</span>}</div>
          <div className="auth-input"><LockKeyhole size={18} aria-hidden="true"/><input id={`${id}-password`} name="password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 10 : 1} maxLength={128} placeholder={register ? '设置你的密码' : '输入密码'} aria-describedby={register ? `${id}-password-hint` : undefined}/><button type="button" className="auth-password-toggle" aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} onClick={() => setShowPassword(current => !current)}>{showPassword ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}</button></div>
        </div>
        {register && inviteRequired && <div className="auth-field auth-invite">
          <label htmlFor={`${id}-invite`}>邀请码</label>
          <div className="auth-input"><KeyRound size={18} aria-hidden="true"/><input id={`${id}-invite`} name="inviteCode" required autoComplete="off" placeholder="输入管理员提供的邀请码"/></div>
        </div>}
        {error && <p className="form-error auth-error" role="alert"><AlertCircle size={16} aria-hidden="true"/><span>{error}</span></p>}
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy && <LoaderCircle className="spin" size={18} aria-hidden="true"/>}<span>{busy ? (register ? '正在创建账号…' : '正在登录…') : (register ? '创建账号' : '进入工作区')}</span>{!busy && <ArrowRight size={18} aria-hidden="true"/>}
        </button>
      </form>
      <p className="auth-switch">{register ? '已有账号？' : '还没有账号？'} <button type="button" disabled={busy} onClick={() => changeMode(!register)}>{register ? '登录' : '使用邀请码注册'}</button></p>
      <div className="auth-assurance"><ShieldCheck size={15} aria-hidden="true"/><span>独立工作区 · 安全文件存储</span></div>
    </section>
    <footer className="auth-footer">Starvalley Workspace · Built for making things.</footer>
  </main>;
}
