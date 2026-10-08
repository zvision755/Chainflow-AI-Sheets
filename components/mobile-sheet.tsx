import { ArrowDownToLine, ArrowUpToLine, Plus, Settings2 } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { columnWidth, labels, type Column, type Sheet } from '../core/types';
import { MobileStatusIcon } from './mobile-status-icon';

// The scheduler retains the full text. This only limits the DOM used by the overview.
export function cellPreview(text: string) { return text.length > 600 ? `${text.slice(0, 600)}…` : text; }
function columnLetter(index: number) {
  let value = index + 1, label = '';
  while (value > 0) { value--; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
  return label;
}
export function MobileSheet({ sheet, onOpenRow, onAdd, onConfigure, onRunColumn, position, onPositionChange }: {
  sheet: Sheet; onOpenRow: (rowId: string, columnId: string) => void; onAdd: () => void;
  onConfigure: (column: Column) => void; onRunColumn: (column: Column) => void;
  position: { top: number; left: number }; onPositionChange: (top: number, left: number) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroll.current) { scroll.current.scrollTop = position.top; scroll.current.scrollLeft = position.left; }
  }, [position]);
  const widths = sheet.columns.map((column, index) => Math.max(190, Math.min(300, columnWidth(column, index))));
  function jump(bottom: boolean) {
    const element = scroll.current;
    if (!element) return;
    const last = element.querySelector<HTMLElement>('tbody tr:last-child');
    const header = element.querySelector<HTMLElement>('thead');
    const top = bottom && last ? element.scrollTop + last.getBoundingClientRect().top - element.getBoundingClientRect().top - (header?.getBoundingClientRect().height ?? 0) : 0;
    element.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  }
  return <>
    <div className="mobile-table-scroll" ref={scroll} onScroll={event => onPositionChange(event.currentTarget.scrollTop, event.currentTarget.scrollLeft)} data-testid="mobile-table-scroll" tabIndex={0} aria-label="移动端表格，可横向和纵向滚动">
      <table className="mobile-table" style={{ width: 40 + widths.reduce((sum, width) => sum + width, 0) }}>
        <colgroup><col style={{ width: 40 }}/>{sheet.columns.map((column, index) => <col key={column.id} style={{ width: widths[index] }}/>)}</colgroup>
        <thead><tr><th className="mobile-row-number">#</th>{sheet.columns.map((column, index) => <th key={column.id}>
          <div className="column-top"><span className="column-letter">{columnLetter(index)}</span>
            <button className="column-name" onClick={() => onConfigure(column)}>{column.name}</button>
            <details className="mobile-column-menu"><summary aria-label={`设置 ${column.name}`} title={`设置 ${column.name}`}><Settings2 size={18}/></summary>
              <div><button onClick={event => { onConfigure(column); event.currentTarget.closest('details')?.removeAttribute('open'); }}>列设置</button>
                {index > 0 && <button aria-label={`运行列 ${column.name}`} onClick={event => { onRunColumn(column); event.currentTarget.closest('details')?.removeAttribute('open'); }}>运行此列</button>}
              </div></details>
          </div>
        </th>)}</tr></thead>
        <tbody>{sheet.rows.map((row, rowIndex) => <tr key={row.id} data-row-id={row.id}>
          <td className="mobile-row-number"><button aria-label={`查看第 ${rowIndex + 1} 行`} onClick={() => onOpenRow(row.id, sheet.columns[0].id)}>{rowIndex + 1}</button></td>
          {sheet.columns.map((column, columnIndex) => {
            const cell = row.cells[column.id];
            return <td key={column.id} className={columnIndex === 0 ? 'input-cell' : ''}>
              <button className="mobile-cell" aria-label={`查看第 ${rowIndex + 1} 行 ${column.name}`} aria-describedby={`mobile-status-${row.id}-${column.id}`} onClick={() => onOpenRow(row.id, column.id)}>
                <span className={'mobile-cell-preview' + (!(cell.preview ?? cell.value) ? ' placeholder' : '')}>{cellPreview(cell.preview ?? cell.value) || '点击填写内容'}</span>
                <MobileStatusIcon status={cell.status} error={cell.error}/>
                <span id={`mobile-status-${row.id}-${column.id}`} className="sr-only">状态：{labels[cell.status]}{cell.error ? `，${cell.error}` : ''}</span>
              </button>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
      {!sheet.rows.length && <p className="mobile-empty">还没有记录，点击右下角 + 开始填写。</p>}
      <div className="mobile-scroll-space" aria-hidden="true"/>
    </div>
    <div className="mobile-floating-actions" aria-label="表格快捷操作">
      <button aria-label="回到表格顶部" onClick={() => jump(false)}><ArrowUpToLine size={19}/></button>
      <button aria-label="跳转到表格底部" onClick={() => jump(true)}><ArrowDownToLine size={19}/></button>
      <button className="mobile-add" aria-label="新增一行" disabled={sheet.rows.length >= 500} onClick={onAdd}><Plus size={24}/></button>
    </div>
  </>;
}
