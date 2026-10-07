import type { Cell, Column } from './types';

export const DEFAULT_HISTORY_LIMIT = 10;
export const MAX_HISTORY_LIMIT = 100;
export function historyLimit(column: Column) { return column.historyLimit ?? DEFAULT_HISTORY_LIMIT; }
export function cellHistory(cell: Pick<Cell, 'value' | 'history'>, limit = DEFAULT_HISTORY_LIMIT): string[] {
  const values = [...(cell.history ?? [])];
  // Migrate existing worksheets and keep manually edited results in the history.
  if (cell.value.trim() && !values.includes(cell.value)) values.push(cell.value);
  return values.slice(-limit);
}
export function appendResult(cell: Cell, value: string, limit: number) {
  cell.history = [...cellHistory(cell, limit), value].slice(-limit);
  cell.historyIndex = cell.history.length - 1;
}
export function selectedHistoryIndex(cell: Pick<Cell, 'value' | 'historyIndex'>, values: string[]) {
  return cell.historyIndex !== undefined && values[cell.historyIndex] === cell.value ? cell.historyIndex : values.lastIndexOf(cell.value);
}
