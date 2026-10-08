import { descendants, topological } from './graph';
import type { Sheet } from './types';

// A manually populated generated cell is already 'done' under Scheduler.edit semantics.
// Plan from every completed, nonempty source, rather than filling empty upstream branches.
export function rowWorkflow(sheet: Sheet, rowId: string) {
  const row = sheet.rows.find(item => item.id === rowId);
  if (!row) throw Error('行不存在');
  const available = new Set<string>();
  const sources: {row:string;column:string}[] = [];
  const potential = new Set<string>();
  for (const column of sheet.columns) if (row.cells[column.id].status === 'done' && row.cells[column.id].value.trim()) {
    sources.push({row:rowId,column:column.id});
    for (const downstream of descendants(sheet.columns, column.id)) potential.add(downstream);
  }
  const targets: { row: string; column: string }[] = [];
  const blocked: string[] = [];
  for (const columnId of topological(sheet.columns)) {
    const column = sheet.columns.find(item => item.id === columnId)!;
    const cell = row.cells[columnId];
    if (cell.status === 'done') {
      if (cell.value.trim()) available.add(columnId);
      continue;
    }
    if (!column.sources.length) continue;
    if (column.sources.every(source => available.has(source))) {
      available.add(columnId);
      targets.push({ row: rowId, column: columnId });
    } else if (potential.has(columnId)) blocked.push(column.name);
  }
  return { targets, blocked, sources };
}
