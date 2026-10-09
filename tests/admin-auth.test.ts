import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { AdminAuth } from '../server/admin-auth';
import { createDockerHandler, serveDockerRequest } from '../docker/http';

const password = 'test-password-do-not-deploy';
const post = (path: string, body: unknown = {}, cookie = '', csrf = '', extra: Record<string, string> = {}) => new Request('http://upstream.internal' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-chainflow-auth': '1', cookie, 'x-chainflow-csrf': csrf, origin: 'https://external.example', ...extra }, body: JSON.stringify(body) });
async function fixture(run: (auth: AdminAuth, file: string) => Promise<void>, clock?: () => number) {
  const directory = await mkdtemp(join(tmpdir(), 'chainflow-auth-test-'));
  try { const file = join(directory, 'auth.json'); await run(new AdminAuth(file, clock), file); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
async function setup(auth: AdminAuth) {
  const response = (await auth.handle(post('/api/auth/setup', { username: 'admin', password, secure: false })))!;
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const data = await response.json() as { csrf: string };
  return { cookie, csrf: data.csrf };
}
test('first setup is atomic; stored credentials and persistent sessions survive restart without plaintext secrets', async () => fixture(async (auth, file) => {
  const status = (await auth.handle(new Request('http://localhost/api/auth/status')))!;
  assert.equal(((await status.json()) as { setupRequired: boolean }).setupRequired, true);
  const session = await setup(auth);
  assert.equal((await auth.handle(post('/api/auth/setup', { username: 'admin', password, secure: false })))!.status, 409);
  const stored = await readFile(file, 'utf8'); assert.equal(stored.includes(password), false); assert.equal(stored.includes(session.cookie.split('=')[1]), false);
  const restarted = new AdminAuth(file);
  assert.equal(await restarted.require(post('/api/workbooks', {}, session.cookie, session.csrf)), null);
  assert.equal((await restarted.require(post('/api/local-tts/speech', {}, session.cookie)))?.status, 403);
  assert.equal((await restarted.require(post('/api/local-agent/generate', {}, session.cookie + 'x', session.csrf)))?.status, 401);
  const logout = (await restarted.handle(post('/api/auth/logout', {}, session.cookie, session.csrf)))!; assert.equal(logout.status, 200);
  assert.equal((await new AdminAuth(file).require(post('/api/models', {}, session.cookie, session.csrf)))?.status, 401);
}));
test('setup requires JSON custom header, validates password length and allows exactly one concurrent owner', async () => fixture(async auth => {
  assert.equal((await auth.handle(post('/api/auth/setup', { username: 'admin', password, secure: false }, '', '', { 'x-chainflow-auth': '' })))!.status, 403);
  assert.equal((await auth.handle(post('/api/auth/setup', { username: 'admin', password: '', secure: false })))!.status, 400);
  const responses = await Promise.all([auth.handle(post('/api/auth/setup', { username: 'admin', password, secure: false })), auth.handle(post('/api/auth/setup', { username: 'admin', password, secure: false }))]);
  assert.deepEqual(responses.map(response => response!.status).sort(), [200, 409]);
}));
test('password authentication, TLS cookies, failed-login throttling and session expiration are enforced', async () => {
  let now = Date.now();
  await fixture(async auth => {
    const session = await setup(auth);
    const login = (await auth.handle(post('/api/auth/login', { username: 'admin', password, secure: true })))!; assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
    for (let index = 0; index < 10; index++) assert.equal((await auth.handle(post('/api/auth/login', { username: 'admin', password: 'incorrect', secure: false })))!.status, 401);
    assert.equal((await auth.handle(post('/api/auth/login', { username: 'admin', password, secure: false })))!.status, 429);
    now += 16 * 60 * 1000;
    assert.equal((await auth.handle(post('/api/auth/login', { username: 'admin', password, secure: false })))!.status, 200);
    now += 31 * 24 * 60 * 60 * 1000;
    assert.equal((await auth.require(post('/api/local-agent/status', {}, session.cookie, session.csrf)))?.status, 401);
  }, () => now);
});
test('corrupt authentication state fails closed and never silently resets the owner', async () => fixture(async (_auth, file) => {
  await _auth.handle(new Request('http://localhost/api/auth/status'));
  await writeFile(file, '{broken'); const auth = new AdminAuth(file);
  await assert.rejects(auth.handle(new Request('http://localhost/api/auth/status')));
}));
test('all Docker APIs require login including localhost and future workbook routes; authenticated proxy requests preserve Agent SSE and binary TTS', async () => fixture(async auth => {
  let calls = 0;
  const audio = Buffer.alloc(48); audio.write('RIFF', 0); audio.write('WAVE', 8);
  const handler = createDockerHandler({ auth, bridge: { status: async () => { calls++; return { connected: true, auth: 'chatgpt', plan: '', version: '', models: [], defaultModel: '', transport: 'app-server' }; }, generate: async (_input, _signal, onText) => { calls++; onText?.('完整文本'); return { text: '完整文本', usage: { input: 1, output: 1 } }; } }, builtinTtsFetcher: (async () => { calls++; return new Response(audio); }) as typeof fetch });
  for (const origin of ['http://localhost:3003', 'http://192.168.10.102:3003', 'http://172.16.0.171:3003', 'https://nas.example', 'https://tunnel.example']) {
    for (const path of ['/api/local-agent/status', '/api/local-agent/generate', '/api/local-tts/speech', '/api/models', '/api/generate', '/api/workbooks']) assert.equal((await handler(new Request(origin + path, { method: 'POST', headers: { origin, 'x-forwarded-host': 'localhost', 'x-forwarded-proto': 'http' }, body: '{}' })))!.status, 401);
  }
  assert.equal(calls, 0);
  assert.equal((await handler(new Request('http://localhost/api/capabilities')))!.status, 401);
  const session = await setup(auth);
  for (const origin of ['http://localhost:3003', 'http://192.168.10.102:3003', 'http://172.16.0.171:3003', 'https://nas.example', 'https://tunnel.example']) {
    const response = (await handler(post('/api/local-agent/status', {}, session.cookie, session.csrf, { origin })))!; assert.equal(response.status, 200);
  }
  assert.equal((await handler(post('/api/local-agent/status', {}, session.cookie, '', { origin: 'https://attacker.example' })))!.status, 403);
  const server = createServer((req, res) => void serveDockerRequest(req, res, handler, (_req, response) => response.end('frontend'), false, true));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const headers = { cookie: session.cookie, 'x-chainflow-csrf': session.csrf, 'content-type': 'application/json', origin: 'https://nas.example', 'x-forwarded-host': 'localhost', 'x-forwarded-proto': 'http' };
    const response = await fetch(base + '/api/local-agent/generate', { method: 'POST', headers, body: JSON.stringify({ model: 'gpt-6-luna', prompt: '解释', input: '测试', maxTokens: 128, reasoning: 'none', stream: true }) }); assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /text\/event-stream/); const stream = await response.text(); assert.match(stream, /完整文本/); assert.match(stream, /"type":"done"/);
    const speech = await fetch(base + '/api/local-tts/speech', { method: 'POST', headers, body: JSON.stringify({ url: 'builtin', model: 'kokoro', input: 'テスト', language: 'ja', voice: 'jf_alpha', speed: 1 }) }); assert.equal(speech.status, 200); assert.equal(speech.headers.get('content-type'), 'audio/wav'); assert.deepEqual(Buffer.from(await speech.arrayBuffer()), audio);
    assert.equal((await fetch(base + '/api/local-agent/status', { method: 'POST', headers: { origin: base }, body: '{}' })).status, 401);
    for (const path of ['/%61pi/local-agent/status', '/api%2Flocal-tts/speech', '/%2561pi/workbooks']) assert.equal((await fetch(base + path, { method: 'POST', body: '{}' })).status, 400);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}));

test('custom owner username persists and admin is only a default, not a login alias', async () => fixture(async (auth, file) => {
  for (const username of ['', ' padded ', 'x'.repeat(65)]) {
    assert.equal((await auth.handle(post('/api/auth/setup', { username, password, secure: false })))!.status, 400);
  }
  assert.equal((await auth.handle(post('/api/auth/setup', { username: 'my-account', password, secure: false })))!.status, 200);
  const restarted = new AdminAuth(file);
  assert.equal((await restarted.handle(post('/api/auth/login', { username: 'admin', password, secure: false })))!.status, 401);
  assert.equal((await restarted.handle(post('/api/auth/login', { username: 'my-account', password, secure: false })))!.status, 200);
}));

test('one-character password survives logout and restart and logs in from another origin', async () => fixture(async (auth, file) => {
  const created = (await auth.handle(post('/api/auth/setup', { username: 'admin', password: 'a', secure: false })))!;
  assert.equal(created.status, 200);
  const cookie = created.headers.get('set-cookie')!.split(';')[0];
  const data = await created.json() as { csrf: string };
  assert.equal((await auth.handle(post('/api/auth/logout', {}, cookie, data.csrf)))!.status, 200);
  const restarted = new AdminAuth(file);
  for (const origin of ['http://localhost:3003', 'http://172.16.0.171:3003', 'https://nas.example']) {
    assert.equal((await restarted.handle(post('/api/auth/login', { username: 'admin', password: 'a', secure: origin.startsWith('https:') }, '', '', { origin })))!.status, 200);
  }
}));
