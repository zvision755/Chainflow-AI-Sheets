'use client';

import { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Upload, X } from 'lucide-react';
import { readImportFile, type ImportedFile } from '../core/bulk-import';

export function FileImport({ onClose, onInsert, disabled }: {
  onClose: () => void;
  onInsert: (values: string[]) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<ImportedFile|null>(null);
  const [sheetName, setSheetName] = useState('');
  const [header, setHeader] = useState(false);
  const [txtMode, setTxtMode] = useState<'lines'|'paragraphs'>('lines');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const sheet = data?.sheets.find(item => item.name === sheetName) ?? data?.sheets[0];
  const values = useMemo(() => {
    if (!data) return [];
    if (data.kind === 'text') {
      const text = data.sheets[0].rows[0]?.[0] ?? '';
      const pieces = txtMode === 'paragraphs' ? text.split(/\n\s*\n+/) : text.split(/\r?\n/);
      return pieces.map(piece => piece.trim()).filter(Boolean);
    }
    const rows = sheet?.rows ?? [];
    return rows.slice(header ? 1 : 0).map(row => row[0]?.trim() ?? '').filter(Boolean);
  }, [data, sheet, header, txtMode]);
  const preview = values.slice(0, 5);

  async function selectFile(file?: File) {
    if (!file) return;
    setLoading(true); setError(''); setData(null);
    try {
      const parsed = await readImportFile(file);
      setData(parsed); setSheetName(parsed.sheets[0]?.name ?? ''); setHeader(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '文件读取失败，请确认文件格式。');
    } finally { setLoading(false); }
  }

  return <div className="overlay" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="file-import-title" className="dialog article-dialog file-import-dialog" onClick={event => event.stopPropagation()}>
      <button className="close" aria-label="关闭文件导入" onClick={onClose}><X size={20}/></button>
      <div className="dialog-icon"><FileSpreadsheet size={23}/></div>
      <h2 id="file-import-title">导入句子文件</h2>
      <p>把外部工具整理好的句子导入当前表格 A 列。支持 Excel、CSV、TSV 和 TXT；只导入第一列或文本条目，不会自动运行 AI。</p>
      <input ref={input} hidden type="file" accept=".xlsx,.csv,.tsv,.txt,.text,text/plain" onChange={event => { void selectFile(event.target.files?.[0]); event.target.value=''; }}/>
      <button className="file-drop button" disabled={disabled||loading} onClick={()=>input.current?.click()}><Upload size={17}/>{loading?'正在读取…':data?`更换文件（${data.name}）`:'选择 Excel / CSV / TSV / TXT 文件'}</button>
      {data?.kind==='table'&&<>
        {data.sheets.length>1&&<label>工作表<select aria-label="选择导入工作表" value={sheetName} onChange={event=>setSheetName(event.target.value)}>{data.sheets.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</select></label>}
        <label className="import-check"><input type="checkbox" checked={header} onChange={event=>setHeader(event.target.checked)}/>跳过首行表头</label>
        <small className="import-hint">仅读取所选工作表的第一列；其他列不会导入。</small>
      </>}
      {data?.kind==='text'&&<label>TXT 条目分隔方式<select aria-label="TXT 条目分隔方式" value={txtMode} onChange={event=>setTxtMode(event.target.value as 'lines'|'paragraphs')}><option value="lines">每行一条</option><option value="paragraphs">空行分段（适合段落间空一行的文本）</option></select></label>}
      {error&&<div className="cell-error" role="alert">{error}</div>}
      {data&&<>
        <div className="article-count" aria-live="polite">识别到 <strong>{values.length}</strong> 条{data.kind==='table'?'非空第一列数据':'文本条目'} · 最多导入 500 行</div>
        {preview.length>0&&<div className="article-preview"><strong>导入预览</strong><ol>{preview.map((value,index)=><li key={index}>{value}</li>)}</ol>{values.length>preview.length&&<small>还有 {values.length-preview.length} 条</small>}</div>}
      </>}
      <div className="dialog-actions"><button className="button" onClick={onClose}>取消</button><button className="button primary" disabled={disabled||loading||values.length===0} onClick={()=>onInsert(values)}>填入 {values.length} 行</button></div>
    </section>
  </div>;
}
