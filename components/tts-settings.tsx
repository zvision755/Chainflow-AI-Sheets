'use client';
import { useEffect, useRef, useState } from 'react';
import { Volume2, X } from 'lucide-react';
import { defaultTtsConfig, externalTtsConfig, ttsLanguages, ttsRemoteHosts, validateTtsConfig, voiceMatches, volcengineTtsConfig, volcengineVoices, type SpokenLanguage, type TtsConfig } from '../core/tts';
import { loadTtsVoices } from '../model/tts';
export function TtsSettings({ config, apiKey, available, builtinAvailable=true, engine='cpu', modelControl=false, onSave, onClose }: { config: TtsConfig; apiKey: string; available: boolean; builtinAvailable?: boolean; engine?: 'cpu'|'mlx'; modelControl?:boolean; onSave: (config: TtsConfig, apiKey: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(() => structuredClone(config)), [key, setKey] = useState(apiKey);
  const [voices, setVoices] = useState<string[]>([]), [status, setStatus] = useState(''), [testing, setTesting] = useState(false), [connected, setConnected] = useState(false);
  const builtin = draft.provider === 'builtin' || draft.url === 'builtin';
  const volcengine = draft.provider === 'volcengine' || draft.url === 'volcengine-free';
  const controller = useRef<AbortController | null>(null);
  const [modelState,setModelState]=useState<{state:string;loaded:boolean;autoLoad:boolean}|null>(null),[modelBusy,setModelBusy]=useState(false),[memoryWarning,setMemoryWarning]=useState(false),[autoLoad,setAutoLoad]=useState(false);
  useEffect(()=>{
    if(!modelControl)return;const abort=new AbortController();
    const inspect=()=>fetch('/api/local-tts/runtime',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'inspect'}),signal:abort.signal,cache:'no-store'}).then(async r=>{if(r.ok)setModelState(await r.json());}).catch(()=>{});
    void inspect();const interval=setInterval(()=>void inspect(),1500);return()=>{abort.abort();clearInterval(interval);};
  },[modelControl]);
  async function controlModel(action:'load'|'unload',remember=false){
    setMemoryWarning(false);setModelBusy(true);setStatus(action==='load'?'正在加载内置 MLX 模型…':'正在卸载模型…');setConnected(false);
    try{const r=await fetch('/api/local-tts/runtime',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='load'?{action,autoLoad:remember,acceptedMemoryWarning:true}:{action}),signal:AbortSignal.timeout(100000),cache:'no-store'});const data=await r.json() as {state:string;loaded:boolean;autoLoad:boolean;error?:{message:string}};if(!r.ok)throw Error(data.error?.message||'模型操作失败');setModelState(data);setStatus(action==='load'?'模型已加载，可以朗读。':'模型已卸载，自动加载已关闭。');}
    catch(e){setStatus(e instanceof Error?e.message:'模型操作失败，请重试');}finally{setModelBusy(false);}
  }
  useEffect(() => () => controller.current?.abort(), []);
  function change(next: TtsConfig) { controller.current?.abort(); setTesting(false); setStatus(''); setConnected(false); setDraft(next); }
  async function testConnection() {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 8000); setTesting(true); setStatus(''); setConnected(false);
    try { const settings = validateTtsConfig(draft); const list = await loadTtsVoices(settings.url, abort.signal, builtin || volcengine ? '' : key.trim()); if (controller.current !== abort || abort.signal.aborted) return; setVoices(list); setConnected(true); setStatus(builtin ? `内置 Kokoro 已就绪，${list.length} 个音色；${engine==='mlx'?'MLX/Metal':'CPU'} 本地合成，无 API 费用。` : volcengine ? '免鉴权火山 TTS 在线测试成功。此接口没有官方可用性承诺，测试会合成一段短音频但不播放、不保存。' : `第三方 TTS 已连接${list.length ? `，发现 ${list.length} 个音色` : '；请填写该服务支持的音色名称'}。测试不会合成音频。`); }
    catch (error) { if (controller.current === abort) setStatus(abort.signal.aborted ? '连接测试超时或已取消，请检查 TTS 服务' : error instanceof Error ? error.message : '连接失败'); }
    finally { clearTimeout(timer); if (controller.current === abort) setTesting(false); }
  }
  return <div className="overlay" onClick={onClose}><section role="dialog" aria-modal="true" aria-labelledby="tts-title" className="dialog tts-dialog" onClick={e => e.stopPropagation()}>
    <button className="close" aria-label="关闭 TTS 配置" onClick={onClose}><X size={20}/></button><div className="dialog-icon"><Volume2 size={24}/></div><h2 id="tts-title">朗读与 TTS</h2>
    <p>点击单元格朗读即时合成并播放；只在内存保留当前音频，播放结束或停止后释放。</p>
    {!available && <div className="provider-help">内置 Kokoro 需要本机 Docker 版。公开 Sites 暂不提供本机模型。</div>}
    <label>TTS 提供方<select aria-label="TTS 提供方" value={builtin ? 'builtin' : volcengine ? 'volcengine' : 'external'} onChange={e => { setVoices([]); setKey(''); change(structuredClone(e.target.value === 'builtin' ? defaultTtsConfig : e.target.value === 'volcengine' ? volcengineTtsConfig : externalTtsConfig)); }}><option value="builtin" disabled={!builtinAvailable}>{builtinAvailable?`内置 Kokoro（默认 · 免费 · ${engine==='mlx'?'MLX/Metal':'本地 CPU'}）`:'此版本不包含 Kokoro 模型'}</option><option value="volcengine">火山 TTS（免配置 · 在线实验）</option><option value="external">第三方 TTS API</option></select></label>
    {builtin ? <div className="key-disclosure">模型、音色和词典随安装包提供，无须 LaunchManager 或单独安装。支持日语、英语与中文，断网也能朗读。{engine==='mlx'?'使用 Apple Silicon 的 MLX/Metal GPU。':'使用 ONNX CPU，合成速度取决于 CPU。'}</div> : volcengine ? <div className="key-disclosure"><strong>可选在线接口，近期可用性可能变化。</strong><br/>这是 Pot 社区插件使用的火山翻译 TTS 免鉴权接口，并非火山官方承诺的第三方 API。该插件过去有长期使用记录，但近期重测可能无法使用；ChainFlow 的适配链路在本机通过短文本测试，不代表其他环境或插件当前可用。接口可能调整、限流或暂时不可用。每次朗读都会把文字发送到火山服务；如遇故障，可切回本地 Kokoro。这里不保存或发送 API key。</div> : <><label>TTS API 地址<input aria-label="TTS API 地址" type="url" autoComplete="off" value={draft.url} placeholder="https://api.openai.com/v1" onChange={e => { setKey(''); setVoices([]); change({ ...draft, url: e.target.value }); }}/><small>OpenAI 兼容的 /v1/audio/speech。支持本机接口，以及 {ttsRemoteHosts.join('、')}。</small></label><label>TTS API key（可选）<input aria-label="TTS API key" type="password" autoComplete="off" maxLength={500} value={key} onChange={e => { change(draft); setKey(e.target.value); }}/><small>远程服务通常需要；只保存在当前页面内存，不记忆、不导出，刷新后重新填写。</small></label><div className="key-disclosure">第三方服务可能收费，费用由你的账户承担。文字与密钥经本站转发给所选服务，本站代码不持久保存密钥。测试连接不产生合成费用；模型是否支持朗读仍以实际合成为准。</div></>}
    {builtin&&modelControl&&<div className="key-disclosure tts-model-control"><p>内置模型：{modelState?.loaded?'已加载':modelState?.state==='loading'?'加载中':'未加载'}。默认不占用模型内存。{modelState?.autoLoad?'已记住许可，下次启动自动加载。':'每次启用前会提示内存占用。'}</p>
      <button className="button" disabled={modelBusy||!modelState||modelState.state==='loading'} onClick={()=>{if(modelState?.loaded)void controlModel('unload');else if(modelState?.autoLoad)void controlModel('load',true);else{setAutoLoad(false);setMemoryWarning(true);}}}>{modelBusy?'处理中…':modelState?.loaded?'卸载模型并关闭自动加载':'启用内置模型'}</button>
      {memoryWarning&&<div role="alert"><p><strong>内存占用提示</strong>：Kokoro 与 MLX 运行环境预计占用约 900 MB 内存，合成时可能更高。不使用朗读时可以卸载释放内存。</p><label className="memory-choice"><input type="checkbox" checked={autoLoad} onChange={e=>setAutoLoad(e.target.checked)}/> 不再提示，下次启动自动加载模型</label><div className="dialog-actions"><button className="button" onClick={()=>setMemoryWarning(false)}>取消</button><button className="button primary" onClick={()=>void controlModel('load',autoLoad)}>确认加载模型</button></div></div>}
    </div>}
    <div className="field-pair"><label>TTS 模型<input aria-label="TTS 模型" readOnly={builtin||volcengine} value={draft.model} onChange={e => change({ ...draft, model: e.target.value })}/></label><label>朗读语速<input aria-label="朗读语速" type="number" min={builtin ? 0.5 : 0.25} max={builtin ? 2 : 4} step={0.05} disabled={volcengine} value={draft.speed} onChange={e => change({ ...draft, speed: Number(e.target.value) })}/></label></div>
    {(Object.keys(draft.voices) as SpokenLanguage[]).map(language => { const choices = volcengine ? volcengineVoices[language] : voices.filter(voice => voiceMatches(voice, language, builtin ? 'builtin' : 'external')); return <label key={language}>{ttsLanguages[language]}音色{(choices.length||volcengine) ? <select aria-label={`${ttsLanguages[language]}音色`} value={draft.voices[language]} onChange={e => change({ ...draft, voices: { ...draft.voices, [language]: e.target.value } })}>{!choices.includes(draft.voices[language]) && <option value={draft.voices[language]}>{draft.voices[language]}</option>}{choices.map(voice => <option key={voice}>{voice}</option>)}</select> : <input aria-label={`${ttsLanguages[language]}音色`} value={draft.voices[language]} onChange={e => change({ ...draft, voices: { ...draft.voices, [language]: e.target.value } })}/>}</label>; })}
    <div className="key-disclosure">每列单独选择语言，也可关闭。一次最多 4096 个字符，音频不写入浏览器存储、JSON/CSV 或磁盘。完成合成后播放；停止会立即停止播放，正在运行的模型合成可能继续到结束。</div>
    {status && <div role="status" className={'tts-result ' + (connected ? 'connected' : '')}>{status}</div>}
    <div className="dialog-actions"><button className="button" disabled={!available || testing || (builtin&&modelControl&&!modelState?.loaded)} onClick={() => void testConnection()}>{testing ? '测试中…' : '测试连接'}</button><button className="button primary" onClick={() => { try { onSave(validateTtsConfig(draft), builtin ? '' : key.trim()); } catch (error) { setStatus(error instanceof Error ? error.message : 'TTS 配置不正确'); setConnected(false); } }}>保存配置</button></div>
  </section></div>;
}
