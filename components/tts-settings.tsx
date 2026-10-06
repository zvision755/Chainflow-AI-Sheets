'use client';
import { useEffect, useRef, useState } from 'react';
import { Volume2, X } from 'lucide-react';
import { defaultTtsConfig, externalTtsConfig, ttsLanguages, ttsRemoteHosts, validateTtsConfig, voiceMatches, type SpokenLanguage, type TtsConfig } from '../core/tts';
import { loadTtsVoices } from '../model/tts';
export function TtsSettings({ config, apiKey, available, onSave, onClose }: { config: TtsConfig; apiKey: string; available: boolean; onSave: (config: TtsConfig, apiKey: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(() => structuredClone(config)), [key, setKey] = useState(apiKey);
  const [voices, setVoices] = useState<string[]>([]), [status, setStatus] = useState(''), [testing, setTesting] = useState(false), [connected, setConnected] = useState(false);
  const builtin = draft.provider === 'builtin' || draft.url === 'builtin';
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function change(next: TtsConfig) { controller.current?.abort(); setTesting(false); setStatus(''); setConnected(false); setDraft(next); }
  async function testConnection() {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 8000); setTesting(true); setStatus(''); setConnected(false);
    try { const settings = validateTtsConfig(draft); const list = await loadTtsVoices(settings.url, abort.signal, builtin ? '' : key.trim()); if (controller.current !== abort || abort.signal.aborted) return; setVoices(list); setConnected(true); setStatus(builtin ? `内置 Kokoro 已就绪，${list.length} 个音色；CPU 本地合成，无 API 费用。` : `第三方 TTS 已连接${list.length ? `，发现 ${list.length} 个音色` : '；请填写该服务支持的音色名称'}。测试不会合成音频。`); }
    catch (error) { if (controller.current === abort) setStatus(abort.signal.aborted ? '连接测试超时或已取消，请检查 TTS 服务' : error instanceof Error ? error.message : '连接失败'); }
    finally { clearTimeout(timer); if (controller.current === abort) setTesting(false); }
  }
  return <div className="overlay" onClick={onClose}><section role="dialog" aria-modal="true" aria-labelledby="tts-title" className="dialog tts-dialog" onClick={e => e.stopPropagation()}>
    <button className="close" aria-label="关闭 TTS 配置" onClick={onClose}><X size={20}/></button><div className="dialog-icon"><Volume2 size={24}/></div><h2 id="tts-title">朗读与 TTS</h2>
    <p>点击单元格朗读即时合成并播放；只在内存保留当前音频，播放结束或停止后释放。</p>
    {!available && <div className="provider-help">内置 Kokoro 需要本机 Docker 版。公开 Sites 暂不提供本机模型。</div>}
    <label>TTS 提供方<select aria-label="TTS 提供方" value={builtin ? 'builtin' : 'external'} onChange={e => { setVoices([]); setKey(''); change(structuredClone(e.target.value === 'builtin' ? defaultTtsConfig : externalTtsConfig)); }}><option value="builtin">内置 Kokoro（默认 · 免费 · 本地 CPU）</option><option value="external">第三方 TTS API</option></select></label>
    {builtin ? <div className="key-disclosure">模型、音色和词典随 Docker 项目启动，无须 LaunchManager 或单独安装。支持日语、英语与中文；断网也能朗读，合成速度取决于 CPU。</div> : <><label>TTS API 地址<input aria-label="TTS API 地址" type="url" autoComplete="off" value={draft.url} placeholder="https://api.openai.com/v1" onChange={e => { setKey(''); setVoices([]); change({ ...draft, url: e.target.value }); }}/><small>OpenAI 兼容的 /v1/audio/speech。支持本机接口，以及 {ttsRemoteHosts.join('、')}。</small></label><label>TTS API key（可选）<input aria-label="TTS API key" type="password" autoComplete="off" maxLength={500} value={key} onChange={e => { change(draft); setKey(e.target.value); }}/><small>远程服务通常需要；只保存在当前页面内存，不记忆、不导出，刷新后重新填写。</small></label><div className="key-disclosure">第三方服务可能收费，费用由你的账户承担。文字与密钥经本站转发给所选服务，本站代码不持久保存密钥。测试连接不产生合成费用；模型是否支持朗读仍以实际合成为准。</div></>}
    <div className="field-pair"><label>TTS 模型<input aria-label="TTS 模型" readOnly={builtin} value={draft.model} onChange={e => change({ ...draft, model: e.target.value })}/></label><label>朗读语速<input aria-label="朗读语速" type="number" min={builtin ? 0.5 : 0.25} max={builtin ? 2 : 4} step={0.05} value={draft.speed} onChange={e => change({ ...draft, speed: Number(e.target.value) })}/></label></div>
    {(Object.keys(draft.voices) as SpokenLanguage[]).map(language => { const choices = voices.filter(voice => voiceMatches(voice, language)); return <label key={language}>{ttsLanguages[language]}音色{choices.length ? <select aria-label={`${ttsLanguages[language]}音色`} value={draft.voices[language]} onChange={e => change({ ...draft, voices: { ...draft.voices, [language]: e.target.value } })}>{!choices.includes(draft.voices[language]) && <option value={draft.voices[language]}>{draft.voices[language]}</option>}{choices.map(voice => <option key={voice}>{voice}</option>)}</select> : <input aria-label={`${ttsLanguages[language]}音色`} value={draft.voices[language]} onChange={e => change({ ...draft, voices: { ...draft.voices, [language]: e.target.value } })}/>}</label>; })}
    <div className="key-disclosure">每列单独选择语言，也可关闭。一次最多 4096 个字符，音频不写入浏览器存储、JSON/CSV 或磁盘。完成合成后播放；停止会立即停止播放，正在运行的模型合成可能继续到结束。</div>
    {status && <div role="status" className={'tts-result ' + (connected ? 'connected' : '')}>{status}</div>}
    <div className="dialog-actions"><button className="button" disabled={!available || testing} onClick={() => void testConnection()}>{testing ? '测试中…' : '测试连接'}</button><button className="button primary" onClick={() => { try { onSave(validateTtsConfig(draft), builtin ? '' : key.trim()); } catch (error) { setStatus(error instanceof Error ? error.message : 'TTS 配置不正确'); setConnected(false); } }}>保存配置</button></div>
  </section></div>;
}
