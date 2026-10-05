import { z } from 'zod';
import { topological } from './graph';
import { columnWidth, emptyCell, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, type Sheet } from './types';
const column=z.object({id:z.string().min(1).max(80),name:z.string().min(1).max(80),sources:z.array(z.string()).max(30),prompt:z.string().max(12000),model:z.string().regex(/^[a-zA-Z0-9._:/-]{1,100}$/),maxTokens:z.number().int().min(64).max(4096),reasoning:z.enum(['none','low','medium','high']),check:z.boolean(),minLength:z.number().int().min(1).max(10000),containsSource:z.boolean(),ttsLanguage:z.enum(['off','ja','en','en-gb','zh']).default('off'),width:z.number().int().min(MIN_COLUMN_WIDTH).max(MAX_COLUMN_WIDTH).optional()});
const schema=z.object({version:z.literal(1),name:z.string().max(100),columns:z.array(column).min(1).max(30),rows:z.array(z.object({id:z.string().min(1).max(80),cells:z.record(z.object({value:z.string().max(32000),status:z.enum(['idle','queued','running','done','error','cancelled','stale']),revision:z.number().int().nonnegative().optional()}))})).max(500)});
export function parseSheet(raw:unknown):Sheet {
  const data=schema.parse(raw);topological(data.columns);
  if(data.columns[0].sources.length)throw new Error('第一列必须是用户输入列');
  if(data.columns.slice(1).some(c=>!c.sources.length||new Set(c.sources).size!==c.sources.length))throw new Error('每个生成列必须选择不重复的来源');
  if(new Set(data.rows.map(r=>r.id)).size!==data.rows.length)throw new Error('行 ID 重复');
  return {...data,columns:data.columns.map((c,i)=>({...c,width:columnWidth(c,i)})),rows:data.rows.map(r=>({id:r.id,cells:Object.fromEntries(data.columns.map((c,i)=>{
    const cell=r.cells[c.id];if(!cell)throw new Error('缺少单元格');
    return [c.id,emptyCell(cell.value,i===0?'done':['queued','running'].includes(cell.status)?'cancelled':cell.status)];
  }))}))};
}
export function serialize(sheet:Sheet):string {
  return JSON.stringify({version:1,name:sheet.name,columns:sheet.columns.map((c,i)=>({id:c.id,name:c.name,sources:c.sources,prompt:c.prompt,model:c.model,maxTokens:c.maxTokens,reasoning:c.reasoning,check:c.check,minLength:c.minLength,containsSource:c.containsSource,ttsLanguage:c.ttsLanguage??'off',width:columnWidth(c,i)})),rows:sheet.rows.map(r=>({id:r.id,cells:Object.fromEntries(sheet.columns.map(c=>[c.id,{value:r.cells[c.id].value,status:r.cells[c.id].status}]))}))},null,2);
}
export function csv(sheet:Sheet):string {
  const quote=(s:string)=>'"'+(/^[=+@\-\t\r]/.test(s)?"'":"")+s.replaceAll('"','""')+'"';
  return '\uFEFF'+[sheet.columns.map(c=>quote(c.name)).join(','),...sheet.rows.map(r=>sheet.columns.map(c=>quote(r.cells[c.id].value)).join(','))].join('\r\n');
}
