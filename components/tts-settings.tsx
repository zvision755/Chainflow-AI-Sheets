'use client';
import { useEffect, useRef, useState } from 'react';
import { Volume2, X } from 'lucide-react';
import { ttsLanguages, validateTtsConfig, voiceMatches, type SpokenLanguage, type TtsConfig } from '../core/tts';
import { loadTtsVoices } from '../model/tts';
export function TtsSettings({ config, available, onSave, onClose }: { config: TtsConfig; available: boolean; onSave: (config: TtsConfig) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(() => structuredClone(config));
  const [voices, setVoices] = useState<string[]>([]), [status, setStatus] = useState(''), [testing, setTesting] = useState(false), [connected, setConnected] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function change(next: TtsConfig) { controller.current?.abort(); setTesting(false); setStatus(''); setConnected(false); setDraft(next); }
  async function testConnection() {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 8000); setTesting(true); setStatus(''); setConnected(false);
    try { const settings = validateTtsConfig(draft); const list = await loadTtsVoices(settings.url, abort.signal); if (controller.current !== abort || abort.signal.aborted) return; setVoices(list); setConnected(true); setStatus(`Kokoro 已连接，发现 ${list.length} 个音色；测试连接不会合成音频。`); }
    catch (error) { if (controller.current === abort) setStatus(abort.signal.aborted ? '连接测试超时或已取消，请检查 Kokoro 服务' : error instanceof Error ? error.message : '连接失败'); }
    finally { clearTimeout(timer); if (controller.current === abort) setTesting(false); }
  }
  return <div className="overlay" onClick={onClose}><section role="dialog" aria-modal="true" aria-labelledby="tts-title" className="dialog tts-dialog" onClick={e => e.stopPropagation()}>
    <button className="close" aria-label="关闭 TTS 配置" onClick={onClose}><X size={20}/></button><div className="dialog-icon"><Volume2 size={24}/></div><h2 id="tts-title">配置 TTS API</h2>
    <p>连接本机 Kokoro，点击单元格的朗读按钮即时合成并播放；只在内存保留当前音频，播放结束或停止后释放。</p>
    {!available && <div className="provider-help">本机 Kokoro 朗读需要本地预览。公开 Sites 网站无法访问这台 Mac 的服务。</div>}
    <label>TTS API 地址<input aria-label="TTS API 地址" type="url" autoComplete="off" value={draft.url} placeholder="http://127.0.0.1:8880/v1" onChange={e => { setVoices([]); change({ ...draft, url: e.target.value }); }}/><small>基础地址、/v1 或完整 /v1/audio/speech 均可；本地服务无需 API key。</small></label>
    <div className="field-pair"><label>TTS 模型<input aria-label="TTS 模型" value={draft.model} onChange={e => change({ ...draft, model: e.target.value })}/></label><label>朗读语速<input aria-label="朗读语速" type="number" min={0.25} max={4} step={0.05} value={draft.speed} onChange={e => change({ ...draft, speed: Number(e.target.value) })}/></label></div>
    {(Object.keys(draft.voices) as SpokenLanguage[]).map(language => { const choices = voices.filter(voice => voiceMatches(voice, language)); return <label key={language}>{ttsLanguages[language]}音色{choices.length ? <select aria-label={`${ttsLanguages[language]}音色`} value={draft.voices[language]} onChange={e => change({ ...draft, voices: { ...draft.voices, [language]: e.target.value } })}>{!choices.includes(draft.voices[language]) && <option value={draft.voices[language]}>{draft.voices[language]}</option>}{choices.map(voice => <option key={voice}>{voice}</option>)}</select> : <input aria-label={`${ttsLanguages[language]}音色`} value={draft.voices[language]} onChange={e => change({ ...draft, voices: { ...draft.voices, [language]: e.target.value } })}/>}</label>; })}
    <div className="key-disclosure">每列单独选择语言，也可关闭。一次最多 4096 个字符，音频不写入浏览器存储、JSON/CSV 或磁盘。Kokoro 需完成合成后才能播放；停止会立即停止播放，但已提交的模型合成可能继续到结束。</div>
    {status && <div role="status" className={'tts-result ' + (connected ? 'connected' : '')}>{status}</div>}
    <div className="dialog-actions"><button className="button" disabled={!available || testing} onClick={() => void testConnection()}>{testing ? '测试中…' : '测试连接'}</button><button className="button primary" onClick={() => { try { onSave(validateTtsConfig(draft)); } catch (error) { setStatus(error instanceof Error ? error.message : 'TTS 配置不正确'); setConnected(false); } }}>保存配置</button></div>
  </section></div>;
}
