import { emptyCell, id, type Sheet } from './types';

export function appendImportedRows(sheet: Sheet, values: string[]): Sheet {
  if (!values.length) throw new Error('文件中没有可导入的内容。');
  const inputId = sheet.columns[0]?.id;
  if (!inputId) throw new Error('当前表格没有第一列。');
  const reusable = sheet.rows.length === 1 && sheet.rows[0].cells[inputId]?.value === '' &&
    sheet.columns.slice(1).every(column => sheet.rows[0].cells[column.id]?.value === '');
  const room = 500 - sheet.rows.length + (reusable ? 1 : 0);
  if (values.length > room) throw new Error(`这张表最多容纳 500 行；当前可导入 ${room} 行，文件有 ${values.length} 条。`);

  const rows = sheet.rows.map(row => ({ ...row, cells: { ...row.cells } }));
  values.forEach((value, index) => {
    if (value.length > 32000) throw new Error(`第 ${index + 1} 条超过单元格 32,000 字符上限。`);
    const cells = Object.fromEntries(sheet.columns.map((column, columnIndex) => [
      column.id,
      columnIndex === 0 ? emptyCell(value, 'done') : emptyCell(),
    ]));
    if (index === 0 && reusable) rows[0] = { ...rows[0], cells: { ...rows[0].cells, ...cells } };
    else rows.push({ id: id(), cells });
  });
  return { ...sheet, rows };
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
