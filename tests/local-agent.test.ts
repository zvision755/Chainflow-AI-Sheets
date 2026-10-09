import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexBridge, codexEnvironment, codexArguments, codexFailure } from '../build/codex-bridge';
import { LocalAgentError, type CodexTransport, type RpcMessage } from '../build/codex-protocol';
import { localAgentRequest, localRequestAllowed } from '../build/local-agent-http';
import { localAgentClient, connectLocalAgent } from '../model/local-agent';
import { GET as productionCapabilities } from '../app/api/capabilities/route';
import { Scheduler } from '../core/scheduler';
import { example, type GenerateInput } from '../core/types';
import { defaultRunOptions } from '../core/run-settings';
import { readGeneration } from '../model/stream';
const payload:GenerateInput={model:'gpt-6-luna',prompt:'生成结果',input:'フレーム',maxTokens:1024,reasoning:'none'};
class FakeCodex implements CodexTransport {
  calls:{method:string;params:any}[]=[];listeners=new Set<(m:RpcMessage)=>void>();threads=0;auth='chatgpt';hold=false;
  notify(method:string,params:any){for(const listener of this.listeners)listener({method,params});}
  async request(method:string,params:any){
    this.calls.push({method,params});
    if(method==='account/read')return {account:{type:this.auth,planType:'plus'}};
    if(method==='model/list')return {data:[{model:'gpt-6-luna',displayName:'GPT-6 Luna',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}],defaultReasoningEffort:'low'}],nextCursor:null};
    if(method==='thread/start')return {thread:{id:'t'+(++this.threads)}};
    if(method==='turn/start'){
      if(!this.hold)setTimeout(()=>{
        this.notify('item/completed',{threadId:params.threadId,item:{type:'agentMessage',id:'i1',text:'commentary',phase:'commentary'}});
        this.notify('item/completed',{threadId:params.threadId,item:{type:'agentMessage',id:'i2',text:params.input[0].text+'结果',phase:'final_answer'}});
        this.notify('thread/tokenUsage/updated',{threadId:params.threadId,tokenUsage:{total:{inputTokens:25,outputTokens:12}}});
        this.notify('turn/completed',{threadId:params.threadId,turn:{status:'completed'}});
      },0);
      return {turn:{id:'turn-'+params.threadId}};
    }
    return {};
  }
  onNotification(listener:(m:RpcMessage)=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  close(){this.notify('bridge/disconnected',{});}
}
const setup=()=>{const fake=new FakeCodex();return {fake,bridge:new CodexBridge('/empty',undefined,async()=>fake)};};
async function waitFor(fake:FakeCodex,method:string,count=1){for(let i=0;i<100;i++){if(fake.calls.filter(c=>c.method===method).length>=count)return;await new Promise(r=>setTimeout(r,2));}throw Error('missing '+method);}
test('Codex returns final answer and actual usage, forces subscription auth and low effort for none',async()=>{
  const {fake,bridge}=setup();const result=await bridge.generate(payload,new AbortController().signal);
  assert.equal(result.text,'フレーム结果');assert.deepEqual(result.usage,{input:25,output:12});
  const thread=fake.calls.find(c=>c.method==='thread/start')!.params;assert.equal(thread.ephemeral,true);assert.equal(thread.modelProvider,'openai');assert.equal(thread.sandbox,'read-only');
  assert.equal(fake.calls.find(c=>c.method==='turn/start')!.params.effort,'low');assert.ok(fake.calls.some(c=>c.method==='thread/unsubscribe'));
  bridge.close();
});
test('API login is rejected before any generation, never falls back to a key',async()=>{
  const {fake,bridge}=setup();fake.auth='apiKey';await assert.rejects(bridge.generate(payload,new AbortController().signal),(e:any)=>e.code==='codex_login');assert.equal(fake.calls.some(c=>c.method==='thread/start'),false);bridge.close();
});
test('unavailable models and unsupported effort fail without a turn',async()=>{
  const {fake,bridge}=setup();await assert.rejects(bridge.generate({...payload,model:'missing'},new AbortController().signal),(e:any)=>e.code==='codex_model');await assert.rejects(bridge.generate({...payload,reasoning:'high'},new AbortController().signal),(e:any)=>e.code==='codex_reasoning');assert.equal(fake.calls.some(c=>c.method==='turn/start'),false);bridge.close();
});
test('cancel interrupts only the relevant turn and does not accept its late result',async()=>{
  const {fake,bridge}=setup();fake.hold=true;const abort=new AbortController();const run=bridge.generate(payload,abort.signal);await waitFor(fake,'turn/start');abort.abort();await assert.rejects(run,(e:any)=>e.code==='cancelled');assert.deepEqual(fake.calls.find(c=>c.method==='turn/interrupt')?.params,{threadId:'t1',turnId:'turn-t1'});assert.equal(fake.calls.filter(c=>c.method==='turn/interrupt').length,1);fake.notify('turn/completed',{threadId:'t1',turn:{status:'completed'}});bridge.close();
});
test('server concurrency is bounded and disconnect releases every pending generation',async()=>{
  const {fake,bridge}=setup();fake.hold=true;const runs=Array.from({length:10},()=>bridge.generate(payload,new AbortController().signal));const errors=runs.map(p=>assert.rejects(p,(e:any)=>e.code==='codex_disconnected'));await waitFor(fake,'turn/start',10);await assert.rejects(bridge.generate(payload,new AbortController().signal),(e:any)=>e.code==='codex_busy');fake.close();await Promise.all(errors);bridge.close();
});
test('unexpected tools and oversized final output cannot become successful results',async()=>{
  const {fake,bridge}=setup();fake.hold=true;const run=bridge.generate(payload,new AbortController().signal);const failure=assert.rejects(run,(e:any)=>e.code==='codex_tool_blocked');await waitFor(fake,'turn/start');fake.notify('item/started',{threadId:'t1',item:{type:'commandExecution'}});await failure;
  const run2=bridge.generate({...payload,maxTokens:64},new AbortController().signal);const failure2=assert.rejects(run2,(e:any)=>e.code==='codex_output_limit');await waitFor(fake,'turn/start',2);fake.notify('item/completed',{threadId:'t2',item:{type:'agentMessage',id:'long',text:'x'.repeat(513),phase:'final_answer'}});fake.notify('turn/completed',{threadId:'t2',turn:{status:'completed'}});await failure2;bridge.close();
});
test('quota exhaustion is permanent; temporary rate limits and connection faults may retry',()=>{
  assert.equal(codexFailure('usageLimitExceeded').retryable,false);assert.equal(codexFailure('rateLimitExceeded').retryable,true);assert.equal(codexFailure('unauthorized').retryable,false);assert.equal(codexFailure({httpConnectionFailed:{httpStatusCode:401}}).retryable,false);assert.equal(codexFailure({httpConnectionFailed:{httpStatusCode:502}}).retryable,true);
});
test('local bridge environment strips API keys and process config disables user tools without changing files',()=>{
  const env=codexEnvironment({OPENAI_API_KEY:'secret',CODEX_API_KEY:'secret',ACCESS_TOKEN:'secret',PATH:'/bin',NODE_ENV:'test'},'http://127.0.0.1:7897');assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.ACCESS_TOKEN,undefined);assert.equal(env.PATH,'/bin');assert.equal(env.HTTPS_PROXY,'http://127.0.0.1:7897');
  const args=codexArguments('[mcp_servers.demo]\n[mcp_servers.demo.env]\n[plugins."demo@vendor"]');assert.ok(args.includes('mcp_servers.demo.enabled=false'));assert.equal(args.includes('mcp_servers.demo.env.enabled=false'),false);assert.ok(args.includes('plugins."demo@vendor".enabled=false'));assert.ok(args.includes('features.shell_tool=false'));assert.ok(args.includes('features.hooks=false'));
});
test('local routes reject off-origin, non-loopback, unexpected keys and oversized/invalid input before touching Codex',async()=>{
  let called=0;const bridge={status:async()=>{called++;return {} as any;},generate:async()=>{called++;return {} as any;}};
  const request=(body:unknown,origin='http://127.0.0.1:3002',headers={})=>new Request('http://127.0.0.1:3002/api/local-agent/generate',{method:'POST',headers:{origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await localAgentRequest(request(payload,'https://evil.example'),'generate',bridge)).status,403);
  assert.equal((await localAgentRequest(request(payload,undefined,{Authorization:'Bearer hidden'}),'generate',bridge)).status,400);
  assert.equal((await localAgentRequest(request({...payload,targetUrl:'https://evil.example'}),'generate',bridge)).status,400);
  assert.equal((await localAgentRequest(request({...payload,input:'x'.repeat(71000)}),'generate',bridge)).status,413);
  assert.equal(called,0);assert.equal(localRequestAllowed('127.0.0.1:3002','127.0.0.1'),true);assert.equal(localRequestAllowed('evil.example:3002','127.0.0.1'),false);assert.equal(localRequestAllowed('127.0.0.1:3002','192.168.1.2'),false);
});
test('structured errors are no-store and never expose Codex raw diagnostics',async()=>{
  const request=new Request('http://127.0.0.1:3002/api/local-agent/status',{method:'POST',headers:{origin:'http://127.0.0.1:3002','Content-Type':'application/json'},body:'{}'});
  const response=await localAgentRequest(request,'status',{status:async()=>{throw Error('secret auth-token');},generate:async()=>{throw Error();}});
  assert.match(response.headers.get('cache-control')!,/no-store/);assert.equal((await response.text()).includes('secret'),false);
});
test('browser Codex client sends no Authorization or API connection settings',async()=>{
  const original=globalThis.fetch;const calls:any[]=[];globalThis.fetch=(async(path,init)=>{calls.push({path,init});return new Response(JSON.stringify(String(path).endsWith('status')?{connected:true,auth:'chatgpt',models:[]}:{text:'ok',usage:{input:1,output:2}}));}) as typeof fetch;
  try{await connectLocalAgent(new AbortController().signal);await localAgentClient(payload,new AbortController().signal);for(const c of calls){assert.equal(new Headers(c.init.headers).has('authorization'),false);assert.equal(c.init.body.includes('customUrl'),false);assert.equal(c.init.cache,'no-store');}}finally{globalThis.fetch=original;}
});
test('production Sites capability explicitly disables local subscription bridge',async()=>{assert.equal((await productionCapabilities().json() as any).codex,false);});
test('Agent scheduler snapshots backend and selected model for both dependent cells, ends at zero',async()=>{
  const calls:any[]=[];const engine=new Scheduler(example(),async(p,s,context)=>{calls.push({p,context});return {text:p.input+'结果',usage:{input:1,output:2}};});engine.run(engine.targets('all'),{...defaultRunOptions,mode:'agent',agentBackend:'codex',agentModel:'gpt-6-luna',dependencyDelayMs:0,autoRetry:false});
  for(let i=0;i<100&&engine.busy;i++)await new Promise(r=>setTimeout(r,2));assert.equal(engine.busy,false);assert.equal(calls.length,2);assert.equal(calls[1].p.input,'フレーム结果');assert.ok(calls.every(c=>c.context.agentBackend==='codex'&&c.p.model==='gpt-6-luna'));assert.equal(engine.running,0);
});
test('changing the Agent model invalidates generated results while preserving inputs and old output',async()=>{
  let calls=0;const engine=new Scheduler(example(),async p=>{calls++;return {text:p.input+'结果',usage:{input:1,output:2}};});engine.run(engine.targets('all'),{...defaultRunOptions,mode:'agent',dependencyDelayMs:0,autoRetry:false});for(let i=0;i<100&&engine.busy;i++)await new Promise(r=>setTimeout(r,2));const old=engine.sheet.rows[0].cells.teacher.value;engine.invalidateGeneratedResults();assert.equal(engine.sheet.rows[0].cells.input.status,'done');assert.equal(engine.sheet.rows[0].cells.teacher.value,old);assert.equal(engine.sheet.rows[0].cells.teacher.status,'stale');assert.equal(engine.estimate(engine.targets('all')),2);assert.equal(calls,2);
});
test('Codex streams final-answer deltas before turn completion and never displays commentary',async()=>{
  const {fake,bridge}=setup();fake.hold=true;const seen:string[]=[];
  const run=bridge.generate(payload,new AbortController().signal,t=>seen.push(t));await waitFor(fake,'turn/start');
  fake.notify('item/started',{threadId:'t1',item:{type:'agentMessage',id:'comment',phase:'commentary'}});
  fake.notify('item/agentMessage/delta',{threadId:'t1',itemId:'comment',delta:'分析内容'});
  fake.notify('item/completed',{threadId:'t1',item:{type:'agentMessage',id:'comment',phase:'commentary',text:'分析内容'}});
  assert.deepEqual(seen,[]);
  fake.notify('item/started',{threadId:'t1',item:{type:'agentMessage',id:'answer',phase:'final_answer'}});
  fake.notify('item/agentMessage/delta',{threadId:'t1',itemId:'answer',delta:'フレ'});
  assert.deepEqual(seen,['フレ']);
  fake.notify('item/agentMessage/delta',{threadId:'t1',itemId:'answer',delta:'ーム結果'});
  fake.notify('item/completed',{threadId:'t1',item:{type:'agentMessage',id:'answer',phase:'final_answer',text:'フレーム結果'}});
  fake.notify('thread/tokenUsage/updated',{threadId:'t1',tokenUsage:{total:{inputTokens:6,outputTokens:8}}});
  fake.notify('turn/completed',{threadId:'t1',turn:{status:'completed'}});
  assert.deepEqual(await run,{text:'フレーム結果',usage:{input:6,output:8}});bridge.close();
});
test('local Agent SSE route streams without a key and reader cancel interrupts its Codex turn',async()=>{
  const {fake,bridge}=setup();fake.hold=true;const seen:string[]=[];
  const response=await localAgentRequest(new Request('http://127.0.0.1:3002/api/local-agent/generate',{method:'POST',headers:{origin:'http://127.0.0.1:3002','content-type':'application/json'},body:JSON.stringify({...payload,stream:true})}),'generate',bridge);
  assert.match(response.headers.get('content-type')!,/text\/event-stream/);assert.match(response.headers.get('cache-control')!,/no-store/);
  const abort=new AbortController(),run=readGeneration(response,abort.signal,t=>seen.push(t));const failure=assert.rejects(run,(e:any)=>e.code==='cancelled');
  await waitFor(fake,'turn/start');fake.notify('item/started',{threadId:'t1',item:{type:'agentMessage',id:'answer',phase:'final_answer'}});fake.notify('item/agentMessage/delta',{threadId:'t1',itemId:'answer',delta:'部分'});
  for(let i=0;i<100&&!seen.length;i++)await new Promise(r=>setTimeout(r,2));assert.deepEqual(seen,['部分']);
  abort.abort();await failure;await waitFor(fake,'turn/interrupt');assert.equal(fake.calls.filter(c=>c.method==='turn/interrupt').length,1);bridge.close();
});
test('local Agent streaming failures hide raw diagnostics and stream-off keeps the JSON route',async()=>{
  let progress=0;const bridge={status:async()=>({} as any),generate:async(_p:GenerateInput,_s:AbortSignal,onText?:((t:string)=>void))=>{if(onText){onText('部分');throw Error('private auth diagnostic');}progress++;return {text:'完整',usage:{input:1,output:2}};}};
  const request=(stream:boolean)=>new Request('http://127.0.0.1:3002/api/local-agent/generate',{method:'POST',headers:{origin:'http://127.0.0.1:3002','content-type':'application/json'},body:JSON.stringify({...payload,stream})});
  const seen:string[]=[];await assert.rejects(readGeneration(await localAgentRequest(request(true),'generate',bridge),new AbortController().signal,t=>seen.push(t)),(e:any)=>e.code==='codex_connection'&&!e.message.includes('private'));assert.deepEqual(seen,['部分']);
  const complete=await localAgentRequest(request(false),'generate',bridge);assert.match(complete.headers.get('content-type')!,/application\/json/);assert.equal((await complete.json() as any).text,'完整');assert.equal(progress,1);
});
