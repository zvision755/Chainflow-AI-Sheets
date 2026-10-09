import { emptyCell, id, MAX_SHEET_ROWS, type Sheet } from './types';

export function reusableImportRow(sheet:Sheet,row:Sheet['rows'][number]){
  return sheet.columns.every(column=>{const cell=row.cells[column.id];return cell?.value===''&&!cell.history?.length&&!cell.preview&&!cell.error&&!cell.usage&&!cell.completedAt&&!['running','queued'].includes(cell.status);});
}
export function importCapacity(sheet:Sheet){return MAX_SHEET_ROWS-sheet.rows.length+sheet.rows.filter(row=>reusableImportRow(sheet,row)).length;}

export function appendImportedRows(sheet: Sheet, values: string[]): Sheet {
  if (!values.length) throw new Error('文件中没有可导入的内容。');
  const inputId = sheet.columns[0]?.id;
  if (!inputId) throw new Error('当前表格没有第一列。');
  const reusable=sheet.rows.flatMap((row,index)=>reusableImportRow(sheet,row)?[index]:[]);
  const room = importCapacity(sheet);
  if (values.length > room) throw new Error(`整张表最多 ${MAX_SHEET_ROWS} 行；已有 ${sheet.rows.length} 行，其中 ${reusable.length} 行可复用，本次 ${values.length} 条超过剩余容量 ${room}。本次未导入任何内容，请拆分文件或清理表格后重试。`);

  const rows = sheet.rows.map(row => ({ ...row, cells: { ...row.cells } }));
  values.forEach((value, index) => {
    if (value.length > 32000) throw new Error(`第 ${index + 1} 条超过单元格 32,000 字符上限。`);
    const cells = Object.fromEntries(sheet.columns.map((column, columnIndex) => [
      column.id,
      columnIndex === 0 ? emptyCell(value, 'done') : emptyCell(),
    ]));
    if (index < reusable.length) {const target=reusable[index];rows[target] = { ...rows[target], cells };}
    else rows.push({ id: id(), cells });
  });
  return { ...sheet, rows };
}

export type ImportUndo = { changes: { before?: Sheet['rows'][number]; after: Sheet['rows'][number] }[] };
export function prepareImportedRows(sheet: Sheet, values: string[]) {
  const next=appendImportedRows(sheet,values), before=new Map(sheet.rows.map(row=>[row.id,row]));
  const undo:ImportUndo={changes:next.rows.filter(row=>JSON.stringify(row)!==JSON.stringify(before.get(row.id))).map(row=>({before:before.has(row.id)?structuredClone(before.get(row.id)!):undefined,after:structuredClone(row)}))};
  return {sheet:next,undo};
}
/** Remove only this batch; refuse to erase later edits or generated results. */
export function undoImportedRows(sheet: Sheet, undo: ImportUndo): Sheet['rows'] {
  const current=new Map(sheet.rows.map(row=>[row.id,row]));
  for(const change of undo.changes)if(JSON.stringify(current.get(change.after.id))!==JSON.stringify(change.after))throw Error('导入的行已有编辑、生成或删除，无法安全撤销。请先导出备份，再清空目标列或删除相关行。');
  const changes=new Map(undo.changes.map(change=>[change.after.id,change]));
  return sheet.rows.flatMap(row=>{const change=changes.get(row.id);return change?(change.before?[structuredClone(change.before)]:[]):[row];});
}

export function parseDelimitedText(text: string, delimiter?: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const separator = delimiter ?? ['\t', ',', ';'].toSorted((a, b) => {
    const count = (line: string, d: string) => [...line].filter(char => char === d).length;
    return count(firstLine, b) - count(firstLine, a);
  })[0];
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === separator && !quoted) {
      row.push(field); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field || row.length || text.endsWith(separator)) { row.push(field); rows.push(row); }
  return rows;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const cell = value as { text?: unknown; richText?: Array<{ text?: string }>; result?: unknown; hyperlink?: string };
    if (typeof cell.text === 'string') return cell.text;
    if (cell.richText) return cell.richText.map(part => part.text ?? '').join('');
    if (cell.result !== undefined && cell.result !== null) return String(cell.result);
    return cell.hyperlink ?? '';
  }
  return String(value);
}

export type ImportedFile = { name: string; sheets: { name: string; rows: string[][] }[]; kind: 'text' | 'table' };

export async function readImportFile(file: File): Promise<ImportedFile> {
  if (file.size > 20_000_000) throw new Error('文件超过 20 MB，请先拆分后再导入。');
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (extension === 'txt' || extension === 'text') {
    return { name: file.name, kind: 'text', sheets: [{ name: file.name, rows: [[await file.text()]] }] };
  }
  if (extension === 'csv' || extension === 'tsv') {
    const text = (await file.text()).replace(/^\uFEFF/, '');
    return { name: file.name, kind: 'table', sheets: [{ name: file.name, rows: parseDelimitedText(text, extension === 'tsv' ? '\t' : undefined) }] };
  }
  if (extension !== 'xlsx') throw new Error('支持 .xlsx、.csv、.tsv 和 .txt 文件。');
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  return { name: file.name, kind: 'table', sheets: workbook.worksheets.map(sheet => {
    if (sheet.rowCount > 10000) throw new Error(`工作表「${sheet.name}」超过 10,000 行，请先筛选或拆分文件。`);
    return { name: sheet.name, rows: Array.from({ length: sheet.rowCount }, (_, rowIndex) => {
      const row = sheet.getRow(rowIndex + 1);
      return Array.from({ length: sheet.columnCount }, (_, columnIndex) => cellText(row.getCell(columnIndex + 1).value));
    }) };
  }) };
}
