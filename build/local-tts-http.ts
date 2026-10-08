// Local preview only: production Workers cannot reach a visitor's Mac.
import { z } from 'zod';
import { externalTtsUrl, voiceMatches, type SpokenLanguage } from '../core/tts';
import { json } from '../server/proxy';
const base = z.object({ url: z.string().min(1).max(500) });
const speech = base.extend({ model: z.string().regex(/^[a-zA-Z0-9._:/-]{1,100}$/), input: z.string().trim().min(1).max(4096), language: z.enum(['ja', 'en', 'en-gb', 'zh']), voice: z.string().max(120), speed: z.number().min(0.25).max(4) }).strict();
const fail = (code: string, message: string, status: number) => json({ error: { code, message, retryable: false } }, status);
const VOLCENGINE_TTS_URL = 'https://translate.volcengine.com/crx/tts/v1/';
const volcengineLanguage: Record<SpokenLanguage, string> = { ja: 'jp', en: 'en', 'en-gb': 'en', zh: 'zh' };
const audioType = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WAVE' ? 'audio/wav' :
  (new TextDecoder().decode(bytes.slice(0,3)) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) ? 'audio/mpeg' : '';
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
function isPrivateIPv4(hostname: string) {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export function createLocalTtsHandler(fetcher: typeof fetch = fetch, speechTimeout = 90000, builtin = { url: 'http://127.0.0.1:8881/v1', fetcher }, allowLan = false) {
  let active = 0;
  return async (request: Request, operation: 'voices' | 'speech') => {
    if (request.method !== 'POST') return fail('method', '请使用 POST 请求', 405);
    const pageUrl = new URL(request.url);
    const origin = pageUrl.origin;
    const localHost = ['127.0.0.1', 'localhost', '[::1]'].includes(pageUrl.hostname);
    const lanHost = allowLan && isPrivateIPv4(pageUrl.hostname);
    if ((!localHost && !lanHost) || request.headers.get('origin') !== origin) return fail('origin', 'TTS 只接受本机同源页面请求', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return fail('content_type', '请使用 JSON 请求', 415);
    const authorization = request.headers.get('authorization');
    if(authorization && !/^Bearer [^\s]{1,500}$/.test(authorization)) return fail('tts_key','TTS 密钥格式不正确',400);
    let parsed: z.infer<typeof speech> | z.infer<typeof base>; let target: string; let isBuiltin = false, isVolcengine = false, remote = false;
    try {
      const rawBytes = await bounded(new Response(request.body), 30000);
      const result = (operation === 'speech' ? speech : base.strict()).safeParse(JSON.parse(new TextDecoder().decode(rawBytes)));
      if (!result.success) return fail('parameters', 'TTS 参数不正确；单次最多朗读 4096 个字符', 400);
      parsed = result.data;
      isBuiltin = parsed.url === 'builtin';
      isVolcengine = parsed.url === 'volcengine-free';
      if(isBuiltin && authorization) return fail('unexpected_key','内置 Kokoro 不需要 API key',400);
      if(isVolcengine && authorization) return fail('unexpected_key','免配置火山 TTS 不接受 API key',400);
      const url = isBuiltin ? builtin.url : isVolcengine ? VOLCENGINE_TTS_URL : externalTtsUrl(parsed.url);
      remote = !isBuiltin && !['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname);
      if(remote && !isVolcengine && !authorization) return fail('tts_key','请填写第三方 TTS 服务的 API key；免配置火山 TTS 无需密钥',401);
      if(operation === 'speech') { const p = parsed as z.infer<typeof speech>;
        if(isBuiltin && (!voiceMatches(p.voice,p.language) || p.model!=='kokoro' || p.speed<0.5 || p.speed>2)) return fail('voice_language','请检查内置 Kokoro 模型、语速与语言音色',400);
        if(isVolcengine && (!voiceMatches(p.voice,p.language,'volcengine') || p.model!=='volcengine-tts' || p.speed!==1)) return fail('voice_language','请检查火山 TTS 模型与语言音色',400);
        if(!/^[a-zA-Z0-9._:/-]{1,120}$/.test(p.voice)) return fail('voice_language','TTS 音色格式不正确',400);
      }
      target = isVolcengine ? url : url + (operation === 'speech' ? '/audio/speech' : remote ? '/models' : '/audio/voices');
    } catch { return fail('parameters', '请检查 TTS 地址与请求格式；第三方服务须使用已支持的 HTTPS 域名', 400); }
    if (request.signal.aborted) return fail('cancelled', '朗读已取消', 499);
    if (active >= 1) return fail('tts_busy', 'TTS 正在合成另一个请求，请稍后点击朗读', 429);
    active++;
    const controller = new AbortController(); let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, operation === 'speech' ? speechTimeout : 5000);
    const cancel = () => controller.abort(); request.signal.addEventListener('abort', cancel, { once: true });
    try {
      const payload = parsed as z.infer<typeof speech>;
      // Pot's tauriFetch unwraps {type: 'Json', payload}; HTTP receives only payload.
      const volcPayload = (speechPayload: z.infer<typeof speech>) => ({ text: speechPayload.input, speaker: speechPayload.voice, language: volcengineLanguage[speechPayload.language] });
      // This optional provider is an undocumented community integration. Keep its host fixed,
      // do not forward credentials, and keep its response transient and size-limited.
      const response = await (isBuiltin ? builtin.fetcher : fetcher)(target, { method: isVolcengine || operation === 'speech' ? 'POST' : 'GET', signal: controller.signal, cache: 'no-store', redirect: 'error', headers: {
          ...((isVolcengine || operation === 'speech') ? { 'Content-Type': 'application/json', Accept: isVolcengine ? 'application/json, text/plain, */*' : 'audio/wav' } : {}),
          ...(isVolcengine ? { 'Accept-Encoding': 'identity', Origin: 'chrome-extension://klgfhbdadaspgppeadghjjemk', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'none', Cookie: 'hasUserBehavior=1', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36' } : {}),
          ...(!isBuiltin && !isVolcengine && authorization ? { Authorization: authorization } : {})
        },
        ...(isVolcengine ? { body: JSON.stringify(volcPayload(operation === 'speech' ? payload : { url: 'volcengine-free', model: 'volcengine-tts', input: '测试', language: 'zh', voice: 'zh_male_xiaoming', speed: 1 })) } :
          operation === 'speech' ? { body: JSON.stringify({ model: payload.model, input: payload.input, voice: payload.voice, ...((isBuiltin || !remote) ? {language: payload.language} : {}), speed: payload.speed, response_format: 'wav', stream: false }) } : {}) });
      if (!response.ok) {
        await response.body?.cancel();
        if(isVolcengine) return fail('tts_provider', response.status === 429 ? '免鉴权火山 TTS 当前限流，请稍后再试；此接口没有稳定性承诺' : `免鉴权火山 TTS 拒绝了请求（HTTP ${response.status}），接口可能已变更或限制请求来源；请切回 Kokoro 或稍后再试`, 502);
        return fail('tts_provider', response.status === 503 || response.status === 429 ? 'TTS 服务繁忙或限流，请稍后点击朗读' : response.status === 401 || response.status === 403 ? '第三方 TTS 密钥无效或没有权限，请检查密钥与提供方' : response.status === 400 || response.status === 422 ? 'TTS 不接受当前模型、音色或文字，请检查配置' : 'TTS 服务未能完成请求，请检查服务状态', 502);
      }
      const bytes = await bounded(response, isVolcengine ? 16 * 1024 * 1024 : operation === 'speech' ? 32 * 1024 * 1024 : 64000);
      if (controller.signal.aborted) throw new Error('cancelled');
      if(isVolcengine) {
        let encoded: unknown;
        try { const data=JSON.parse(new TextDecoder().decode(bytes));encoded=(data as {audio?:{data?:unknown}})?.audio?.data; } catch { return fail('tts_audio','免鉴权火山服务返回了无法识别的数据',502); }
        if(typeof encoded!=='string'||encoded.length>44*1024*1024||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return fail('tts_audio','免鉴权火山服务没有返回有效音频',502);
        const audio=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
        if(audio.length<44||audio.length>32*1024*1024) return fail('tts_audio','免鉴权火山服务返回的音频长度不正确',502);
        const type=audioType(audio);
        if(!type) return fail('tts_audio','免鉴权火山服务返回了不支持的音频格式',502);
        if(operation==='voices') return json({voices:[]});
        return new Response(audio,{headers:{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':String(audio.length)}});
      }
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
