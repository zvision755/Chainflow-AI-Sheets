import { Check, ChevronLeft, ChevronRight, Copy, Play, Square, Volume2 } from 'lucide-react';
import type { Scheduler } from '../core/scheduler';
import { labels, type Column, type Row } from '../core/types';
import { selectedHistoryIndex } from '../core/result-history';
import { ttsLanguages } from '../core/tts';
import type { SpeechState } from '../model/tts';

export type CellActionProps = {
  engine: Scheduler; row: Row; column: Column; rowIndex: number; columnIndex: number;
  copiedCell: string; speech: SpeechState; ttsAvailable: boolean;
  onRun: (targets: { row: string; column: string }[], force?: boolean) => unknown;
  onCopy: (row: string, column: string, text: string) => unknown;
  onSpeak: (row: string, column: Column, text: string) => void;
};
// All views call the same actions. In particular, history selection changes the actual
// downstream source and copying uses the full saved/streaming text, never a preview.
export function CellActions({ engine, row, column: col, rowIndex: index, columnIndex: i, copiedCell, speech, ttsAvailable, onRun, onCopy, onSpeak }: CellActionProps) {
  const cell = row.cells[col.id];
  const history = i > 0 ? engine.recentResults(row.id, col.id) : [];
  const historyIndex = selectedHistoryIndex(cell, history);
  const cellKey = `${row.id}:${col.id}`;
  return <>
    <div className="cell-footer">{i > 0 ? <>
      <span className={'status ' + cell.status}>{cell.status === 'running' && <span className="spinner"/>}{labels[cell.status]}</span>
      {cell.elapsed !== undefined && <span className="cell-time">{(cell.elapsed / 1000).toFixed(1)}s</span>}
      <button className="cell-run" aria-label={`${cell.status === 'error' ? '重试' : '运行'}第 ${index + 1} 行 ${col.name}`}
        title={col.freshResults ? '重新请求此单元格，并在本地检查重复结果' : '重新运行此单元格'} disabled={cell.status === 'running' || cell.status === 'queued'}
        onClick={() => onRun(engine.targets('cell', row.id, col.id), true)}><Play size={12}/>{cell.status === 'error' ? '重试' : col.freshResults && cell.value.trim() ? '换一个' : '运行'}</button>
    </> : <span className="input-caption">可编辑 · 修改后下游需要更新</span>}
      <button className="cell-copy" aria-label={`复制第 ${index + 1} 行 ${col.name}`} title="复制此单元格内容" onClick={() => void onCopy(row.id, col.id, cell.preview ?? cell.value)}>
        {copiedCell === cellKey ? <><Check size={13}/>已复制</> : <><Copy size={13}/>复制</>}
      </button>
    </div>
    {i > 0 && history.length > 0 && <div className="cell-history">
      <button aria-label={`上一条历史 第 ${index + 1} 行 ${col.name}`} title="查看上一条结果；切换后下游需要更新" disabled={engine.busy || historyIndex <= 0} onClick={() => engine.selectHistory(row.id, col.id, historyIndex - 1)}><ChevronLeft size={15}/></button>
      <span>历史 {historyIndex + 1}/{history.length}</span>
      <button aria-label={`下一条历史 第 ${index + 1} 行 ${col.name}`} title="查看下一条结果；切换后下游需要更新" disabled={engine.busy || historyIndex >= history.length - 1} onClick={() => engine.selectHistory(row.id, col.id, historyIndex + 1)}><ChevronRight size={15}/></button>
    </div>}
    {col.ttsLanguage && col.ttsLanguage !== 'off' && <div className="cell-speech">
      <button className="speak-button" aria-label={`朗读第 ${index + 1} 行 ${col.name}`} disabled={!cell.value.trim() || cell.status === 'running' || cell.status === 'queued' || !ttsAvailable}
        title={ttsAvailable ? `${ttsLanguages[col.ttsLanguage]}朗读` : '当前服务不支持 TTS'} onClick={() => onSpeak(row.id, col, cell.value)}>
        {speech.key === cellKey && speech.phase === 'loading' ? <span className="spinner"/> : speech.key === cellKey && speech.phase === 'playing' ? <Square size={13}/> : <Volume2 size={14}/>}
        {speech.key === cellKey && speech.phase === 'loading' ? '取消合成' : speech.key === cellKey && speech.phase === 'playing' ? '停止朗读' : speech.key === cellKey && speech.phase === 'ready' ? '点击播放' : '朗读'}
      </button><small>{ttsLanguages[col.ttsLanguage]}</small>
    </div>}
    {speech.key === cellKey && speech.message && <div className={speech.phase === 'error' ? 'cell-error' : 'retry-note'} role={speech.phase === 'error' ? 'alert' : 'status'}>{speech.message}</div>}
    {cell.error && <div className={cell.status === 'queued' ? 'retry-note' : 'cell-error'} role={cell.status === 'queued' ? 'status' : 'alert'}>{cell.error}</div>}
    {cell.usage && i > 0 && <div className="usage">输入 {cell.usage.input} / 输出 {cell.usage.output} tokens</div>}
  </>;
}
