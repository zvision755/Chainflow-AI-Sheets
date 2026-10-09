import type { SpokenLanguage, TtsSession } from '../core/tts';
import { sessionFetch as fetch } from './session';
export async function loadTtsVoices(url: string, signal: AbortSignal, apiKey = ''): Promise<string[]> {
  const response = await fetch('/api/local-tts/voices', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiKey ? {Authorization: `Bearer ${apiKey}`} : {}) }, body: JSON.stringify({ url }), signal, cache: 'no-store' });
  const data = await response.json() as { voices: string[]; error?: { message: string } };
  if (!response.ok) throw new Error(data.error?.message ?? '无法连接 TTS 服务');
  return data.voices;
}
export async function synthesizeSpeech(text: string, language: SpokenLanguage, config: TtsSession, signal: AbortSignal): Promise<Blob> {
  if (!text.trim()) throw new Error('单元格没有可朗读的文字');
  if (text.trim().length > 4096) throw new Error('单次最多朗读 4096 个字符，请缩短单元格文字');
  const response = await fetch('/api/local-tts/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.provider === 'external' && config.apiKey ? {Authorization: `Bearer ${config.apiKey}`} : {}) }, body: JSON.stringify({ url: config.url, model: config.model, speed: config.speed, voice: config.voices[language], language, input: text.trim() }), signal, cache: 'no-store' });
  if (!response.ok) { const data = await response.json().catch(() => null) as { error?: { message: string } } | null; throw new Error(data?.error?.message ?? 'TTS 合成失败，请重试'); }
  const contentType = response.headers.get('content-type')?.split(';')[0];
  if (!['audio/wav', 'audio/mpeg'].includes(contentType ?? '')) throw new Error('TTS 返回了不支持的音频格式');
  if (Number(response.headers.get('content-length')) > 32 * 1024 * 1024) { await response.body?.cancel(); throw new Error('音频过大，请缩短单元格文字'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('TTS 没有返回音频');
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 32 * 1024 * 1024) throw new Error('音频过大，请缩短单元格文字'); chunks.push(new Uint8Array(part.value)); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!size) throw new Error('TTS 返回了空音频');
  return new Blob(chunks, { type: contentType });
}
type AudioHandle = Pick<HTMLAudioElement, 'src' | 'play' | 'pause' | 'load' | 'onended' | 'onerror'> & { removeAttribute(name: string): void };
export type SpeechState = { key?: string; phase: 'idle' | 'loading' | 'playing' | 'ready' | 'error'; message?: string };
type Dependencies = { synthesize: typeof synthesizeSpeech; audio: () => AudioHandle; createUrl: (blob: Blob) => string; revokeUrl: (url: string) => void; timeout: number };
export class SpeechPlayer {
  private state: SpeechState = { phase: 'idle' };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller?: AbortController;
  private audio?: AudioHandle;
  private url?: string;
  private spoken?: { key: string; text: string; language: SpokenLanguage };
  private dependencies: Dependencies;
  constructor(dependencies: Partial<Dependencies> = {}) {
    this.dependencies = { synthesize: synthesizeSpeech, audio: () => new Audio(), createUrl: blob => URL.createObjectURL(blob), revokeUrl: url => URL.revokeObjectURL(url), timeout: 100000, ...dependencies };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private update(state: SpeechState) { this.state = state; this.listeners.forEach(listener => listener()); }
  private releaseAudio() {
    if (this.audio) { this.audio.onended = null; this.audio.onerror = null; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio = undefined; }
    if (this.url) { this.dependencies.revokeUrl(this.url); this.url = undefined; }
  }
  stop = () => { this.generation++; this.controller?.abort(); this.controller = undefined; this.releaseAudio(); this.spoken = undefined; this.update({ phase: 'idle' }); };
  cancelIfChanged(key: string | undefined, text?: string, language?: string) { if (this.spoken && (this.spoken.key !== key || this.spoken.text !== text || this.spoken.language !== language)) this.stop(); }
  async speak(key: string, text: string, language: SpokenLanguage, config: TtsSession) {
    this.stop(); const generation = this.generation;
    const controller = new AbortController(); this.controller = controller; this.spoken = { key, text, language };
    this.update({ key, phase: 'loading' });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.dependencies.timeout);
    const abortFailure = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    try {
      const blob = await Promise.race([this.dependencies.synthesize(text, language, config, controller.signal), abortFailure]);
      if (generation !== this.generation || controller.signal.aborted) return;
      clearTimeout(timeout);
      this.audio = this.dependencies.audio(); this.url = this.dependencies.createUrl(blob); this.audio.src = this.url;
      this.audio.onended = () => { if (generation === this.generation) { this.releaseAudio(); this.spoken = undefined; this.update({ phase: 'idle' }); } };
      this.audio.onerror = () => { if (generation === this.generation) { this.releaseAudio(); this.spoken = undefined; this.update({ key, phase: 'error', message: '浏览器无法播放这段音频，请重试' }); } };
      await this.play(generation);
    } catch (error) {
      if (generation === this.generation) { this.releaseAudio(); this.spoken = undefined; this.update({ key, phase: 'error', message: timedOut ? 'TTS 请求超时，已停止；请检查所选服务或缩短文字' : error instanceof Error ? error.message : '朗读失败，请重试' }); }
    } finally { clearTimeout(timeout); if (generation === this.generation) this.controller = undefined; }
  }
  private async play(generation: number) {
    const audio = this.audio; if (!audio) return;
    try { await audio.play(); if (generation === this.generation && this.audio === audio) this.update({ key: this.state.key, phase: 'playing' }); }
    catch (error) {
      if (generation !== this.generation || this.audio !== audio) return;
      if ((error as Error)?.name === 'NotAllowedError') this.update({ key: this.state.key, phase: 'ready', message: '浏览器需要再次点击播放' });
      else { this.releaseAudio(); this.spoken = undefined; this.update({ key: this.state.key, phase: 'error', message: '音频播放失败，请重试' }); }
    }
  }
  resume = () => this.play(this.generation);
}
