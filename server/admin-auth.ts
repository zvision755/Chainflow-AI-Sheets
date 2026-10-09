import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { json } from './proxy';

type Session = { hash: string; csrf: string; expires: number };
type State = { version: 1; username: string; salt: string; passwordHash: string; sessions: Session[] };
const validUsername = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 64 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const duration = 30 * 24 * 60 * 60 * 1000;
const cookieName = 'chainflow_session'; // No __Host prefix: existing fnOS rewrites Path.
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (left: string, right: string) => timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right)));
const derive = (password: string, salt: string) => new Promise<string>((resolve, reject) => scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key.toString('hex'))));
const failure = (code: string, message: string, status: number) => json({ error: { code, message, retryable: false } }, status);
function token(request: Request) {
  return (request.headers.get('cookie') ?? '').split(';').map(item => item.trim()).find(item => item.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
}

/** One owner account; all protected API routes must go through require(). */
export class AdminAuth {
  private state: State | null = null;
  private ready: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private failures = 0;
  private failureUntil = 0;
  constructor(private file: string, private now = () => Date.now()) { this.ready = this.load(); }
  private async load() {
    try {
      const state = JSON.parse(await readFile(this.file, 'utf8')) as State;
      if (state.version !== 1 || !validUsername(state.username) || !/^[a-f0-9]{64}$/.test(state.salt) || !/^[a-f0-9]{128}$/.test(state.passwordHash) || !Array.isArray(state.sessions) || state.sessions.length > 100 || state.sessions.some(session => !/^[a-f0-9]{64}$/.test(session.hash) || !/^[a-f0-9]{64}$/.test(session.csrf) || !Number.isFinite(session.expires))) throw Error('Invalid authentication state');
      this.state = state;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action); this.tail = result.catch(() => {}); return result;
  }
  private async persist(state: State, first = false) {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    if (first) { await writeFile(this.file, JSON.stringify(state), { flag: 'wx', mode: 0o600 }); }
    else {
      const temporary = this.file + '.' + randomBytes(8).toString('hex');
      try { await writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 }); await rename(temporary, this.file); }
      finally { await unlink(temporary).catch(() => {}); }
    }
    this.state = state;
  }
  private session(request: Request) {
    const value = token(request); if (!/^[a-f0-9]{64}$/.test(value)) return undefined;
    const hash = digest(value);
    return this.state?.sessions.find(session => equal(session.hash, hash) && session.expires > this.now());
  }
  async require(request: Request): Promise<Response | null> {
    await this.ready;
    const session = this.session(request);
    if (!session) return failure('auth_required', '请先登录管理员账户', 401);
    if (!['GET', 'HEAD'].includes(request.method) && !equal(request.headers.get('x-chainflow-csrf') ?? '', session.csrf)) return failure('csrf', '登录会话校验失败，请刷新页面后重试', 403);
    return null;
  }
  async handle(request: Request): Promise<Response | null> {
    await this.ready;
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/auth/')) return null;
    if (path === '/api/auth/status' && request.method === 'GET') {
      const session = this.session(request);
      return json({ enabled: true, setupRequired: !this.state, authenticated: !!session, ...(session ? { csrf: session.csrf } : {}) });
    }
    if (!['/api/auth/setup', '/api/auth/login', '/api/auth/logout'].includes(path)) return failure('not_found', '接口不存在', 404);
    if (request.method !== 'POST') return failure('method', '请使用 POST', 405);
    // This custom header + JSON requires a CORS preflight for cross-site scripts.
    // We never grant CORS; no Origin/forwarded Host comparison is needed.
    if (!request.headers.get('content-type')?.startsWith('application/json') || request.headers.get('x-chainflow-auth') !== '1') return failure('auth_request', '登录请求格式不正确', 403);
    if (path.endsWith('/logout')) {
      const denied = await this.require(request); if (denied) return denied;
      return this.serialize(async () => {
        const hash = digest(token(request));
        await this.persist({ ...this.state!, sessions: this.state!.sessions.filter(session => !equal(session.hash, hash)) });
        const response = json({ ok: true }); response.headers.set('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); return response;
      });
    }
    return this.serialize(async () => {
      if (this.now() > this.failureUntil) this.failures = 0;
      if (this.failures >= 10) return failure('auth_rate_limit', '登录失败次数过多，请 15 分钟后重试', 429);
      let body: { username?: unknown; password?: unknown; secure?: unknown };
      try { const text = await request.text(); if (Buffer.byteLength(text) > 2048) throw Error(); body = JSON.parse(text); if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !['username', 'password', 'secure'].includes(key)) || typeof body.password !== 'string' || body.password.length > 256 || typeof body.secure !== 'boolean') throw Error(); }
      catch { return failure('auth_request', '登录请求格式不正确', 400); }
      let state = this.state;
      if (path.endsWith('/setup')) {
        if (state) return failure('auth_configured', '管理员密码已设置，请登录', 409);
        if (!validUsername(body.username)) return failure('username', '用户名需要 1–64 个字符，不能包含控制字符或首尾空格', 400);
        if ((body.password as string).length < 1) return failure('password', '密码至少需要 1 个字符', 400);
        const salt = randomBytes(32).toString('hex');
        state = { version: 1, username: body.username, salt, passwordHash: await derive(body.password as string, salt), sessions: [] };
      } else {
        if (!state) return failure('auth_setup_required', '请先设置管理员密码', 409);
        if (body.username !== state.username || !equal(await derive(body.password as string, state.salt), state.passwordHash)) {
          this.failures++; if (this.failures === 1) this.failureUntil = this.now() + 15 * 60 * 1000;
          return failure('auth_invalid', '用户名或密码错误', 401);
        }
      }
      const value = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
      const sessions = state.sessions.filter(session => session.expires > this.now()).slice(-99);
      sessions.push({ hash: digest(value), csrf, expires: this.now() + duration });
      await this.persist({ ...state, sessions }, !this.state);
      this.failures = 0;
      const response = json({ authenticated: true, username: state.username, csrf });
      response.headers.set('Set-Cookie', `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${duration / 1000}${body.secure ? '; Secure' : ''}`);
      return response;
    });
  }
}
