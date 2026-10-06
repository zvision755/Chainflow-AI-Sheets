// Local preview only: production Workers cannot reach a visitor's Mac.
import { z } from 'zod';
import { externalTtsUrl, voiceMatches, type SpokenLanguage } from '../core/tts';
import { json } from '../server/proxy';
const base = z.object({ url: z.string().min(1).max(500) });
const speech = base.extend({ model: z.string().regex(/^[a-zA-Z0-9._:/-]{1,100}$/), input: z.string().trim().min(1).max(4096), language: z.enum(['ja', 'en', 'en-gb', 'zh']), voice: z.string().max(120), speed: z.number().min(0.25).max(4) }).strict();
const fail = (code: string, message: string, status: number) => json({ error: { code, message, retryable: false } }, status);
async function bounded(response: Response, limit: number) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('size');
  const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (!reader) throw new Error('empty');
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) throw new Error('size'); chunks.push(part.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export function createLocalTtsHandler(fetcher: typeof fetch = fetch, speechTimeout = 90000, builtin = { url: 'http://127.0.0.1:8881/v1', fetcher }) {
  let active = 0;
  return async (request: Request, operation: 'voices' | 'speech') => {
    if (request.method !== 'POST') return fail('method', '请使用 POST 请求', 405);
    const origin = new URL(request.url).origin;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname) || request.headers.get('origin') !== origin) return fail('origin', 'TTS 只接受本机同源页面请求', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return fail('content_type', '请使用 JSON 请求', 415);
    const authorization = request.headers.get('authorization');
    if(authorization && !/^Bearer [^\s]{1,500}$/.test(authorization)) return fail('tts_key','TTS 密钥格式不正确',400);
    let parsed: z.infer<typeof speech> | z.infer<typeof base>; let target: string; let isBuiltin = false, remote = false;
    try {
      const rawBytes = await bounded(new Response(request.body), 30000);
      const result = (operation === 'speech' ? speech : base.strict()).safeParse(JSON.parse(new TextDecoder().decode(rawBytes)));
      if (!result.success) return fail('parameters', 'TTS 参数不正确；单次最多朗读 4096 个字符', 400);
      parsed = result.data;
      isBuiltin = parsed.url === 'builtin';
      if(isBuiltin && authorization) return fail('unexpected_key','内置 Kokoro 不需要 API key',400);
      const url = isBuiltin ? builtin.url : externalTtsUrl(parsed.url);
      remote = !isBuiltin && !['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname);
      if(remote && !authorization) return fail('tts_key','请填写第三方 TTS 服务的 API key；内置 Kokoro 无需密钥',401);
      if(operation === 'speech') { const p = parsed as z.infer<typeof speech>;
        if(isBuiltin && (!voiceMatches(p.voice,p.language) || p.model!=='kokoro' || p.speed<0.5 || p.speed>2)) return fail('voice_language','请检查内置 Kokoro 模型、语速与语言音色',400);
        if(!/^[a-zA-Z0-9._:/-]{1,120}$/.test(p.voice)) return fail('voice_language','TTS 音色格式不正确',400);
      }
      target = url + (operation === 'speech' ? '/audio/speech' : remote ? '/models' : '/audio/voices');
    } catch { return fail('parameters', '请检查 TTS 地址与请求格式；第三方服务须使用已支持的 HTTPS 域名', 400); }
    if (request.signal.aborted) return fail('cancelled', '朗读已取消', 499);
    if (active >= 1) return fail('tts_busy', 'TTS 正在合成另一个请求，请稍后点击朗读', 429);
    active++;
    const controller = new AbortController(); let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, operation === 'speech' ? speechTimeout : 5000);
    const cancel = () => controller.abort(); request.signal.addEventListener('abort', cancel, { once: true });
    try {
      const payload = parsed as z.infer<typeof speech>;
      const response = await (isBuiltin ? builtin.fetcher : fetcher)(target, { method: operation === 'speech' ? 'POST' : 'GET', signal: controller.signal, cache: 'no-store', redirect: 'error', headers: { ...(operation === 'speech' ? { 'Content-Type': 'application/json' } : {}), ...(!isBuiltin && authorization ? { Authorization: authorization } : {}) },
        ...(operation === 'speech' ? { body: JSON.stringify({ model: payload.model, input: payload.input, voice: payload.voice, ...((isBuiltin || !remote) ? {language: payload.language} : {}), speed: payload.speed, response_format: 'wav', stream: false }) } : {}) });
      if (!response.ok) {
        await response.body?.cancel();
        return fail('tts_provider', response.status === 503 || response.status === 429 ? 'TTS 服务繁忙或限流，请稍后点击朗读' : response.status === 401 || response.status === 403 ? '第三方 TTS 密钥无效或没有权限，请检查密钥与提供方' : response.status === 400 || response.status === 422 ? 'TTS 不接受当前模型、音色或文字，请检查配置' : 'TTS 服务未能完成请求，请检查服务状态', 502);
      }
      const bytes = await bounded(response, operation === 'speech' ? 32 * 1024 * 1024 : 64000);
      if (controller.signal.aborted) throw new Error('cancelled');
      if (operation === 'voices') {
        const data = JSON.parse(new TextDecoder().decode(bytes));
        if(remote) { if(!Array.isArray(data.data)) return fail('tts_models','第三方服务没有返回兼容的模型列表，请检查 API 地址',502); return json({voices:[]}); }
        const voices = Array.isArray(data.voices) ? data.voices.filter((v: unknown) => typeof v === 'string' && /^[abjz][fm]_[a-z0-9_]{1,70}$/.test(v)).slice(0,150) : [];
        if (!voices.length) return fail('tts_voices', '服务没有返回可用的 Kokoro 音色，请检查 API 地址', 502);
        return json({ voices });
      }
      if (bytes.length < 44 || new TextDecoder().decode(bytes.slice(0,4)) !== 'RIFF' || new TextDecoder().decode(bytes.slice(8,12)) !== 'WAVE') return fail('tts_audio', 'TTS 没有返回有效的 WAV 音频', 502);
      return new Response(bytes, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(bytes.length) } });
    } catch (error) {
      return fail(timedOut ? 'tts_timeout' : request.signal.aborted ? 'cancelled' : 'tts_network', timedOut ? 'TTS 合成超时，已停止；可缩短文字后重试' : request.signal.aborted ? '朗读已取消' : (error as Error)?.message === 'size' ? 'TTS 返回内容过大，请缩短文字' : '无法连接 TTS；内置模型请确认 Docker 中的 kokoro 已健康，第三方服务请检查 API 地址与网络', timedOut ? 504 : request.signal.aborted ? 499 : 502);
    } finally { clearTimeout(timer); request.signal.removeEventListener('abort', cancel); active--; }
  };
}
