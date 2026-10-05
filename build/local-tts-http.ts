// Local preview only: production Workers cannot reach a visitor's Mac.
import { z } from 'zod';
import { ttsBaseUrl, voiceMatches, type SpokenLanguage } from '../core/tts';
import { json } from '../server/proxy';
const base = z.object({ url: z.string().min(1).max(500) });
const speech = base.extend({ model: z.string().regex(/^[a-zA-Z0-9._:/-]{1,100}$/), input: z.string().trim().min(1).max(4096), language: z.enum(['ja', 'en', 'en-gb', 'zh']), voice: z.string().max(80), speed: z.number().min(0.25).max(4) }).strict();
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
export function createLocalTtsHandler(fetcher: typeof fetch = fetch, speechTimeout = 90000) {
  let active = 0;
  return async (request: Request, operation: 'voices' | 'speech') => {
    if (request.method !== 'POST') return fail('method', '请使用 POST 请求', 405);
    const origin = new URL(request.url).origin;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname) || request.headers.get('origin') !== origin) return fail('origin', 'TTS 只接受本机同源页面请求', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return fail('content_type', '请使用 JSON 请求', 415);
    if (request.headers.has('authorization')) return fail('unexpected_key', '本地 Kokoro 不需要 API key', 400);
    let parsed: z.infer<typeof speech> | z.infer<typeof base>; let target: string;
    try {
      const rawBytes = await bounded(new Response(request.body), 30000);
      const result = (operation === 'speech' ? speech : base.strict()).safeParse(JSON.parse(new TextDecoder().decode(rawBytes)));
      if (!result.success) return fail('parameters', 'TTS 参数不正确；单次最多朗读 4096 个字符', 400);
      parsed = result.data;
      if (operation === 'speech' && !voiceMatches((parsed as z.infer<typeof speech>).voice, (parsed as z.infer<typeof speech>).language as SpokenLanguage)) return fail('voice_language', '音色与朗读语言不匹配，请检查 TTS 配置', 400);
      target = ttsBaseUrl(parsed.url) + (operation === 'speech' ? '/audio/speech' : '/audio/voices');
    } catch { return fail('parameters', '请检查 TTS 地址与请求格式；只支持本机回环地址', 400); }
    if (request.signal.aborted) return fail('cancelled', '朗读已取消', 499);
    if (active >= 1) return fail('tts_busy', 'TTS 正在合成另一个请求，请稍后点击朗读', 429);
    active++;
    const controller = new AbortController(); let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, operation === 'speech' ? speechTimeout : 5000);
    const cancel = () => controller.abort(); request.signal.addEventListener('abort', cancel, { once: true });
    try {
      const payload = parsed as z.infer<typeof speech>;
      const response = await fetcher(target, { method: operation === 'speech' ? 'POST' : 'GET', signal: controller.signal, cache: 'no-store', redirect: 'error', headers: operation === 'speech' ? { 'Content-Type': 'application/json' } : undefined,
        ...(operation === 'speech' ? { body: JSON.stringify({ model: payload.model, input: payload.input, voice: payload.voice, language: payload.language, speed: payload.speed, response_format: 'wav', stream: false }) } : {}) });
      if (!response.ok) {
        await response.body?.cancel();
        return fail('tts_provider', response.status === 503 || response.status === 429 ? 'Kokoro 合成队列已满，请稍后点击朗读' : response.status === 400 || response.status === 422 ? 'Kokoro 不接受当前模型、音色或文字，请检查配置' : 'TTS 服务未能完成请求，请检查 Kokoro 服务', 502);
      }
      const bytes = await bounded(response, operation === 'speech' ? 32 * 1024 * 1024 : 64000);
      if (controller.signal.aborted) throw new Error('cancelled');
      if (operation === 'voices') {
        const data = JSON.parse(new TextDecoder().decode(bytes));
        const voices = Array.isArray(data.voices) ? data.voices.filter((v: unknown) => typeof v === 'string' && /^[abjz][fm]_[a-z0-9_]{1,70}$/.test(v)).slice(0,150) : [];
        if (!voices.length) return fail('tts_voices', '服务没有返回可用的 Kokoro 音色，请检查 API 地址', 502);
        return json({ voices });
      }
      if (bytes.length < 44 || new TextDecoder().decode(bytes.slice(0,4)) !== 'RIFF' || new TextDecoder().decode(bytes.slice(8,12)) !== 'WAVE') return fail('tts_audio', 'TTS 没有返回有效的 WAV 音频', 502);
      return new Response(bytes, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(bytes.length) } });
    } catch (error) {
      return fail(timedOut ? 'tts_timeout' : request.signal.aborted ? 'cancelled' : 'tts_network', timedOut ? 'TTS 合成超过 90 秒，已停止；可缩短文字后重试' : request.signal.aborted ? '朗读已取消' : (error as Error)?.message === 'size' ? 'TTS 返回内容过大，请缩短文字' : '无法连接 TTS，请在 LaunchManager 确认 Kokoro 正在运行并检查 API 地址', timedOut ? 504 : request.signal.aborted ? 499 : 502);
    } finally { clearTimeout(timer); request.signal.removeEventListener('abort', cancel); active--; }
  };
}
