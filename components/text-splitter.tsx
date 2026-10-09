'use client';

import { useMemo, useState } from 'react';
import { Scissors, X } from 'lucide-react';
import { splitLongText } from '../core/text-segmenter';
import {MAX_SHEET_ROWS} from '../core/types';
import {TextSplitControls,useTextSplitSettings} from './text-split-controls';


export function TextSplitter({ onClose, onInsert, disabled, availableRows = MAX_SHEET_ROWS }: {
  onClose: () => void;
  onInsert: (values: string[]) => void;
  disabled: boolean; availableRows?:number;
}) {
  const [text, setText] = useState('');
  const {settings,setSettings,options}=useTextSplitSettings();
  const values = useMemo(() => splitLongText(text, options), [text,options]);
  const preview = values.slice(0, 8);

  return <div className="overlay" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="text-splitter-title" className="dialog article-dialog text-splitter-dialog" onClick={event => event.stopPropagation()}>
      <button className="close" aria-label="关闭长文拆句" onClick={onClose}><X size={20}/></button>
      <div className="dialog-icon"><Scissors size={23}/></div>
      <h2 id="text-splitter-title">长文拆句并填入</h2>
      <p>粘贴文章后按标点和换行规则拆分，预览确认后填入当前工作表 A 列。这里只整理文本，不会自动运行 AI。</p>
      <label className="splitter-source">长文<textarea aria-label="待拆分长文" value={text} onChange={event => setText(event.target.value)} placeholder="在这里粘贴日语、中文、英文或其他长文…" rows={7} maxLength={320000}/></label>
      <TextSplitControls settings={settings} onChange={setSettings}/>
      <div className="article-count" aria-live="polite">拆分为 <strong>{values.length}</strong> 条 · 整表上限 {MAX_SHEET_ROWS} 行 · 当前还可填入 {availableRows} 条 · 当前规则：{options.delimiters || '无标点规则'}</div>
      {values.length>availableRows&&<p role="alert" className="cell-error">条数超过整张表剩余容量，本次不会写入任何内容。请减少条数再填入。</p>}
      {preview.length > 0 && <div className="article-preview"><strong>拆分预览</strong><ol>{preview.map((value, index) => <li key={index}>{value}</li>)}</ol>{values.length > preview.length && <small>还有 {values.length - preview.length} 条</small>}</div>}
      <div className="dialog-actions"><button className="button" onClick={onClose}>取消</button><button className="button primary" disabled={disabled || values.length === 0 || values.length>availableRows} onClick={() => onInsert(values)}>填入 {values.length} 行</button></div>
    </section>
  </div>;
}
