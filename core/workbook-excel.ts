import type { Workspace } from './workspace';
import { columnWidth } from './types';
// Excel restricts tab names to 31 characters and requires unique, case-insensitive names.
export function excelSheetName(name:string,used:Set<string>):string{
 const clean=name.replace(/[\\/*?:\[\]\x00-\x1f]/g,' ').replace(/^'+|'+$/g,'').trim()||'未命名表格';
 const base=clean.toLowerCase()==='history'?'History 表格':clean;
 let result=base.slice(0,31),count=2;
 while(used.has(result.toLowerCase())){const suffix=` (${count++})`;result=base.slice(0,31-suffix.length)+suffix;}
 used.add(result.toLowerCase());return result;
}
export async function workbookExcel(workspace:Workspace):Promise<Uint8Array>{
 const {default:ExcelJS}=await import('exceljs');
 const book=new ExcelJS.Workbook(),used=new Set<string>();
 book.creator='ChainFlow AI Sheets';
 for(const table of workspace.tables){
  const sheet=book.addWorksheet(excelSheetName(table.sheet.name,used),{views:[{state:'frozen',ySplit:1}]});
  sheet.columns=table.sheet.columns.map((column,index)=>({header:column.name,width:Math.max(15,Math.min(90,columnWidth(column,index)/7))}));
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF285DE0'}};sheet.getRow(1).height=25;
  table.sheet.rows.forEach(row=>{
   // Always write strings: user text beginning with '=' must not become an Excel formula.
   const excelRow=sheet.addRow(table.sheet.columns.map(column=>row.cells[column.id].value));
   excelRow.alignment={vertical:'top',wrapText:true};
   excelRow.height=row.height?Math.min(300,row.height*.75):90;
  });
 }
 book.views=[{x:0,y:0,width:1200,height:800,visibility:'visible',firstSheet:0,activeTab:Math.max(0,workspace.tables.findIndex(t=>t.id===workspace.activeId))}];
 return new Uint8Array(await book.xlsx.writeBuffer());
}
