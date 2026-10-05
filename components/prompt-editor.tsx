'use client';
import { useRef, useState } from 'react';
import { buildPrompts, promptContext, promptTemplates, validatePromptTemplates } from '../core/prompt-templates';
import type { Column, Sheet } from '../core/types';

export function PromptEditor({column,sheet,history,onChange}:{column:Column;sheet:Sheet;history:(row:string)=>string[];onChange:(column:Column)=>void}) {
  const systemRef=useRef<HTMLTextAreaElement>(null),userRef=useRef<HTMLTextAreaElement>(null);
  const [target,setTarget]=useState<'prompt'|'userPrompt'>('userPrompt');
  const [rowId,setRowId]=useState(sheet.rows[0]?.id??'');
  const row=sheet.rows.find(r=>r.id===rowId)??sheet.rows[0];
  let preview:{prompt:string;input:string}|undefined,error='';
  try{validatePromptTemplates(column);if(row)preview=buildPrompts(column,promptContext(sheet,row.id,column,history(row.id),new Date(),'预览请求-ID'),column.freshResults?Array.from(new Set([...history(row.id),row.cells[column.id]?.value??''].filter(Boolean))).slice(-5):[]);}catch(e){error=e instanceof Error?e.message:'无法展开提示词';}
  function insert(key:string) {
    const ref=target==='prompt'?systemRef:userRef,element=ref.current;
    const value=target==='prompt'?column.prompt:column.userPrompt??'{{text}}';
    const start=element?.selectionStart??value.length,end=element?.selectionEnd??start,token=`{{${key}}}`;
    const next=value.slice(0,start)+token+value.slice(end);
    if(next.length>(target==='prompt'?12000:32000))return;
    onChange({...column,[target]:next});
    requestAnimationFrame(()=>{element?.focus();element?.setSelectionRange(start+token.length,start+token.length);});
  }
  return <div className="prompt-editor">
    <label>系统提示词 <small>角色、规则与输出格式</small><textarea ref={systemRef} aria-label="系统提示词" rows={6} maxLength={12000} placeholder="告诉 AI 如何处理来源内容…" value={column.prompt} onFocus={()=>setTarget('prompt')} onChange={e=>onChange({...column,prompt:e.target.value})}/><small>{column.prompt.length} / 12000</small></label>
    <label>用户提示词 <small>本次任务与动态数据</small><textarea ref={userRef} aria-label="用户提示词" rows={5} maxLength={32000} value={column.userPrompt??'{{text}}'} onFocus={()=>setTarget('userPrompt')} onChange={e=>onChange({...column,userPrompt:e.target.value})}/><small>{(column.userPrompt??'{{text}}').length} / 32000 · 默认 {'{{text}}'} 会发送来源内容</small></label>
    <div className="template-box"><div className="template-toolbar"><strong>插入模板</strong><select aria-label="模板插入位置" value={target} onChange={e=>setTarget(e.target.value as typeof target)}><option value="userPrompt">用户提示词</option><option value="prompt">系统提示词</option></select></div><div className="template-chips">{promptTemplates.map(item=><button type="button" key={item.key} title={`${item.description} · {{${item.key}}}`} aria-label={`插入${item.name}模板`} onClick={()=>insert(item.key)}>{item.name}<code>{`{{${item.key}}}`}</code></button>)}</div>
    <details><summary>模板说明</summary><ul>{promptTemplates.map(item=><li key={item.key}><code>{`{{${item.key}}}`}</code> {item.description}</li>)}</ul><p>两种提示词都支持模板，展开发生在每次请求前。来源和已有结果按原文发送；不会执行其中的模板。时间或 ID 本身不能保证生成不同内容。</p></details></div>
    {error&&<div role="alert" className="cell-error">{error}</div>}
    <details className="prompt-preview"><summary>预览实际请求</summary><label>预览行<select aria-label="提示词预览行" value={row?.id??''} onChange={e=>setRowId(e.target.value)}>{sheet.rows.map((r,i)=><option key={r.id} value={r.id}>第 {i+1} 行 · {(r.cells[sheet.columns[0].id]?.value??'').slice(0,24)}</option>)}</select></label><p>不调用模型。正式请求会使用当时的时间和新的 ID；“换一个”开启时，也显示自动附加的排除规则。</p>{preview?<><h4>系统消息</h4><pre aria-label="展开后的系统提示词">{preview.prompt}</pre><h4>用户消息</h4><pre aria-label="展开后的用户提示词">{preview.input}</pre></>:!error&&<p>请先添加一行以预览。</p>}</details>
  </div>;
}
