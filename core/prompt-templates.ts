import { ModelError } from '../model/client';
import { id, type Column, type Sheet } from './types';
import { cellHistory, historyLimit } from './result-history';

export const promptTemplates = [
  {key:'text',name:'来源内容',description:'仅限单来源：在自定义提示词中替换为该格子的原文，不含列名；默认用户提示词只有此模板，多来源必须使用各列内容模板'},
  {key:'existing_result',name:'已有结果',description:'此单元格保存的全部历史结果，按生成顺序编号；条数由列配置决定，默认 10 次；首次运行为空'},
  {key:'recent_results',name:'最近结果',description:'保存历史中的最近 5 次结果，JSON 总长最多 10000 字符；仅使用此模板时发送'},
  {key:'timestamp',name:'当前时间',description:'请求发出时的 UTC 时间，精确到秒；同秒可能相同'},
  {key:'request_id',name:'请求 ID',description:'每次请求唯一；放在系统提示词开头可降低相同前缀的缓存命中，但不保证输出不同'},
  {key:'row_number',name:'行号',description:'从 1 开始的当前行号'},
  {key:'column_name',name:'列名称',description:'当前生成列的名称'},
] as const;
export type PromptContext = Record<string,string> & {text:string;existing_result:string;recent_results:string;timestamp:string;request_id:string;row_number:string;column_name:string};
export function sourceTemplates(sheet:Sheet,column:Column) {
  return column.sources.map(source=>{
    const index=sheet.columns.findIndex(c=>c.id===source),selected=sheet.columns[index];
    let number=index+1,letter='';
    while(number>0){number--;letter=String.fromCharCode(65+number%26)+letter;number=Math.floor(number/26);}
    return {key:`source:${source}`,letter,name:selected?.name??'已删除的来源列',description:'只输出当前行该格子的完整原文，不添加列名；引用绑定列 ID，改名或移动后仍指向原列'};
  });
}
// Human-facing column letters are resolved at edit time; persisted references use
// stable IDs so renaming or reordering columns cannot silently change a source.
export function displaySourceReferences(template:string,sheet:Sheet):string {
  const slots=sourceTemplates(sheet,{sources:sheet.columns.map(c=>c.id)} as Column);
  return template.replace(/\{\{\s*source:([^{}]+?)\s*\}\}/g,(token,source:string)=>{
    const slot=slots.find(item=>item.key===`source:${source}`);
    return slot?`{{source:${slot.letter}}}`:token;
  });
}
export function bindSourceReferences(template:string,sheet:Sheet):string {
  const slots=sourceTemplates(sheet,{sources:sheet.columns.map(c=>c.id)} as Column);
  return template.replace(/\{\{\s*source:([^{}]+?)\s*\}\}/g,(token,letter:string)=>{
    const slot=slots.find(item=>item.letter===letter.toUpperCase());
    return slot?`{{${slot.key}}}`:token;
  });
}
export function validatePromptTemplates(column:Column,sheet?:Sheet) {
  const userKeys=Array.from((column.userPrompt??'{{text}}').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g),match=>match[1]);
  for(const [template,limit,field] of [[column.prompt,12000,'系统提示词'],[column.userPrompt??'{{text}}',32000,'用户提示词']] as const){
    if(field==='用户提示词'&&!template.trim())throw new ModelError('用户提示词不能为空；请插入来源列内容模板','prompt_empty');
    if(template.length>limit)throw new ModelError(`${field}超过 ${limit} 字符`,'prompt_size');
    for(const match of template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)){
      const key=match[1];
      if(key==='text'&&column.sources.length>1)throw new ModelError('多来源已禁用 {{text}}；用户提示词必须使用每个已勾选来源列的内容模板，请在列设置中替换','prompt_template');
      if(key.startsWith('source:')){
        const source=key.slice(7);
        if(!column.sources.includes(source)||(sheet&&!sheet.columns.some(c=>c.id===source)))throw new ModelError(`来源模板 {{${key}}} 不再对应已勾选的有效来源列，请重新选择模板`,'prompt_template');
      }else if(!promptTemplates.some(item=>item.key===key))throw new ModelError(`未知模板 {{${key}}}，请在${field}中选择受支持的模板`,'prompt_template');
    }
  }
  if(column.sources.length>1){
    const missing=column.sources.filter(source=>!userKeys.includes(`source:${source}`));
    if(missing.length)throw new ModelError('多来源时，用户提示词必须使用每个已勾选来源列的内容模板；缺少：'+missing.map(source=>sheet?sourceTemplates(sheet,column).find(item=>item.key===`source:${source}`)!.name:`{{source:${source}}}`).join('、'),'prompt_template');
  }
}
export function promptContext(sheet:Sheet,rowId:string,column:Column,history:string[]=[],now=new Date(),requestId:string=id()):PromptContext {
  const index=sheet.rows.findIndex(row=>row.id===rowId),row=sheet.rows[index];
  if(!row)throw new ModelError('预览行不存在，请选择一行','prompt_row');
  const sourceValues=column.sources.map(source=>row.cells[source]?.value??'');
  for(const source of column.sources)if(!sheet.columns.some(c=>c.id===source)||!Object.hasOwn(row.cells,source))throw new ModelError('来源列或格子不存在，请在列设置中重新选择来源','prompt_template');
  const text=column.sources.length===1?sourceValues[0]:'';
  const cell=row.cells[column.id];
  const saved=cell?cellHistory({...cell,history:history.length?history:cell.history},historyLimit(column)):[];
  const recent=saved.slice(-5);
  const excerpts:string[]=[];
  for(const value of [...recent].reverse()){
    let excerpt=value;
    while(JSON.stringify([excerpt,...excerpts]).length>10000&&excerpt.length)excerpt=excerpt.slice(0,Math.floor(excerpt.length*.8));
    if(!excerpt)break;
    excerpts.unshift(excerpt);
  }
  return {...Object.fromEntries(column.sources.map((source,i)=>[`source:${source}`,sourceValues[i]])),text:text??'',existing_result:saved.map((value,index)=>`${index+1}. ${value}`).join('\n\n'),recent_results:JSON.stringify(excerpts),timestamp:now.toISOString().replace(/\.\d{3}Z$/,'Z'),request_id:requestId,row_number:String(index+1),column_name:column.name};
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
  validatePromptTemplates(column);
  const system=expandPrompt(column.prompt,context,12000,'系统提示词');
  const input=expandPrompt(column.userPrompt??'{{text}}',context,32000,'用户提示词');
  return {prompt:system,input};
}
