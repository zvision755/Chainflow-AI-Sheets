import { ArrowDownToLine, ArrowUpToLine, GitBranch, Play, Plus, Settings2 } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { columnWidth, labels, type Column, type Sheet } from '../core/types';

// Limit the DOM preview as well as its visual height. Full values remain in the scheduler.
export function cellPreview(text: string) { return text.length > 600 ? `${text.slice(0, 600)}…` : text; }
export function MobileSheet({ sheet, onOpenRow, onAdd, onConfigure, onRunColumn, modelName, position }: {
  sheet: Sheet; onOpenRow: (rowId: string, columnId: string) => void; onAdd: () => void;
  onConfigure: (column: Column) => void; onRunColumn: (column: Column) => void;
  modelName: (column: Column) => string;
  position: { top: number; left: number };
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroll.current) { scroll.current.scrollTop = position.top; scroll.current.scrollLeft = position.left; }
  }, [position]);
  const widths = sheet.columns.map((column, index) => Math.max(210, Math.min(300, columnWidth(column, index))));
  function jump(bottom: boolean) {
    const element = scroll.current;
    if (element) element.scrollTo({ top: bottom ? element.scrollHeight : 0, behavior: 'instant' });
  }
  return <>
    <div className="mobile-table-scroll" ref={scroll} onScroll={event => { position.top = event.currentTarget.scrollTop; position.left = event.currentTarget.scrollLeft; }} data-testid="mobile-table-scroll" tabIndex={0} aria-label="移动端表格，可横向和纵向滚动">
      <table className="mobile-table" style={{ width: 52 + widths.reduce((sum, width) => sum + width, 0) }}>
        <colgroup><col style={{ width: 52 }}/>{sheet.columns.map((column, index) => <col key={column.id} style={{ width: widths[index] }}/>)}</colgroup>
        <thead><tr><th className="mobile-row-number">#</th>{sheet.columns.map((column, index) => <th key={column.id}>
          <div className="column-top"><span className="column-letter">{String.fromCharCode(65 + index)}</span>
            <button className="column-name" onClick={() => onConfigure(column)}>{column.name}</button>
            <button aria-label={`设置 ${column.name}`} onClick={() => onConfigure(column)}><Settings2 size={17}/></button>
          </div>
          <div className="column-source">{index ? <><GitBranch size={13}/>来源：{column.sources.map(source => sheet.columns.find(item => item.id === source)?.name).join('、')}</> : '手动输入'}</div>
          {index > 0 && <div className="column-meta"><span>{modelName(column)}</span><button aria-label={`运行列 ${column.name}`} onClick={() => onRunColumn(column)}><Play size={16}/></button></div>}
        </th>)}</tr></thead>
        <tbody>{sheet.rows.map((row, rowIndex) => <tr key={row.id} data-row-id={row.id}>
          <td className="mobile-row-number"><button aria-label={`查看第 ${rowIndex + 1} 行`} onClick={() => onOpenRow(row.id, sheet.columns[0].id)}>{String(rowIndex + 1).padStart(2, '0')}</button></td>
          {sheet.columns.map((column, columnIndex) => {
            const cell = row.cells[column.id];
            return <td key={column.id} className={columnIndex === 0 ? 'input-cell' : ''}>
              <button className="mobile-cell" aria-label={`查看第 ${rowIndex + 1} 行 ${column.name}`} onClick={() => onOpenRow(row.id, column.id)}>
                <span className={'mobile-cell-preview' + (!(cell.preview ?? cell.value) ? ' placeholder' : '')}>{cellPreview(cell.preview ?? cell.value) || '点击填写内容'}</span>
                <span className={'status ' + cell.status}>{cell.status === 'running' && <span className="spinner"/>}{labels[cell.status]}</span>
                {cell.error && <span className="mobile-cell-error">{cell.error}</span>}
              </button>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
      {!sheet.rows.length && <p className="mobile-empty">还没有记录，点击右下角 + 开始填写。</p>}
      <div className="mobile-scroll-space" aria-hidden="true"/>
    </div>
    <div className="mobile-floating-actions" aria-label="表格快捷操作">
      <button aria-label="回到表格顶部" onClick={() => jump(false)}><ArrowUpToLine size={20}/></button>
      <button aria-label="跳转到表格底部" onClick={() => jump(true)}><ArrowDownToLine size={20}/></button>
      <button className="mobile-add" aria-label="新增一行" disabled={sheet.rows.length >= 500} onClick={onAdd}><Plus size={26}/></button>
    </div>
  </>;
}
