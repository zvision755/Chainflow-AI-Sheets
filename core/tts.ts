export const ttsLanguages = { off: '不朗读', ja: '日语', en: '英语（美式）', 'en-gb': '英语（英式）', zh: '中文' } as const;
export type TtsLanguage = keyof typeof ttsLanguages;
export type SpokenLanguage = Exclude<TtsLanguage, 'off'>;
export type TtsConfig = { url: string; model: string; speed: number; voices: Record<SpokenLanguage, string> };
export const TTS_STORAGE = 'chainflow-tts-v1';
export const defaultTtsConfig: TtsConfig = { url: 'http://127.0.0.1:8880/v1', model: 'kokoro', speed: 1, voices: { ja: 'jf_alpha', en: 'af_heart', 'en-gb': 'bf_emma', zh: 'zf_xiaobei' } };
export const voicePrefixes: Record<SpokenLanguage, string> = { ja: 'j', en: 'a', 'en-gb': 'b', zh: 'z' };
export function voiceMatches(voice: string, language: SpokenLanguage) { return new RegExp(`^${voicePrefixes[language]}[fm]_[a-z0-9_]{1,70}$`).test(voice); }
export function ttsBaseUrl(value: string) {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('TTS 地址只支持本机回环地址，不接受远程地址、凭证或查询参数');
  if (url.port && Number(url.port) < 1024) throw new Error('请使用 1024 或以上的本地 TTS 服务端口');
  const path = url.pathname.replace(/\/+$/, '');
  if (!['', '/v1', '/v1/audio/speech'].includes(path)) throw new Error('请填写 TTS 基础地址、/v1 或完整 /v1/audio/speech 地址');
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  url.pathname = '/v1';
  return url.href.replace(/\/$/, '');
}
export function validateTtsConfig(raw: unknown): TtsConfig {
  const value = raw as TtsConfig;
  if (!value || typeof value.url !== 'string' || value.url.length > 500 || typeof value.model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,100}$/.test(value.model) || !Number.isFinite(value.speed) || value.speed < 0.25 || value.speed > 4) throw new Error('请检查 TTS 地址、模型名称与语速（0.25–4）');
  const voices = Object.fromEntries((Object.keys(voicePrefixes) as SpokenLanguage[]).map(language => {
    const voice = value.voices?.[language];
    if (typeof voice !== 'string' || !voiceMatches(voice, language)) throw new Error(`${ttsLanguages[language]}音色与语言不匹配`);
    return [language, voice];
  })) as TtsConfig['voices'];
  return { url: ttsBaseUrl(value.url), model: value.model, speed: value.speed, voices };
}
export function readTtsConfig(raw: string | null) { try { return validateTtsConfig(JSON.parse(raw ?? 'null')); } catch { return structuredClone(defaultTtsConfig); } }
