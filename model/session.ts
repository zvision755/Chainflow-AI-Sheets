import {staticDeployment} from '../core/deployment';
let csrf = '';
let enabled = false;
export const authRequiredEvent = 'chainflow-auth-required';
export function setSession(value: string, active: boolean) { csrf = value; enabled = active; }
export function isAuthEnabled() { return enabled; }
export async function sessionFetch(input: RequestInfo | URL, init?: RequestInit) {
  if(staticDeployment){const {staticApi}=await import('./static-api');return staticApi(input,init,window.location.origin);}
  const headers = new Headers(init?.headers);
  if (enabled && !['GET', 'HEAD'].includes(init?.method ?? 'GET')) headers.set('X-Chainflow-Csrf', csrf);
  const response = await fetch(input, { ...init, headers, credentials: 'same-origin' });
  if (enabled && response.status === 401) {
    const data = await response.clone().json().catch(() => null) as { error?: { code?: string } } | null;
    if (data?.error?.code === 'auth_required') window.dispatchEvent(new Event(authRequiredEvent));
  }
  return response;
}
export async function logoutSession() {
  const response = await sessionFetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chainflow-Auth': '1' }, body: '{}' });
  if (!response.ok) throw Error('退出登录失败，请重试');
  setSession('', true); window.dispatchEvent(new Event(authRequiredEvent));
}
