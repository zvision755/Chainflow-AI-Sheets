import test from 'node:test';
import assert from 'node:assert/strict';
import { proxy } from '../server/proxy';
import { readGeneration } from '../model/stream';
import { apiClient, ModelError } from '../model/client';
import { sseEvents } from '../core/stream-protocol';
import { Scheduler } from '../core/scheduler';
import { example, emptyCell, type RunOptions } from '../core/types';
import { serialize } from '../core/storage';
import { defaultRunOptions, readRunOptions, writeRunOptions } from '../core/run-settings';
const key='test-stream-credential-123456789';
const input={model:'gpt-6-luna',prompt:'只输出一个日语例句',input:'フレーム',maxTokens:256,reasoning:'none' as const};
const options:RunOptions={...defaultRunOptions,dependencyDelayMs:0,retryDelayMs:10,timeout:1000,totalTimeout:5000};
const encoder=new TextEncoder();
const frame=(data:unknown)=>`data: ${typeof data==='string'?data:JSON.stringify(data)}\r\n\r\n`;
const req=(extra:object={})=>new Request('https://test.example/api/generate',{method:'POST',headers:{origin:'https://test.example','content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({...input,stream:true,provider:'openai',...extra})});
function sse(text:string){const bytes=encoder.encode(text);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}),{headers:{'content-type':'text/event-stream'}});}
const ok=(text:string)=>({text,usage:{input:3,output:5}});
async function finish(e:Scheduler){const end=Date.now()+3000;while(e.busy){assert.ok(Date.now()<end,'应在时限内结束');await new Promise(r=>setTimeout(r,5));}}

test('streaming defaults on, migrates old run settings, and explicit off persists',()=>{
  assert.equal(defaultRunOptions.streaming,true);const old={...defaultRunOptions};delete old.streaming;
  assert.equal(readRunOptions(JSON.stringify(old))?.streaming,true);assert.equal(readRunOptions(writeRunOptions({...old,streaming:false}))?.streaming,false);
});
test('chat stream arrives before completion, decodes split Unicode, preserves messages and reports final usage',async()=>{
  let release!:()=>void,seen!:()=>void,sent:any;const gate=new Promise<void>(r=>release=r),first=new Promise<void>(r=>seen=r);
  const upstream=new ReadableStream<Uint8Array>({async start(c){c.enqueue(encoder.encode(': heartbeat\r\n\r\n'+frame({choices:[{delta:{content:'フレ'}}]})));await gate;c.enqueue(encoder.encode(frame({choices:[{delta:{content:'ーム'},finish_reason:'stop'}]})+frame({choices:[],usage:{prompt_tokens:10,completion_tokens:20}})+frame('[DONE]')));c.close();}});
  const response=await proxy(req({provider:'custom',customUrl:'https://aihubmix.com/v1/chat/completions'}),'generate',(async(_url,init)=>{sent=JSON.parse(String(init?.body));return new Response(upstream,{headers:{'content-type':'text/event-stream'}});}) as typeof fetch);
  const previews:string[]=[];const result=readGeneration(response,new AbortController().signal,t=>{previews.push(t);seen();});
  await first;assert.equal(previews[0],'フレ');assert.equal(sent.stream,true);assert.equal(sent.stream_options.include_usage,true);assert.deepEqual(sent.messages,[{role:'system',content:input.prompt},{role:'user',content:input.input}]);assert.match(response.headers.get('cache-control')!,/no-store/);
  release();assert.deepEqual(await result,{text:'フレーム',usage:{input:10,output:20}});
});
test('Responses stream ignores reasoning events, streams text and reads completed usage',async()=>{
  let sent:any;const response=await proxy(req(),'generate',(async(_u,i)=>{sent=JSON.parse(String(i?.body));return sse(frame({type:'response.reasoning_text.delta',delta:'private reasoning'})+frame({type:'response.output_text.delta',delta:'日本語'})+frame({type:'response.completed',response:{status:'completed',usage:{input_tokens:2,output_tokens:4}}}));}) as typeof fetch);
  const seen:string[]=[];assert.deepEqual(await readGeneration(response,new AbortController().signal,t=>seen.push(t)),{text:'日本語',usage:{input:2,output:4}});assert.ok(seen.every(t=>!t.includes('reasoning')));assert.equal(sent.stream,true);assert.equal(sent.store,false);assert.equal(sent.instructions,input.prompt);
});
test('compatible gateways with an incorrect SSE media type are decoded without another request',async()=>{
  let calls=0;const source=sse(frame({choices:[{delta:{content:'日本語'},finish_reason:'stop'}]})+frame('[DONE]'));
  const response=await proxy(req({provider:'custom',customUrl:'https://aihubmix.com/v1/chat/completions'}),'generate',(async()=>{calls++;return new Response(source.body,{headers:{'content-type':'application/json'}});}) as typeof fetch);
  assert.match(response.headers.get('content-type')!,/text\/event-stream/);assert.equal((await readGeneration(response,new AbortController().signal)).text,'日本語');assert.equal(calls,1);
});
test('Responses final text is authoritative, bounded and redacted, even if no delta was sent',async()=>{
  const response=await proxy(req(),'generate',(async()=>sse(frame({type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:'最终 '+key}]}],usage:{input_tokens:1,output_tokens:2}}}))) as typeof fetch);
  assert.deepEqual(await readGeneration(response,new AbortController().signal),{text:'最终 [已隐藏密钥]',usage:{input:1,output:2}});
  const tooLong=await proxy(req(),'generate',(async()=>sse(frame({type:'response.completed',response:{output_text:'x'.repeat(32001)}}))) as typeof fetch);
  await assert.rejects(readGeneration(tooLong,new AbortController().signal),(e:any)=>e.code==='output_size');
});
test('non-JSON upstream HTTP failures keep an actionable status without exposing diagnostics',async()=>{
  for(const [status,code] of [[400,'provider_parameters'],[401,'invalid_key'],[429,'rate_limit'],[503,'provider_error']] as const){const response=await proxy(req(),'generate',(async()=>new Response('<html>private '+key+'</html>',{status})) as typeof fetch);const data=await response.json() as any;assert.equal(data.error.code,code);assert.ok(!JSON.stringify(data).includes(key));}
});
test('credential split across deltas is redacted before any frame or final output reaches the client',async()=>{
  const response=await proxy(req({provider:'deepseek'}),'generate',(async()=>sse(frame({choices:[{delta:{content:'before '+key.slice(0,12)}}]})+frame({choices:[{delta:{content:key.slice(12)+' after'},finish_reason:'stop'}]})+frame('[DONE]'))) as typeof fetch);
  const seen:string[]=[];const result=await readGeneration(response,new AbortController().signal,t=>seen.push(t));assert.equal(result.text,'before [已隐藏密钥] after');assert.ok(seen.every(t=>!t.includes(key)&&!t.includes(key.slice(0,12))));
});
test('premature EOF, truncation and streamed quota failures never complete; raw upstream errors are hidden',async()=>{
  for(const [source,code] of [
    [frame({choices:[{delta:{content:'半截'}}]}),'stream_interrupted'],
    [frame({choices:[{delta:{content:'半截'},finish_reason:'length'}]})+frame('[DONE]'),'incomplete'],
    [frame({error:{code:'insufficient_quota',message:key}}),'insufficient_quota'],
    ['data: invalid-json\n\n','invalid_response'],
  ] as const){const response=await proxy(req({provider:'deepseek'}),'generate',(async()=>sse(source)) as typeof fetch);await assert.rejects(readGeneration(response,new AbortController().signal),(e:any)=>e.code===code&&!e.message.includes(key));}
});
test('stream concurrency stays occupied through body consumption and cancel releases all slots',async()=>{
  const never=(async()=>new Response(new ReadableStream({start(c){c.enqueue(encoder.encode(frame({type:'response.output_text.delta',delta:'部分'})));}}),{headers:{'content-type':'text/event-stream'}})) as typeof fetch;
  const responses=await Promise.all([proxy(req(),'generate',never),proxy(req(),'generate',never),proxy(req(),'generate',never)]);
  assert.equal((await proxy(req(),'generate',never)).status,429);await Promise.all(responses.map(r=>r.body!.cancel()));
  assert.equal((await proxy(req({stream:false}),'generate',(async()=>new Response(JSON.stringify({output_text:'ok'}))) as typeof fetch)).status,200);
});
test('SSE parser bounds bytes and reader abort cannot hang waiting for a silent stream',async()=>{
  await assert.rejects(async()=>{for await(const _ of sseEvents(sse(frame({text:'x'.repeat(200)})).body,new AbortController().signal,100)){}},/大小限制/);
  const abort=new AbortController(),response=new Response(new ReadableStream<Uint8Array>({}),{headers:{'content-type':'text/event-stream'}});const pending=readGeneration(response,abort.signal);abort.abort();await assert.rejects(pending,(e:any)=>e.code==='cancelled');
});
test('browser client sends one request, honors off, keeps key out of body, and accepts JSON fallback',async()=>{
  const original=globalThis.fetch;let calls=0,body:any;globalThis.fetch=(async(_p,i)=>{calls++;body=JSON.parse(String(i?.body));return new Response(JSON.stringify(ok('完整结果')));}) as typeof fetch;
  try{const result=await apiClient(()=>key,()=>({provider:'openai'}))(input,new AbortController().signal,{mode:'api',stream:false});assert.equal(result.text,'完整结果');assert.equal(calls,1);assert.equal(body.stream,false);assert.ok(!JSON.stringify(body).includes(key));}finally{globalThis.fetch=original;}
});
test('scheduler previews without overwriting saved output; downstream waits for the final accepted result',async()=>{
  let release!:(v:ReturnType<typeof ok>)=>void;const gate=new Promise<ReturnType<typeof ok>>(r=>release=r),calls:string[]=[];const sheet=example();sheet.rows[0].cells.explain=emptyCell('旧结果','stale');
  const e=new Scheduler(sheet,async(p,_s,c)=>{calls.push(p.input);if(calls.length===1){c?.onText?.('候选部分');return gate;}return ok('老师解读');});
  e.run(e.targets('all'),options);await new Promise(r=>setTimeout(r,5));assert.equal(sheet.rows[0].cells.explain.preview,'候选部分');assert.equal(sheet.rows[0].cells.explain.value,'旧结果');assert.equal(calls.length,1);assert.ok(!serialize(sheet).includes('候选部分'));assert.equal(e.queued,1);
  release(ok('完整フレーム结果'));await finish(e);assert.equal(calls[1],'完整フレーム结果');assert.equal(sheet.rows[0].cells.explain.preview,undefined);assert.equal(e.running,0);assert.equal(e.queued,0);
});
test('cancel and edit discard partial text and ignore late streaming callbacks',async()=>{
  for(const action of ['stop','edit'] as const){let callback!:(t:string)=>void,release!:(v:ReturnType<typeof ok>)=>void;const gate=new Promise<ReturnType<typeof ok>>(r=>release=r),s=example();s.rows[0].cells.explain=emptyCell('原结果','stale');
    const e=new Scheduler(s,async(_p,_s,c)=>{callback=c!.onText!;callback('部分结果');return gate;});e.run(e.targets('cell','row-1','explain'),options);await new Promise(r=>setTimeout(r,5));
    if(action==='stop')e.stop();else e.edit('row-1','input','新输入');await finish(e);callback('迟到的结果');release(ok('迟到的完整结果'));await new Promise(r=>setTimeout(r,5));assert.equal(s.rows[0].cells.explain.value,'原结果');assert.equal(s.rows[0].cells.explain.preview,undefined);assert.equal(e.running,0);
  }
});
test('interrupted partial output retries cleanly and only successful final text becomes a result',async()=>{
  let calls=0;const s=example(),e=new Scheduler(s,async(_p,_s,c)=>{calls++;c?.onText?.(calls===1?'失败的候选':'成功的候选');if(calls===1)throw new ModelError('连接中断','stream_interrupted',true);return ok('最终フレーム结果');});
  e.run(e.targets('cell','row-1','explain'),options);await finish(e);assert.equal(calls,2);assert.equal(s.rows[0].cells.explain.value,'最终フレーム结果');assert.equal(s.rows[0].cells.explain.preview,undefined);assert.equal(s.rows[0].cells.explain.status,'done');
});
test('Agent semantic checker streams internally but never displays its JSON as the cell candidate',async()=>{
  const s=example();s.columns[1].check=true;let calls=0;const e=new Scheduler(s,async(p,_s,c)=>{calls++;if(p.prompt.startsWith('检查')){assert.equal(c?.onText,undefined);return ok('{"pass":true}');}c?.onText?.('フレーム候选');return ok('フレーム最终结果');});
  e.run(e.targets('cell','row-1','explain'),{...options,mode:'agent'},true);await finish(e);assert.equal(calls,2);assert.equal(s.rows[0].cells.explain.value,'フレーム最终结果');
});
