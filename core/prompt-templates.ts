import { ModelError } from '../model/client';
import type { Column, Sheet } from './types';

export const promptTemplates = [
  {key:'text',name:'来源内容',description:'所选来源列的内容；多个来源按列名拼接'},
  {key:'existing_result',name:'已有结果',description:'当前格子在本次请求前的结果；首次运行为空'},
  {key:'recent_results',name:'最近结果',description:'最多 5 条，JSON 总长最多 10000 字符；仅使用此模板时发送，不持久保存历史'},
  {key:'timestamp',name:'当前时间',description:'请求发出时的 UTC 时间，精确到秒'},
  {key:'request_id',name:'请求 ID',description:'每次请求唯一；同一秒内也不同'},
  {key:'row_number',name:'行号',description:'从 1 开始的当前行号'},
  {key:'column_name',name:'列名称',description:'当前生成列的名称'},
] as const;
export type PromptContext = {text:string;existing_result:string;recent_results:string;timestamp:string;request_id:string;row_number:string;column_name:string};
export function validatePromptTemplates(column:Column) {
  for(const [template,limit,field] of [[column.prompt,12000,'系统提示词'],[column.userPrompt??'{{text}}',32000,'用户提示词']] as const){
    if(field==='用户提示词'&&!template.trim())throw new ModelError('用户提示词不能为空；可使用 {{text}} 发送来源内容','prompt_empty');
    if(template.length>limit)throw new ModelError(`${field}超过 ${limit} 字符`,'prompt_size');
    for(const match of template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g))if(!promptTemplates.some(item=>item.key===match[1]))throw new ModelError(`未知模板 {{${match[1]}}}，请在${field}中选择受支持的模板`,'prompt_template');
  }
}
export function promptContext(sheet:Sheet,rowId:string,column:Column,history:string[]=[],now=new Date(),requestId:string=crypto.randomUUID()):PromptContext {
  const index=sheet.rows.findIndex(row=>row.id===rowId),row=sheet.rows[index];
  if(!row)throw new ModelError('预览行不存在，请选择一行','prompt_row');
  const sourceValues=column.sources.map(source=>row.cells[source]?.value??'');
  const text=column.sources.length===1?sourceValues[0]:column.sources.map((source,i)=>`[${sheet.columns.find(c=>c.id===source)?.name}]\n${sourceValues[i]}`).join('\n\n');
  const current=row.cells[column.id]?.value??'';
  // Bound history text without persisting any expanded prompt or request metadata.
  const recent=Array.from(new Set([...history,current].filter(value=>value.trim()))).slice(-5);
  const excerpts:string[]=[];
  for(const value of [...recent].reverse()){
    let excerpt=value;
    while(JSON.stringify([excerpt,...excerpts]).length>10000&&excerpt.length)excerpt=excerpt.slice(0,Math.floor(excerpt.length*.8));
    if(!excerpt)break;
    excerpts.unshift(excerpt);
  }
  return {text:text??'',existing_result:current,recent_results:JSON.stringify(excerpts),timestamp:now.toISOString().replace(/\.\d{3}Z$/,'Z'),request_id:requestId,row_number:String(index+1),column_name:column.name};
}
export function expandPrompt(template:string,context:PromptContext,limit:number,field:string):string {
  // One pass only: braces in source data must never become executable templates.
  const expanded=template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(_match,key:string)=>{
    if(!Object.hasOwn(context,key))throw new ModelError(`未知模板 {{${key}}}，请在${field}中选择受支持的模板`,'prompt_template');
    return context[key as keyof PromptContext];
  });
  if(!expanded.trim())throw new ModelError(`${field}展开后为空，请填写内容`,'prompt_empty');
  if(expanded.length>limit)throw new ModelError(`${field}展开后超过 ${limit} 字符，请缩短提示词或来源内容`,'prompt_size');
  return expanded;
}
export function buildPrompts(column:Column,context:PromptContext) {
  const system=expandPrompt(column.prompt,context,12000,'系统提示词');
  const input=expandPrompt(column.userPrompt??'{{text}}',context,32000,'用户提示词');
  return {prompt:system,input};
}
