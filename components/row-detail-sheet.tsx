'use client';
import { MAX_SHEET_ROWS } from '../core/types';
'use client';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Play, Plus, Save, Square, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Scheduler } from '../core/scheduler';
import type { Column, Status } from '../core/types';
import { CompactCellActions, CompactCellFeedback, type CellActionProps } from './cell-actions';
import { MobileStatusIcon } from './mobile-status-icon';

function columnLetter(index: number) {
  let value = index + 1, label = '';
  while (value > 0) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
  return label;
}
function TextEditor({ value, label, onChange, onFocus }: { value: string; label: string; onChange: (value: string) => void; onFocus?: () => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!area.current) return;
    area.current.style.height = 'auto';
    area.current.style.height = `${Math.max(46, area.current.scrollHeight)}px`;
  }, [value]);
  return <textarea ref={area} aria-label={label} rows={1} maxLength={32000} value={value}
    onChange={event => onChange(event.target.value)} onFocus={onFocus} placeholder="在此列填写内容…"/>;
}

export function RowDetailSheet({ engine, selection, message, revision, suspended, onClose, onSelect, onSubmit, onSaveDraft, onInputColumn, onRemove, onMove, actions }: {
  engine: Scheduler; selection: { rowId: string | null; columnId: string; afterRowId?: string }; message: string; revision: number; suspended: boolean;
  onClose: () => void; onSelect: (rowId: string | null, columnId: string, afterRowId?: string) => void;
  onSubmit: (values: Record<string, string>) => boolean;
  onSaveDraft: (values: Record<string, string>) => string | null; onInputColumn: (columnId: string) => void;
  onRemove: (rowId: string) => void; onMove: (rowId: string, delta: number) => void;
  actions: Omit<CellActionProps, 'row' | 'column' | 'rowIndex' | 'columnIndex' | 'engine'>;
}) {
  const sheet = engine.sheet, rowIndex = sheet.rows.findIndex(item => item.id === selection.rowId), row = sheet.rows[rowIndex];
  const isNew = selection.rowId === null;
  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [locked, setLocked] = useState(false), [entryVersion, setEntryVersion] = useState(0);
  const content = useRef<HTMLDivElement>(null), panel = useRef<HTMLElement>(null);
  const submitting = useRef(false), release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = Object.values(values).some(value => value.trim());
  const requestClose = useRef(() => {});
  const currentStatus = row?.cells ? Object.values(row.cells) : [];
  const rowBusy = currentStatus.some(cell => cell.status === 'queued' || cell.status === 'running');
  const rowState: Status = (['running', 'queued', 'error', 'stale', 'cancelled'] as const).find(status => currentStatus.some(cell => cell.status === status)) ?? (currentStatus.length && currentStatus.every(cell => cell.status === 'done') ? 'done' : 'idle');

  function withLock(action: () => void) {
    if (submitting.current) return;
    submitting.current = true; setLocked(true);
    try { action(); }
    finally { release.current = setTimeout(() => { submitting.current = false; setLocked(false); }, 350); }
  }
  function openNew() {
    withLock(() => {
      if (sheet.rows.length >= MAX_SHEET_ROWS) return;
      let afterRowId = selection.rowId ?? selection.afterRowId;
      if (isNew) {
        if (!dirty) return;
        const saved = onSaveDraft(values);
        if (!saved) return;
        afterRowId = saved;
        setValues({}); setEditing(new Set()); setEntryVersion(value => value + 1);
      }
      onSelect(null, selection.columnId, afterRowId);
    });
  }
  function nextRow() {
    if (isNew) { openNew(); return; }
    if (rowIndex < sheet.rows.length - 1) onSelect(sheet.rows[rowIndex + 1].id, selection.columnId);
  }
  function submit() {
    if (rowBusy || (isNew && !dirty)) return;
    withLock(() => { onSubmit(values); });
  }
  function edit(column: Column, value: string) {
    if (isNew) setValues(current => ({ ...current, [column.id]: value }));
    else if (row) engine.edit(row.id, column.id, value);
  }

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = oldOverflow; clearTimeout(release.current); previous?.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    requestClose.current = () => withLock(() => {
      if (isNew && dirty && !onSaveDraft(values)) return;
      onClose();
    });
  });
  useEffect(() => {
    if (suspended) return;
    const card = content.current?.querySelector<HTMLElement>(`[data-column-id="${selection.columnId}"]`);
    card?.scrollIntoView({ block: 'start', behavior: 'instant' });
    if (isNew) card?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
    else panel.current?.focus({ preventScroll: true });
  }, [selection.rowId, selection.columnId, isNew, entryVersion, suspended]);
  useEffect(() => {
    if (removeConfirm) {
      content.current?.scrollTo({ top: 0, behavior: 'instant' });
      content.current?.querySelector<HTMLButtonElement>('.row-draft-confirm button')?.focus();
    }
  }, [removeConfirm]);
  useEffect(() => {
    if (suspended) return;
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); requestClose.current(); }
      if (event.key === 'Tab') {
        const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]') ?? []);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [suspended]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      panel.current?.style.setProperty('--detail-height', `${viewport?.height ?? window.innerHeight}px`);
      panel.current?.style.setProperty('--detail-top', `${viewport?.offsetTop ?? 0}px`);
    };
    update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); };
  }, []);

  return <div className="row-detail-backdrop" onClick={event => { if (event.target === event.currentTarget && !suspended) requestClose.current(); }}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="row-detail-title" className="row-detail-sheet" data-revision={revision} inert={suspended}>
      <header className="row-detail-header">
        <div className="row-detail-title"><small>{sheet.name || '未命名表格'}</small><h2 id="row-detail-title">{isNew ? '新建行' : `第 ${rowIndex + 1} 行`}</h2>{!isNew && <MobileStatusIcon status={rowState} interactive/>}</div>
        <nav className="row-detail-nav" aria-label="行操作">
          <button aria-label="上一行" disabled={isNew || rowIndex <= 0} onClick={() => onSelect(sheet.rows[rowIndex - 1].id, selection.columnId)}><ChevronLeft size={21}/></button>
          <button aria-label="下一行" disabled={locked || (!isNew && rowIndex >= sheet.rows.length - 1) || (isNew && sheet.rows.length >= MAX_SHEET_ROWS)} onClick={nextRow}><ChevronRight size={21}/></button>
          <button aria-label="新增行" title={isNew ? '保存并继续新增' : '在当前行下方插入'} disabled={locked || sheet.rows.length >= MAX_SHEET_ROWS} onClick={openNew}><Plus size={20}/></button>
          <details className="row-detail-more"><summary aria-label="更多行操作"><MoreHorizontal size={20}/></summary><div>
            {!isNew && row && <><button disabled={rowIndex <= 0} onClick={event => { onMove(row.id, -1); event.currentTarget.closest('details')?.removeAttribute('open'); }}><ArrowUp size={16}/>上移此行</button><button disabled={rowIndex >= sheet.rows.length - 1} onClick={event => { onMove(row.id, 1); event.currentTarget.closest('details')?.removeAttribute('open'); }}><ArrowDown size={16}/>下移此行</button><button onClick={event => { setRemoveConfirm(true); event.currentTarget.closest('details')?.removeAttribute('open'); }}><Trash2 size={16}/>删除此行</button></>}
            {engine.busy && <button onClick={event => { engine.stop(); event.currentTarget.closest('details')?.removeAttribute('open'); }}><Square size={16}/>停止全部任务</button>}
            {isNew && !engine.busy && <span className="row-menu-note">可填写任意列，切换时自动保存。</span>}
          </div></details>
          <button aria-label="关闭行详情" disabled={locked} onClick={() => requestClose.current()}><X size={22}/></button>
        </nav>
      </header>
      <div className="row-detail-content" ref={content}>
        {message && <p role="alert" className="row-draft-confirm">{message}</p>}
        {removeConfirm && row && <div className="row-draft-confirm" role="alert"><strong>删除这一行及其全部结果和历史？</strong><div>
          <button className="button danger" onClick={() => onRemove(row.id)}>确认删除此行</button><button className="button" onClick={() => setRemoveConfirm(false)}>保留此行</button>
        </div></div>}
        {sheet.columns.map((column, index) => {
          const cell = row?.cells[column.id], text = isNew ? values[column.id] ?? '' : cell?.preview ?? cell?.value ?? '';
          const active = selection.columnId === column.id;
          return <article className={'row-detail-card' + (active ? ' selected-column' : '') + (editing.has(column.id) ? ' editing' : '')} key={column.id} data-column-id={column.id} aria-label={`${columnLetter(index)} 列 ${column.name}`}>
            <div className="row-card-heading"><span className="column-letter">{columnLetter(index)}</span><h3>{column.name}</h3>
              {cell && <MobileStatusIcon status={cell.status} error={cell.error} interactive/>}
              {!isNew && row && <CompactCellActions {...actions} engine={engine} row={row} column={column} rowIndex={rowIndex} columnIndex={index}/>}
              {!isNew && <button className="row-card-edit" aria-label={`${editing.has(column.id) ? '完成编辑' : '编辑'} ${column.name}`} title={`${editing.has(column.id) ? '完成编辑' : '编辑'} ${column.name}`} onClick={() => setEditing(current => { const next = new Set(current); if (next.has(column.id)) next.delete(column.id); else next.add(column.id); return next; })}>
                {editing.has(column.id) ? <Save size={18}/> : <Pencil size={18}/>}
              </button>}
            </div>
            {isNew || editing.has(column.id) ? <TextEditor label={`填写 ${column.name}`} value={text} onChange={value => edit(column, value)} onFocus={() => { onInputColumn(column.id); content.current?.querySelector(`[data-column-id="${column.id}"]`)?.scrollIntoView({ block: 'nearest' }); }}/>
              : <div className={'row-card-text' + (!text ? ' placeholder' : '')}>{text || '尚无内容，点击编辑填写'}</div>}
            {!isNew && row && <CompactCellFeedback row={row} column={column} speech={actions.speech}/>}
            {!isNew && editing.has(column.id) && <small className="row-autosave">修改即时保存；上游改动会让下游需要更新。</small>}
          </article>;
        })}
      </div>
      <footer className="row-detail-footer"><button className="button primary" disabled={locked || rowBusy || (isNew && !dirty)} onClick={submit}><Play size={17}/>运行</button></footer>
    </section>
  </div>;
}
