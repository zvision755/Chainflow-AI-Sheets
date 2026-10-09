'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { LockKeyhole } from 'lucide-react';
import { authRequiredEvent, setSession } from '../model/session';
type Status = { enabled: boolean; setupRequired: boolean; authenticated: boolean; csrf?: string };
async function readStatus(): Promise<Status> {
  const response = await fetch('/api/auth/status', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return { enabled: false, setupRequired: false, authenticated: false };
  if (!response.ok) throw Error('无法检查登录状态，请重试');
  const data = await response.json() as Status;
  if (data.enabled === false) return { enabled: false, setupRequired: false, authenticated: false };
  if (data.enabled !== true || typeof data.setupRequired !== 'boolean' || typeof data.authenticated !== 'boolean' || (data.authenticated && typeof data.csrf !== 'string')) throw Error('登录状态响应无效');
  return data;
}
export function AuthGate({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [busy, setBusy] = useState(false);
  async function inspect() {
    try { const next = await readStatus(); setSession(next.csrf ?? '', next.enabled); setStatus(next); setError(''); }
    catch { setError('无法连接服务，请检查网络后重试'); }
  }
  useEffect(() => { let active = true; void readStatus().then(next => { if (active) { setSession(next.csrf ?? '', next.enabled); setStatus(next); } }).catch(() => { if (active) setError('无法连接服务，请检查网络后重试'); }); const required = () => { setSession('', true); setStatus({ enabled: true, setupRequired: false, authenticated: false }); setError('请重新登录'); }; window.addEventListener(authRequiredEvent, required); return () => { active = false; window.removeEventListener(authRequiredEvent, required); }; }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (status?.setupRequired && password !== confirm) { setError('两次输入的密码不一致'); return; }
    setBusy(true);
    try {
      const response = await fetch(status?.setupRequired ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Chainflow-Auth': '1' }, body: JSON.stringify({ username: username.trim(), password, secure: window.location.protocol === 'https:' }), cache: 'no-store' });
      const data = await response.json() as { csrf?: string; error?: { message?: string } };
      if (!response.ok) { if (response.status === 409) await inspect(); throw Error(data.error?.message ?? '登录失败'); }
      const next = await readStatus();
      if (!next.authenticated) throw Error('浏览器未保存登录 Cookie，请允许此站点使用 Cookie 后重试');
      setSession(next.csrf ?? '', true); setPassword(''); setConfirm(''); setStatus(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '登录失败'); }
    finally { setBusy(false); }
  }
  if (status && (!status.enabled || status.authenticated)) return children;
  return <div className="auth-screen"><form className="dialog auth-dialog" onSubmit={event => void submit(event)}><div className="dialog-icon"><LockKeyhole size={24}/></div><h1>ChainFlow AI Sheets</h1><h2>{status?.setupRequired ? '设置管理员账户' : status ? '登录' : '正在连接服务…'}</h2>{status && <><p>{status.setupRequired ? '首次使用，请手动填写用户名并设置密码。' : '使用你的管理员账户登录。此浏览器的登录状态保留 30 天。'}</p><label>用户名<input value={username} onChange={event => setUsername(event.target.value)} required maxLength={64} autoComplete="username" autoCapitalize="none" spellCheck={false}/></label><label>密码<input type="password" required minLength={1} maxLength={256} autoComplete={status.setupRequired ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)}/></label>{status.setupRequired && <label>确认密码<input type="password" required minLength={1} maxLength={256} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)}/></label>}<button type="submit" className="button primary auth-submit" disabled={busy}>{busy ? '处理中…' : status.setupRequired ? '创建账户并登录' : '登录'}</button></>}{error && <p role="alert" className="auth-error">{error}</p>}{!status && error && <button className="button" type="button" onClick={() => void inspect()}>重新连接</button>}</form></div>;
}
