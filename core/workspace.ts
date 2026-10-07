import { emptyCell, id, newColumn, type Sheet, type RunOptions } from './types';
import { parseSheet, serialize } from './storage';
import { defaultRunOptions, readRunOptions, writeRunOptions } from './run-settings';
export const WORKSPACE_STORAGE='chainflow-workspace-v1';
export type TableEntry={id:string;sheet:Sheet;options:RunOptions};
export type Workspace={version:1;activeId:string;tables:TableEntry[]};
export function blankSheet(name='未命名表格'):Sheet{return {version:1,name,columns:[newColumn('input','输入',[]),newColumn('output','生成结果',['input'])],rows:[{id:'row-1',cells:{input:emptyCell('','done'),output:emptyCell()}}]};}
export function initialWorkspace():Workspace{return {version:1,activeId:'sheet-1',tables:[{id:'sheet-1',sheet:blankSheet(),options:{...defaultRunOptions}}]};}
export function activeTable(workspace:Workspace){const table=workspace.tables.find(t=>t.id===workspace.activeId);if(!table)throw Error('当前表格不存在');return table;}
export function saveActive(workspace:Workspace,sheet:Sheet,options:RunOptions):Workspace{return {...workspace,tables:workspace.tables.map(t=>t.id===workspace.activeId?{...t,sheet:parseSheet(JSON.parse(serialize(sheet))),options:JSON.parse(writeRunOptions(options))}:t)};}
export function addTable(workspace:Workspace,sheet:Sheet,options:RunOptions=defaultRunOptions):Workspace{const table={id:id(),sheet:parseSheet(JSON.parse(serialize(sheet))),options:JSON.parse(writeRunOptions(options))};return {...workspace,activeId:table.id,tables:[...workspace.tables,table]};}
export function selectTable(workspace:Workspace,activeId:string):Workspace{if(!workspace.tables.some(t=>t.id===activeId))throw Error('表格不存在');return {...workspace,activeId};}
export function serializeWorkspace(workspace:Workspace):string{return JSON.stringify({version:1,activeId:workspace.activeId,tables:workspace.tables.map(t=>({id:t.id,sheet:JSON.parse(serialize(t.sheet)),options:JSON.parse(writeRunOptions(t.options))}))});}
export function restoreWorkspace(raw:string|null,legacySheet:string|null,legacyOptions:string|null):Workspace{
 if(raw){const data=JSON.parse(raw);if(data.version!==1||typeof data.activeId!=='string'||!Array.isArray(data.tables)||!data.tables.length)throw Error('表格列表格式错误');
 const tables:TableEntry[]=data.tables.map((t:any)=>{if(typeof t.id!=='string'||!t.id||t.id.length>80)throw Error('表格编号格式错误');const options=readRunOptions(JSON.stringify(t.options));if(!options)throw Error('执行设置格式错误');return {id:t.id,sheet:parseSheet(t.sheet),options};});
 if(new Set(tables.map(t=>t.id)).size!==tables.length)throw Error('表格编号重复');const workspace:Workspace={version:1,activeId:data.activeId,tables};activeTable(workspace);return workspace;}
 const workspace=initialWorkspace();if(legacySheet){const legacy=JSON.parse(legacySheet);const restored=parseSheet(legacy);restored.columns.forEach((c,i)=>{if(legacy.columns[i].ttsLanguage===undefined)c.ttsLanguage=i<2?'ja':i===3?'en':'off';});workspace.tables[0].sheet=restored;workspace.tables[0].options=readRunOptions(legacyOptions)??{...defaultRunOptions};}return workspace;
}
// A single rectangular CSV, with each row labelled by its worksheet and each cell's column name.
export function workbookCsv(workspace:Workspace):string{
 const max=Math.max(...workspace.tables.map(t=>t.sheet.columns.length));
 const quote=(s:string)=>'"'+(/^[=+@\-\t\r]/.test(s)?"'":"")+s.replaceAll('"','""')+'"';
 const header=['工作表','行号',...Array.from({length:max},(_,i)=>[`${String.fromCharCode(65+i)} 列名称`,`${String.fromCharCode(65+i)} 列内容`]).flat()];
 const rows=workspace.tables.flatMap(t=>(t.sheet.rows.length?t.sheet.rows:[undefined]).map((row,index)=>[t.sheet.name,row?String(index+1):'',...Array.from({length:max},(_,i)=>{const column=t.sheet.columns[i];return [column?.name??'',row&&column?row.cells[column.id].value:''];}).flat()]));
 return '\uFEFF'+[header,...rows].map(row=>row.map(quote).join(',')).join('\r\n');
}
export function importWorkbook(workspace:Workspace,raw:unknown):Workspace{
 if(typeof raw==='object'&&raw!==null&&'tables' in raw){const incoming=restoreWorkspace(JSON.stringify(raw),null,null);let next=workspace,selected='';for(const table of incoming.tables){next=addTable(next,table.sheet,table.options);if(table.id===incoming.activeId)selected=next.activeId;}return selectTable(next,selected);}
 return addTable(workspace,parseSheet(raw));
}
export function removeTable(workspace:Workspace,tableId:string):Workspace{
 const index=workspace.tables.findIndex(t=>t.id===tableId);if(index<0)throw Error('表格不存在');
 const tables=workspace.tables.filter(t=>t.id!==tableId);
 if(!tables.length)return addTable({...workspace,tables:[]},blankSheet());
 return {...workspace,tables,activeId:workspace.activeId===tableId?tables[Math.min(index,tables.length-1)].id:workspace.activeId};
}
export function restoreTable(workspace:Workspace,entry:TableEntry,index:number):Workspace{
 if(workspace.tables.some(t=>t.id===entry.id))throw Error('工作表已存在');
 const tables=[...workspace.tables];tables.splice(Math.min(index,tables.length),0,entry);return {...workspace,tables,activeId:entry.id};
}
