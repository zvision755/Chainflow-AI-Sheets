import { MAX_SHEET_ROWS } from './types';
import { z } from 'zod';
import { topological } from './graph';
import { emptyCell, type Sheet } from './types';
import { cellHistory, historyLimit, MAX_HISTORY_LIMIT, selectedHistoryIndex } from './result-history';
const column=z.object({displayMode:z.enum(['plain','markdown']).default('plain'),id:z.string().min(1).max(80),name:z.string().min(1).max(80),sources:z.array(z.string()).max(30),prompt:z.string().max(12000),userPrompt:z.string().max(32000).default('{{text}}'),model:z.string().regex(/^[a-zA-Z0-9._:/-]{1,100}$/),maxTokens:z.number().int().min(64).max(4096),reasoning:z.enum(['none','low','medium','high']),check:z.boolean(),minLength:z.number().int().min(1).max(10000),containsSource:z.boolean(),ttsLanguage:z.enum(['off','ja','en','en-gb','zh']).default('off'),freshResults:z.boolean().default(false),historyLimit:z.number().int().min(1).max(MAX_HISTORY_LIMIT).default(10)});
const schema=z.object({version:z.literal(1),name:z.string().max(100),columns:z.array(column).min(1).max(30),rows:z.array(z.object({id:z.string().min(1).max(80),cells:z.record(z.object({value:z.string().max(32000),status:z.enum(['idle','queued','running','done','error','cancelled','stale']),revision:z.number().int().nonnegative().optional(),history:z.array(z.string().max(32000)).max(MAX_HISTORY_LIMIT).optional(),historyIndex:z.number().int().min(0).max(MAX_HISTORY_LIMIT-1).optional()}))})).max(MAX_SHEET_ROWS)});
export function parseSheet(raw:unknown):Sheet {
  const data=schema.parse(raw);topological(data.columns);
  if(data.columns.some(c=>new Set(c.sources).size!==c.sources.length))throw new Error('来源列不能重复');
  if(new Set(data.rows.map(r=>r.id)).size!==data.rows.length)throw new Error('行 ID 重复');
  return {...data,columns:data.columns.map(c=>({...c,freshResults:c.freshResults??false,historyLimit:historyLimit(c)})),rows:data.rows.map(r=>({id:r.id,cells:Object.fromEntries(data.columns.map(c=>{
    const cell=r.cells[c.id];if(!cell)throw new Error('缺少单元格');
    const restored=emptyCell(cell.value,!c.sources.length?'done':['queued','running'].includes(cell.status)?'cancelled':cell.status);
    {restored.history=cellHistory(cell,historyLimit(c));const index=selectedHistoryIndex({...cell,historyIndex:cell.historyIndex===undefined?undefined:cell.historyIndex-Math.max(0,(cell.history?.length??0)-restored.history.length)},restored.history);if(index>=0)restored.historyIndex=index;}
    return [c.id,restored];
  }))}))};
}
export function serialize(sheet:Sheet):string {
  return JSON.stringify({version:1,name:sheet.name,columns:sheet.columns.map(c=>({id:c.id,name:c.name,displayMode:c.displayMode??'plain',sources:c.sources,prompt:c.prompt,userPrompt:c.userPrompt??'{{text}}',model:c.model,maxTokens:c.maxTokens,reasoning:c.reasoning,check:c.check,minLength:c.minLength,containsSource:c.containsSource,ttsLanguage:c.ttsLanguage??'off',freshResults:c.freshResults??false,historyLimit:historyLimit(c)})),rows:sheet.rows.map(r=>({id:r.id,cells:Object.fromEntries(sheet.columns.map(c=>{const cell=r.cells[c.id],history=cellHistory(cell,historyLimit(c));return [c.id,{value:cell.value,status:cell.status,...(history?{history,...(selectedHistoryIndex(cell,history)>=0?{historyIndex:selectedHistoryIndex(cell,history)}:{})}:{})}];}))}))},null,2);
}
export function csv(sheet:Sheet):string {
  const quote=(s:string)=>'"'+(/^[=+@\-\t\r]/.test(s)?"'":"")+s.replaceAll('"','""')+'"';
  return '\uFEFF'+[sheet.columns.map(c=>quote(c.name)).join(','),...sheet.rows.map(r=>sheet.columns.map(c=>quote(r.cells[c.id].value)).join(','))].join('\r\n');
}
