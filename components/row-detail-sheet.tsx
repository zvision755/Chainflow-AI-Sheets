'use client';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Pencil, Play, Plus, Save, Square, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Scheduler } from '../core/scheduler';
import { labels, type Column } from '../core/types';
import { CellActions, type CellActionProps } from './cell-actions';

export type RowSubmitAction = 'stay' | 'next' | 'close';
function TextEditor({ value, label, onChange, onFocus }: { value: string; label: string; onChange: (value: string) => void; onFocus?: () => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!area.current) return;
    area.current.style.height = 'auto';
    area.current.style.height = `${Math.max(110, area.current.scrollHeight)}px`;
  }, [value]);
  return <textarea ref={area} aria-label={label} rows={4} maxLength={32000} value={value}
    onChange={event => onChange(event.target.value)} onFocus={onFocus} placeholder="在此列填写内容…"/>;
}

export function RowDetailSheet({ engine, selection, message, revision, suspended, onClose, onSelect, onSubmit, onSaveDraft, onInputColumn, onRemove, onMove, actions }: {
  engine: Scheduler; selection: { rowId: string | null; columnId: string }; message: string; revision: number; suspended: boolean;
  onClose: () => void; onSelect: (rowId: string, columnId: string) => void;
  onSubmit: (values: Record<string, string>, action: RowSubmitAction) => boolean;
  onSaveDraft: (values: Record<string, string>) => void; onInputColumn: (columnId: string) => void;
  onRemove: (rowId: string) => void; onMove: (rowId: string, delta: number) => void;
  actions: Omit<CellActionProps, 'row' | 'column' | 'rowIndex' | 'columnIndex' | 'engine'>;
}) {
  const sheet = engine.sheet, rowIndex = sheet.rows.findIndex(row => row.id === selection.rowId), row = sheet.rows[rowIndex];
  const isNew = selection.rowId === null;
  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [closeConfirm, setCloseConfirm] = useState(false), [removeConfirm, setRemoveConfirm] = useState(false);
  const [locked, setLocked] = useState(false), [entryVersion, setEntryVersion] = useState(0);
  const content = useRef<HTMLDivElement>(null), panel = useRef<HTMLElement>(null);
  const submitting = useRef(false), release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = Object.values(values).some(value => value.trim());
  const requestClose = useRef(() => {});
  requestClose.current = () => { if (isNew && dirty) setCloseConfirm(true); else onClose(); };
  const currentStatus = row?.cells ? Object.values(row.cells) : [];
  const rowBusy = currentStatus.some(cell => cell.status === 'queued' || cell.status === 'running');
  const rowState = (['running', 'queued', 'error', 'stale', 'cancelled', 'idle', 'done'] as const).find(status => currentStatus.some(cell => cell.status === status)) ?? 'idle';

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = oldOverflow; clearTimeout(release.current); previous?.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    setEditing(new Set()); setCloseConfirm(false); setRemoveConfirm(false);
    if (!isNew && !row) onClose();
    // Only reset draft state when changing a real record, not on streaming updates.
    if (!isNew) setValues({});
  }, [selection.rowId, isNew, !!row]);
  useEffect(() => {
    if (suspended) return;
    const card = content.current?.querySelector<HTMLElement>(`[data-column-id="${selection.columnId}"]`);
    card?.scrollIntoView({ block: 'start', behavior: 'instant' });
    if (isNew) card?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
    else panel.current?.focus({ preventScroll: true });
  }, [selection.rowId, selection.columnId, isNew, entryVersion, suspended]);
  useEffect(() => {
    if (closeConfirm || removeConfirm) {
      content.current?.scrollTo({ top: 0, behavior: 'instant' });
      content.current?.querySelector<HTMLButtonElement>('.row-draft-confirm button')?.focus();
    }
  }, [closeConfirm, removeConfirm]);
  useEffect(() => {
    if (suspended) return;
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); requestClose.current(); }
      if (event.key === 'Tab') {
        const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? []);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [suspended]);
  // visualViewport follows the iOS/Android soft keyboard; the background stays fixed.
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      panel.current?.style.setProperty('--detail-height', `${viewport?.height ?? window.innerHeight}px`);
      panel.current?.style.setProperty('--detail-top', `${viewport?.offsetTop ?? 0}px`);
    };
    update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); };
  }, []);
  function submit(action: RowSubmitAction) {
    if (submitting.current || rowBusy || (isNew && !dirty)) return;
    submitting.current = true; setLocked(true);
    try {
      if (onSubmit(values, action) && action === 'next') { setValues({}); setEditing(new Set()); setEntryVersion(value => value + 1); }
    } finally {
      release.current = setTimeout(() => { submitting.current = false; setLocked(false); }, 350);
    }
  }
  function edit(column: Column, value: string) {
    if (isNew) setValues(current => ({ ...current, [column.id]: value }));
    else if (row) engine.edit(row.id, column.id, value);
  }
  return <div className="row-detail-backdrop" onClick={event => { if (event.target === event.currentTarget && !suspended) requestClose.current(); }}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="row-detail-title" className="row-detail-sheet" data-revision={revision} inert={suspended}>
      <header className="row-detail-header"><div><span className="eyebrow">{sheet.name || '未命名表格'}</span>
        <h2 id="row-detail-title">{isNew ? '新增记录' : `第 ${rowIndex + 1} 行`} {!isNew && <span className={'status ' + rowState}>{labels[rowState]}</span>}</h2>
      </div><button aria-label="关闭行详情" onClick={() => requestClose.current()}><X size={22}/></button></header>
      {!isNew && row && <nav className="row-detail-nav" aria-label="行操作">
        <button aria-label="上一行" disabled={rowIndex <= 0} onClick={() => onSelect(sheet.rows[rowIndex - 1].id, selection.columnId)}><ChevronLeft size={19}/>上一行</button>
        <button aria-label="下一行" disabled={rowIndex >= sheet.rows.length - 1} onClick={() => onSelect(sheet.rows[rowIndex + 1].id, selection.columnId)}>下一行<ChevronRight size={19}/></button>
        <button aria-label="上移此行" disabled={rowIndex <= 0} onClick={() => onMove(row.id, -1)}><ArrowUp size={18}/></button>
        <button aria-label="下移此行" disabled={rowIndex >= sheet.rows.length - 1} onClick={() => onMove(row.id, 1)}><ArrowDown size={18}/></button>
        <button aria-label="删除此行" onClick={() => setRemoveConfirm(true)}><Trash2 size={18}/></button>
      </nav>}
      <div className="row-detail-content" ref={content}>
        {message && <p role="status" className="row-draft-confirm">{message}</p>}
        {closeConfirm && <div className="row-draft-confirm" role="alert"><strong>已填写的内容尚未添加到表格</strong><p>可以先保存为一行，关闭后继续在表格中查看。</p><div>
          <button className="button primary" onClick={() => onSaveDraft(values)}>保存并关闭</button>
          <button className="button" onClick={() => setCloseConfirm(false)}>继续编辑</button>
          <button className="button danger" onClick={onClose}>丢弃并关闭</button>
        </div></div>}
        {removeConfirm && row && <div className="row-draft-confirm" role="alert"><strong>删除这一行及其全部结果和历史？</strong><div>
          <button className="button danger" onClick={() => onRemove(row.id)}>确认删除此行</button><button className="button" onClick={() => setRemoveConfirm(false)}>保留此行</button>
        </div></div>}
        {isNew && <p className="row-detail-hint">可在任意列填写。运行时保留手动输入，只执行具有可用来源的后续节点。</p>}
        {sheet.columns.map((column, index) => {
          const cell = row?.cells[column.id], text = isNew ? values[column.id] ?? '' : cell?.preview ?? cell?.value ?? '';
          const active = selection.columnId === column.id;
          return <article className={'row-detail-card' + (active ? ' selected-column' : '')} key={column.id} data-column-id={column.id} aria-label={`${String.fromCharCode(65 + index)} 列 ${column.name}`}>
            <div className="row-card-heading"><span className="column-letter">{String.fromCharCode(65 + index)}</span><h3>{column.name}</h3>
              {!isNew && <button aria-label={`${editing.has(column.id) ? '完成编辑' : '编辑'} ${column.name}`} onClick={() => setEditing(current => { const next = new Set(current); if (next.has(column.id)) next.delete(column.id); else next.add(column.id); return next; })}>
                {editing.has(column.id) ? <Save size={17}/> : <Pencil size={17}/>} {editing.has(column.id) ? '完成' : '编辑'}
              </button>}
            </div>
            {column.sources.length > 0 && <p className="row-card-source">来源：{column.sources.map(source => sheet.columns.find(item => item.id === source)?.name).join('、')}</p>}
            {isNew || editing.has(column.id) ? <TextEditor label={`填写 ${column.name}`} value={text} onChange={value => edit(column, value)} onFocus={() => { onInputColumn(column.id); content.current?.querySelector(`[data-column-id="${column.id}"]`)?.scrollIntoView({ block: 'nearest' }); }}/>
              : <div className={'row-card-text' + (!text ? ' placeholder' : '')}>{text || '尚无内容，点击编辑填写'}</div>}
            {!isNew && row && <CellActions {...actions} engine={engine} row={row} column={column} rowIndex={rowIndex} columnIndex={index}/>}
            {!isNew && editing.has(column.id) && <small className="row-autosave">修改即时保存；上游改动会让下游需要更新。</small>}
          </article>;
        })}
      </div>
      <footer className="row-detail-footer">
        {rowBusy && <div className="row-running-note" role="status"><span className="spinner"/>任务继续在后台执行，关闭详情不会停止。<button onClick={() => engine.stop()}><Square size={15}/>停止全部</button></div>}
        <div className="row-submit-actions"><button className="button primary" disabled={locked || rowBusy || (isNew && !dirty)} onClick={() => submit('stay')}><Play size={17}/>运行</button>
          <button className="button" disabled={locked || rowBusy || (isNew && !dirty) || sheet.rows.length >= 500} onClick={() => submit('next')}><Plus size={17}/>运行并新增</button>
          <button className="button" disabled={locked || rowBusy || (isNew && !dirty)} onClick={() => submit('close')}>运行并关闭</button>
        </div>
      </footer>
    </section>
  </div>;
}
