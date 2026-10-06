export const ttsLanguages = { off: '不朗读', ja: '日语', en: '英语（美式）', 'en-gb': '英语（英式）', zh: '中文' } as const;
export type TtsLanguage = keyof typeof ttsLanguages;
export type SpokenLanguage = Exclude<TtsLanguage, 'off'>;
export type TtsConfig = { provider?: 'builtin' | 'external'; url: string; model: string; speed: number; voices: Record<SpokenLanguage, string> };
export type TtsSession = TtsConfig & { apiKey?: string };
export const TTS_STORAGE = 'chainflow-tts-v1';
export const defaultTtsConfig: TtsConfig = { provider: 'builtin', url: 'builtin', model: 'kokoro', speed: 1, voices: { ja: 'jf_alpha', en: 'af_heart', 'en-gb': 'bf_emma', zh: 'zf_xiaobei' } };
export const externalTtsConfig: TtsConfig = { provider: 'external', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', speed: 1, voices: { ja: 'alloy', en: 'alloy', 'en-gb': 'alloy', zh: 'alloy' } };
export const voicePrefixes: Record<SpokenLanguage, string> = { ja: 'j', en: 'a', 'en-gb': 'b', zh: 'z' };
export const ttsRemoteHosts = ['api.openai.com', 'aihubmix.com', 'api.aihubmix.com', 'openrouter.ai', 'api.siliconflow.cn'];
export function voiceMatches(voice: string, language: SpokenLanguage) { return new RegExp(`^${voicePrefixes[language]}[fm]_[a-z0-9_]{1,70}$`).test(voice); }
export function ttsBaseUrl(value: string) {
  if (value === 'builtin') return value;
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('TTS 地址只支持本机回环地址，不接受远程地址、凭证或查询参数');
  if (url.port && Number(url.port) < 1024) throw new Error('请使用 1024 或以上的本地 TTS 服务端口');
  const path = url.pathname.replace(/\/+$/, '');
  if (!['', '/v1', '/v1/audio/speech'].includes(path)) throw new Error('请填写 TTS 基础地址、/v1 或完整 /v1/audio/speech 地址');
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  url.pathname = '/v1';
  return url.href.replace(/\/$/, '');
}
export function externalTtsUrl(value: string) {
  const url = new URL(value.trim());
  if (['127.0.0.1','localhost','[::1]'].includes(url.hostname)) return ttsBaseUrl(value);
  if (url.protocol !== 'https:' || !ttsRemoteHosts.includes(url.hostname) || (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash) throw new Error('第三方 TTS 只支持已审阅域名的 HTTPS 或本机回环地址；不接受内网、凭证或查询参数');
  if (!['', '/v1', '/v1/audio/speech'].includes(url.pathname.replace(/\/+$/, ''))) throw new Error('请填写 OpenAI 兼容的 /v1 或 /v1/audio/speech 地址');
  url.pathname='/v1';return url.href.replace(/\/$/, '');
}
export function validateTtsConfig(raw: unknown): TtsConfig {
  const value = raw as TtsConfig;
  if (!value || typeof value.url !== 'string' || value.url.length > 500 || typeof value.model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,100}$/.test(value.model) || !Number.isFinite(value.speed) || value.speed < 0.25 || value.speed > 4 || (value.provider !== undefined && !['builtin','external'].includes(value.provider))) throw new Error('请检查 TTS 地址、模型名称与语速');
  const builtin = value.provider === 'builtin' || value.url === 'builtin';
  if(builtin && (value.speed < 0.5 || value.speed > 2 || value.model !== 'kokoro')) throw new Error('内置 Kokoro 的语速范围为 0.5–2，模型为 kokoro');
  const voices = Object.fromEntries((Object.keys(voicePrefixes) as SpokenLanguage[]).map(language => {
    const voice = value.voices?.[language];
    if (typeof voice !== 'string' || (builtin ? !voiceMatches(voice, language) : !/^[a-zA-Z0-9._:/-]{1,120}$/.test(voice))) throw new Error(`${ttsLanguages[language]}音色不正确`);
    return [language, voice];
  })) as TtsConfig['voices'];
  // Explicit allowlist keeps API keys and unknown fields out of saved settings.
  return { provider: builtin ? 'builtin' : 'external', url: builtin ? 'builtin' : externalTtsUrl(value.url), model: value.model, speed: value.speed, voices };
}
export function readTtsConfig(raw: string | null) {
  try { const data = JSON.parse(raw ?? 'null');
    // Existing default host Kokoro installations migrate to the bundled model.
    if(data && !data.provider && ['http://127.0.0.1:8880/v1','http://localhost:8880/v1'].includes(data.url) && data.model==='kokoro') return validateTtsConfig({...data,provider:'builtin',url:'builtin',speed:Math.max(0.5,Math.min(2,data.speed))});
    return validateTtsConfig(data);
  } catch { return structuredClone(defaultTtsConfig); }
}
