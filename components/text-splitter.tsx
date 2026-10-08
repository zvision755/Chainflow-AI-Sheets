'use client';

import { useMemo, useState } from 'react';
import { Scissors, X } from 'lucide-react';
import { splitLongText } from '../core/text-segmenter';

const presets = {
  '中文 / 日文': '。！？!?；;…',
  英文: '.!?;:',
  '中日英混合': '。！？!?；;….:',
};

export function TextSplitter({ onClose, onInsert, disabled }: {
  onClose: () => void;
  onInsert: (values: string[]) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState('');
  const [preset, setPreset] = useState<keyof typeof presets>('中日英混合');
  const [customDelimiters, setCustomDelimiters] = useState('');
  const [splitLines, setSplitLines] = useState(true);
  const [keepDelimiter, setKeepDelimiter] = useState(true);
  const delimiters = customDelimiters || presets[preset];
  const values = useMemo(() => splitLongText(text, { delimiters, splitLines, keepDelimiter }), [text, delimiters, splitLines, keepDelimiter]);
  const preview = values.slice(0, 8);

  return <div className="overlay" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="text-splitter-title" className="dialog article-dialog text-splitter-dialog" onClick={event => event.stopPropagation()}>
      <button className="close" aria-label="关闭长文拆句" onClick={onClose}><X size={20}/></button>
      <div className="dialog-icon"><Scissors size={23}/></div>
      <h2 id="text-splitter-title">长文拆句并填入</h2>
      <p>粘贴文章后按标点和换行规则拆分，预览确认后填入当前工作表 A 列。这里只整理文本，不会自动运行 AI。</p>
      <label className="splitter-source">长文<textarea aria-label="待拆分长文" value={text} onChange={event => setText(event.target.value)} placeholder="在这里粘贴日语、中文、英文或其他长文…" rows={7} maxLength={320000}/></label>
      <div className="splitter-options">
        <label>标点规则<select aria-label="标点规则" value={customDelimiters ? 'custom' : preset} onChange={event => { if (event.target.value === 'custom') setCustomDelimiters('。！？!?；;…'); else { setCustomDelimiters(''); setPreset(event.target.value as keyof typeof presets); } }}>
          {Object.keys(presets).map(name => <option key={name} value={name}>{name}</option>)}<option value="custom">自定义</option>
        </select></label>
        <label className="splitter-delimiters">切分符号<input aria-label="自定义切分符号" value={delimiters} onChange={event => { setCustomDelimiters(event.target.value); }} placeholder="例如 。！？!?"/></label>
      </div>
      <div className="splitter-checks">
        <label className="import-check"><input type="checkbox" checked={splitLines} onChange={event => setSplitLines(event.target.checked)}/>换行处也切分</label>
        <label className="import-check"><input type="checkbox" checked={keepDelimiter} onChange={event => setKeepDelimiter(event.target.checked)}/>保留句末标点</label>
      </div>
      <div className="article-count" aria-live="polite">拆分为 <strong>{values.length}</strong> 条 · 最多填入 500 行 · 当前规则：{delimiters || '无标点规则'}</div>
      {preview.length > 0 && <div className="article-preview"><strong>拆分预览</strong><ol>{preview.map((value, index) => <li key={index}>{value}</li>)}</ol>{values.length > preview.length && <small>还有 {values.length - preview.length} 条</small>}</div>}
      <div className="dialog-actions"><button className="button" onClick={onClose}>取消</button><button className="button primary" disabled={disabled || values.length === 0} onClick={() => onInsert(values)}>填入 {values.length} 行</button></div>
    </section>
  </div>;
}
