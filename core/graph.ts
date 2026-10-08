import type { Column, Sheet } from './types';
export function topological(columns: Column[]): string[] {
  const map = new Map(columns.map(c=>[c.id,c]));
  if (map.size!==columns.length) throw new Error('列 ID 重复');
  const visited=new Set<string>(),path=new Set<string>(),order:string[]=[];
  function visit(id:string) {
    if(path.has(id))throw new Error('来源列形成循环引用，请选择其他来源');
    if(visited.has(id))return;
    const c=map.get(id);if(!c)throw new Error('来源列不存在');
    path.add(id);c.sources.forEach(visit);path.delete(id);visited.add(id);order.push(id);
  }
  columns.forEach(c=>visit(c.id));return order;
}
export function descendants(columns: Column[], source:string, boundaries:ReadonlySet<string>=new Set()): Set<string> {
  const result=new Set<string>();
  function visit(id:string){for(const c of columns)if(c.sources.includes(id)&&!result.has(c.id)&&!boundaries.has(c.id)){result.add(c.id);visit(c.id);}}
  visit(source);return result;
}
export function plan(sheet:Sheet, targets:{row:string;column:string}[],force=false) {
  topological(sheet.columns);
  const tasks=new Map<string,{row:string;column:string}>();
  function add(rowId:string,colId:string,isTarget:boolean){
    const row=sheet.rows.find(r=>r.id===rowId),col=sheet.columns.find(c=>c.id===colId);if(!row||!col||col===sheet.columns[0])return;
    const cell=row.cells[colId];
    if(cell.status==='done'&&!(force&&isTarget))return;
    col.sources.forEach(s=>add(rowId,s,false));tasks.set(`${rowId}:${colId}`,{row:rowId,column:colId});
  }
  targets.forEach(t=>add(t.row,t.column,true));return [...tasks.values()];
}
