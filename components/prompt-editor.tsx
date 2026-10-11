'use client';
import { useRef, useState } from 'react';
import { bindSourceReferences, displaySourceReferences, buildPrompts, promptContext, promptTemplates, sourceTemplates, validatePromptTemplates } from '../core/prompt-templates';
import type { Column, Sheet } from '../core/types';

export function PromptEditor({column,sheet,history,onChange}:{column:Column;sheet:Sheet;history:(row:string)=>string[];onChange:(column:Column)=>void}) {
  const systemRef=useRef<HTMLTextAreaElement>(null),userRef=useRef<HTMLTextAreaElement>(null);
  const [target,setTarget]=useState<'prompt'|'userPrompt'>('userPrompt');
  const [rowId,setRowId]=useState(sheet.rows[0]?.id??'');
  const row=sheet.rows.find(r=>r.id===rowId)??sheet.rows[0];
  const sources=sourceTemplates(sheet,column),multiple=column.sources.length>1;
  let preview:{prompt:string;input:string}|undefined,error='';
  try{validatePromptTemplates(column,sheet);if(row)preview=buildPrompts(column,promptContext(sheet,row.id,column,history(row.id),new Date(),'预览请求-ID'));}catch(e){error=e instanceof Error?e.message:'无法展开提示词';}
  function insert(key:string) {
    const ref=target==='prompt'?systemRef:userRef,element=ref.current;
    const value=displaySourceReferences(target==='prompt'?column.prompt:column.userPrompt??'{{text}}',sheet);
    const start=element?.selectionStart??value.length,end=element?.selectionEnd??start,token=`{{${key}}}`;
    const next=value.slice(0,start)+token+value.slice(end);
    if(next.length>(target==='prompt'?12000:32000))return;
    onChange({...column,[target]:bindSourceReferences(next,sheet)});
    requestAnimationFrame(()=>{element?.focus();element?.setSelectionRange(start+token.length,start+token.length);});
  }
  return <div className="prompt-editor">
    {multiple&&<div className="prompt-source-warning" role="note"><strong>已选择多个来源：用户提示词必须使用每个来源列的内容模板</strong><p>{sources.map(source=>`${source.letter} · ${source.name}`).join('、')}。请使用下方对应列的模板按钮插入。{'{{text}}'} 已禁用；各模板只输出格子原文，语境、单词等标签由你自行填写。</p></div>}
    {error&&<div role="alert" className="cell-error">{displaySourceReferences(error,sheet)}</div>}
    <label>系统提示词 <small>角色、规则与输出格式</small><textarea ref={systemRef} aria-label="系统提示词" rows={6} maxLength={12000} placeholder="告诉 AI 如何处理来源内容…" value={displaySourceReferences(column.prompt,sheet)} onFocus={()=>setTarget('prompt')} onChange={e=>onChange({...column,prompt:bindSourceReferences(e.target.value,sheet)})}/><small>{column.prompt.length} / 12000</small></label>
    <label>用户提示词 <small>本次任务与动态数据</small><textarea ref={userRef} aria-label="用户提示词" rows={5} maxLength={32000} value={displaySourceReferences(column.userPrompt??'{{text}}',sheet)} onFocus={()=>setTarget('userPrompt')} onChange={e=>onChange({...column,userPrompt:bindSourceReferences(e.target.value,sheet)})}/><small>{(column.userPrompt??'{{text}}').length} / 32000 · {multiple?'必须包含每个已勾选来源列的内容模板':'发送完整的自定义用户提示词；{{text}} 替换为来源格子原文，默认提示词仅含此模板'}；只有使用历史模板才发送历史</small></label>
    <div className="template-box"><div className="template-toolbar"><strong>插入模板</strong><select aria-label="模板插入位置" value={target} onChange={e=>setTarget(e.target.value as typeof target)}><option value="userPrompt">用户提示词</option><option value="prompt">系统提示词</option></select></div><div className="template-chips">{sources.map(source=><button type="button" key={source.key} title={`${source.description} · {{source:${source.letter}}}`} aria-label={`插入${source.letter}列内容模板`} onClick={()=>insert(`source:${source.letter}`)}>{source.letter} · {source.name}<code>{`{{source:${source.letter}}}`}</code></button>)}{promptTemplates.map(item=><button type="button" key={item.key} disabled={item.key==='text'&&multiple} title={`${item.description} · {{${item.key}}}`} aria-label={`插入${item.name}模板`} onClick={()=>insert(item.key)}>{item.name}<code>{`{{${item.key}}}`}</code></button>)}</div>
    <details><summary>模板说明</summary><ul>{sources.map(source=><li key={source.key}><strong>{source.letter} · {source.name}</strong> <code>{`{{source:${source.letter}}}`}</code> {source.description}</li>)}{promptTemplates.map(item=><li key={item.key}><code>{`{{${item.key}}}`}</code> {item.description}</li>)}</ul><p>列内容模板使用当前列号（如 {'{{source:A}}'}）；列改名不影响引用，列移动后会显示新的列号，但仍引用原来的列。两种提示词都支持模板，展开发生在每次请求前。来源和已有结果按原文发送；不会执行其中的模板。多来源时，用户提示词必须包含每个勾选来源的独立模板，系统提示词也不能使用 {'{{text}}'}。</p><p>将请求 ID 或时间模板放在系统提示词最前面，可降低相同前缀的缓存命中；请求 ID 每次不同，时间戳同秒可能相同。不能保证所有平台禁用缓存，也不保证输出不同；提示词缓存不是直接复用旧答案。</p><p>电脑版单元格：勾选“检查重复结果（本地）”且已有内容时显示“换一个”，失败时显示“重试”，其他情况显示“运行”。换一个会重新请求并检查重复，运行和排队时按钮禁用。</p></details></div>
    <details className="prompt-preview"><summary>预览实际请求</summary><label>预览行<select aria-label="提示词预览行" value={row?.id??''} onChange={e=>setRowId(e.target.value)}>{sheet.rows.map((r,i)=><option key={r.id} value={r.id}>第 {i+1} 行 · {(r.cells[sheet.columns[0].id]?.value??'').slice(0,24)}</option>)}</select></label><p>仅展开你填写的模板，不追加任何隐藏规则或历史。时间和 ID 仅在使用对应模板时发送。</p>{preview?<><h4>系统消息</h4><pre aria-label="展开后的系统提示词">{preview.prompt}</pre><h4>用户消息</h4><pre aria-label="展开后的用户提示词">{preview.input}</pre></>:!error&&<p>请先添加一行以预览。</p>}</details>
  </div>;
}
