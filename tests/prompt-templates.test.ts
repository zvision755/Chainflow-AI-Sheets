import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompts, expandPrompt, promptContext } from '../core/prompt-templates';
import { example, emptyCell, type GenerateInput, type RunOptions } from '../core/types';
import { Scheduler } from '../core/scheduler';
import { parseSheet, serialize } from '../core/storage';

const options:RunOptions={mode:'api',concurrency:1,timeout:1000,maxSteps:2,maxRetries:0,totalTimeout:3000,dependencyDelayMs:0,autoRetry:false};
async function finish(engine:Scheduler){const end=Date.now()+2000;while(engine.busy){assert.ok(Date.now()<end,'任务必须结束');await new Promise(r=>setTimeout(r,5));}}
test('legacy sheets default to source-only user messages and persist templates without expansion',()=>{
  const s=example(),raw=JSON.parse(serialize(s));delete raw.columns[1].userPrompt;
  const restored=parseSheet(raw),col=restored.columns[1];assert.equal(col.userPrompt,'{{text}}');
  assert.deepEqual(buildPrompts(col,promptContext(restored,'row-1',col)),{prompt:col.prompt,input:'フレーム'});
  col.userPrompt='{{text}}\n{{timestamp}}\n{{existing_result}}';
  assert.equal(parseSheet(JSON.parse(serialize(restored))).columns[1].userPrompt,col.userPrompt);
  assert.ok(!serialize(restored).includes('预览请求'));
});
test('templates use exact current sources, prior result, bounded history, UTC seconds and request ID',()=>{
  const s=example(),col=s.columns[2];col.sources=['input','explain'];s.rows[0].cells.explain=emptyCell('来源例句','done');s.rows[0].cells.teacher=emptyCell('原解读','done');
  const context=promptContext(s,'row-1',col,['先前结果'],new Date('2026-10-06T01:02:03.456Z'),'test-id');
  assert.equal(context.text,'[日语单词]\nフレーム\n\n[日语释义]\n来源例句');assert.equal(context.existing_result,'1. 先前结果\n\n2. 原解读');assert.deepEqual(JSON.parse(context.recent_results),['先前结果','原解读']);assert.equal(context.timestamp,'2026-10-06T01:02:03Z');assert.equal(context.request_id,'test-id');assert.equal(context.row_number,'1');assert.equal(context.column_name,col.name);
  assert.ok(promptContext(s,'row-1',col,Array.from({length:5},(_,i)=> '"'.repeat(32000)+i)).recent_results.length<=10000);
});
test('request IDs work in browsers without crypto.randomUUID',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues(bytes:Uint8Array){bytes.fill(7);return bytes;}}});
  try {
    const s=example(),context=promptContext(s,'row-1',s.columns[1]);
    assert.match(context.request_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    if(previous)Object.defineProperty(globalThis,'crypto',previous);else delete (globalThis as {crypto?:Crypto}).crypto;
  }
});
test('template replacement is single-pass literal text, catches unknown names and expanded size',()=>{
  const s=example(),col=s.columns[1];s.rows[0].cells.input.value='{{timestamp}} $& <script>数据</script>';
  const ctx=promptContext(s,'row-1',col);
  assert.equal(expandPrompt('{{ text }}',ctx,32000,'用户提示词'),s.rows[0].cells.input.value);
  assert.throws(()=>expandPrompt('{{unknown}}',ctx,32000,'用户提示词'),/未知模板/);
  assert.throws(()=>expandPrompt(' {{existing_result}} ',ctx,32000,'用户提示词'),/为空/);
  assert.throws(()=>expandPrompt('{{text}}',ctx,2,'用户提示词'),/超过/);
});
test('API and local Agent receive separate expanded system/user messages with raw source checks',async()=>{
  for(const mode of ['api','agent'] as const){const s=example(),col=s.columns[1];col.prompt='生成例句：{{column_name}}';col.userPrompt='时间 {{timestamp}}\n单词 {{text}}\n避开 {{existing_result}}\n历史 {{recent_results}}';s.rows[0].cells.explain=emptyCell('旧结果','done');
    const sent:GenerateInput[]=[];const e=new Scheduler(s,async payload=>{sent.push(payload);return {text:'フレームを選びました。',usage:{input:1,output:2}};});
    e.run(e.targets('cell','row-1','explain'),{...options,mode,agentBackend:mode==='agent'?'codex':undefined},true);await finish(e);
    assert.equal(sent.length,1);assert.equal(sent[0].prompt,'生成例句：日语释义');assert.match(sent[0].input,/单词 フレーム\n避开 1\. 旧结果/);assert.ok(!sent[0].input.includes('{{'));assert.equal(e.sheet.rows[0].cells.explain.status,'done');assert.equal(e.running,0);
    assert.equal(col.userPrompt,'时间 {{timestamp}}\n单词 {{text}}\n避开 {{existing_result}}\n历史 {{recent_results}}');
  }
});
test('changing a user template invalidates only the column and its descendants, preserving text',()=>{
  const s=example();s.rows[0].cells.explain=emptyCell('已有例句','done');s.rows[0].cells.teacher=emptyCell('已有解读','done');const e=new Scheduler(s,async()=>{throw Error('不应调用');});
  e.configure({...s.columns[1],userPrompt:'{{text}}\n换一个例句'});
  assert.equal(s.rows[0].cells.input.status,'done');assert.equal(s.rows[0].cells.explain.status,'stale');assert.equal(s.rows[0].cells.teacher.status,'stale');assert.equal(s.rows[0].cells.explain.value,'已有例句');assert.equal(s.rows[0].cells.teacher.value,'已有解读');
});
test('invalid template fails before a model call and releases counts',async()=>{
  const s=example();s.columns[1].userPrompt='{{wrong_name}}';let calls=0;const e=new Scheduler(s,async()=>{calls++;throw Error('不应调用');});e.run(e.targets('cell','row-1','explain'),options);await finish(e);assert.equal(calls,0);assert.equal(e.running,0);assert.equal(e.queued,0);assert.match(s.rows[0].cells.explain.error!,/未知模板/);
});
test('invalid or empty user templates cannot overwrite a valid saved column',()=>{
  const s=example(),e=new Scheduler(s,async()=>{throw Error('不应调用');}),original={...s.columns[1]};
  assert.throws(()=>e.configure({...original,userPrompt:' '}),/不能为空/);
  assert.throws(()=>e.configure({...original,userPrompt:'{{not_supported}}'}),/未知模板/);
  assert.deepEqual(s.columns[1],original);
});
test('recent-results uses five records while existing-result uses the configured full history',()=>{
  const s=example(),col=s.columns[1];col.freshResults=true;col.userPrompt='来源：{{text}}\n本次时间：{{timestamp}}';s.rows[0].cells.explain.value='当前结果';
  const history=Array.from({length:100},(_,i)=>`旧结果-${i}`),ctx=promptContext(s,'row-1',col,history,new Date('2026-10-06T01:02:03Z'),'id');
  assert.deepEqual(JSON.parse(ctx.recent_results),['旧结果-96','旧结果-97','旧结果-98','旧结果-99','当前结果']);
  const lean=buildPrompts(col,ctx);assert.equal(lean.prompt,col.prompt);assert.equal(lean.input,'来源：フレーム\n本次时间：2026-10-06T01:02:03Z');
  col.userPrompt='{{text}}\n{{existing_result}}\n{{recent_results}}';const explicit=buildPrompts(col,ctx);assert.equal(explicit.prompt,col.prompt);assert.ok(explicit.input.includes('旧结果-99'));assert.ok(!explicit.prompt.includes('旧结果'));
});
test('Agent keeps system instructions exact and accepts output without source text',async()=>{
  const s=example(),sent:GenerateInput[]=[],e=new Scheduler(s,async p=>{sent.push(p);return {text:'没有来源词',usage:{input:1,output:2}};});
  e.run(e.targets('cell','row-1','explain'),{...options,mode:'agent',autoRetry:true,maxRetries:1},true);await finish(e);
  assert.equal(sent.length,1);assert.equal(sent[0].prompt,s.columns[1].prompt);assert.equal(sent[0].input,'フレーム');assert.equal(s.rows[0].cells.explain.value,'没有来源词');assert.equal(s.rows[0].cells.explain.status,'done');
});
