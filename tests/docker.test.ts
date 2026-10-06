import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createDockerHandler, hostTtsFetch, serveDockerRequest } from '../docker/http';
import { readGeneration } from '../model/stream';
import { Scheduler } from '../core/scheduler';
import { example } from '../core/types';
import { defaultRunOptions } from '../core/run-settings';
const input={provider:'openai',model:'gpt-6-luna',prompt:'用日语解释',input:'フレーム',maxTokens:128,reasoning:'none',stream:true};
const key='docker-test-credential-123456789';
async function fixture(options:Parameters<typeof createDockerHandler>[0],fn:(base:string)=>Promise<void>){
  const handler=createDockerHandler(options),server=createServer((req,res)=>void serveDockerRequest(req,res,handler,(_q,s)=>s.end('frontend')));
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as {port:number};
  try{await fn(`http://127.0.0.1:${address.port}`);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
const post=(base:string,body:unknown=input,auth=true,headers:Record<string,string>={})=>fetch(base+'/api/generate',{method:'POST',headers:{origin:base,'content-type':'application/json',...(auth?{authorization:`Bearer ${key}`} : {}),...headers},body:JSON.stringify(body)});
const encoder=new TextEncoder(),frame=(data:unknown)=>encoder.encode('data: '+JSON.stringify(data)+'\n\n');
test('Docker HTTP forwards true streaming before completion and releases its stream on cancellation',async()=>{
  let release!:()=>void;const gate=new Promise<void>(r=>release=r);let cancelled=false;
  await fixture({fetcher:(async()=>new Response(new ReadableStream({async start(c){c.enqueue(frame({type:'response.output_text.delta',delta:'フレ'}));await gate;if(!cancelled){c.enqueue(frame({type:'response.completed',response:{output_text:'フレーム',usage:{input_tokens:1,output_tokens:2}}}));c.close();}},cancel(){cancelled=true;release();}}),{headers:{'content-type':'text/event-stream'}})) as typeof fetch},async base=>{
    const response=await post(base);assert.equal(response.status,200);assert.match(response.headers.get('cache-control')!,/no-store/);
    const controller=new AbortController();let seen!:()=>void;const first=new Promise<void>(r=>seen=r),previews:string[]=[];
    const run=readGeneration(response,controller.signal,t=>{previews.push(t);seen();});await first;assert.equal(previews[0],'フレ');
    controller.abort();await assert.rejects(run,(e:any)=>e.code==='cancelled');for(let i=0;i<100&&!cancelled;i++)await new Promise(r=>setTimeout(r,2));assert.equal(cancelled,true);
  });
});
test('Docker API dependency chain uses actual upstream results and ends with no active tasks',async()=>{
  const received:string[]=[];
  await fixture({fetcher:(async(_u,i)=>{const body=JSON.parse(String(i?.body));received.push(body.input);return new Response(JSON.stringify({output_text:body.input+'結果',usage:{input_tokens:1,output_tokens:2}}));}) as typeof fetch},async base=>{
    const sheet=example(),engine=new Scheduler(sheet,async(p,s,c)=>readGeneration(await post(base,{...p,provider:'openai',stream:c?.stream}),s,c?.onText));engine.run(engine.targets('all'),{...defaultRunOptions,dependencyDelayMs:0,autoRetry:false});
    for(let i=0;i<100&&engine.busy;i++)await new Promise(r=>setTimeout(r,5));assert.equal(engine.busy,false);assert.deepEqual(received,['フレーム','フレーム結果']);assert.equal(sheet.rows[0].cells.teacher.status,'done');assert.equal(engine.running,0);assert.equal(engine.queued,0);
  });
});
test('Docker HTTP guards reject missing keys, foreign origin/host, oversized input and unknown routes',async()=>{
  let calls=0;await fixture({fetcher:(async()=>{calls++;throw Error('Unexpected upstream');}) as typeof fetch},async base=>{
    assert.equal((await post(base,input,false)).status,401);assert.equal((await post(base,input,true,{origin:'https://evil.example'})).status,403);
    const hostileHost=await new Promise<number|undefined>((resolve,reject)=>{const req=httpRequest(base+'/healthz',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(hostileHost,403);
    assert.equal((await post(base,{...input,input:'x'.repeat(71000)})).status,413);assert.equal((await fetch(base+'/api/unknown',{method:'POST'})).status,404);assert.equal(calls,0);assert.equal((await fetch(base+'/healthz')).status,200);
  });
});
test('Docker subscription route requires container login without credentials or owner API fallback',async()=>{
  let attempts=0;await fixture({bridge:{status:async()=>{attempts++;throw Error('private diagnostic');},generate:async()=>{throw Error('private diagnostic');}}},async base=>{
    const headers={origin:base,'content-type':'application/json'};const response=await fetch(base+'/api/local-agent/status',{method:'POST',headers,body:'{}'});assert.equal(response.status,503);assert.equal((await response.text()).includes('private'),false);
    const bad=await fetch(base+'/api/local-agent/generate',{method:'POST',headers:{...headers,authorization:`Bearer ${key}`},body:JSON.stringify(input)});assert.equal(bad.status,400);assert.equal(attempts,1);
  });
});
test('Docker TTS maps only validated loopback endpoints to the host and preserves no-cache behavior',async()=>{
  let destination='';const mapped=hostTtsFetch((async(url)=>{destination=String(url);return new Response(JSON.stringify({voices:['jf_alpha','af_heart']}));}) as typeof fetch);
  await fixture({ttsFetcher:mapped},async base=>{const response=await fetch(base+'/api/local-tts/voices',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({url:'http://localhost:8880/v1'})});assert.equal(response.status,200);assert.equal(destination,'http://host.docker.internal:8880/v1/audio/voices');assert.match(response.headers.get('cache-control')!,/no-store/);});
  assert.throws(()=>mapped('https://evil.example/v1/audio/voices'),/Unexpected/);
});

test('Docker bundled speech uses the project service and never the Mac or an external credential',async()=>{
  let destination='';await fixture({builtinTtsFetcher:(async(u,i)=>{destination=String(u);assert.equal(new Headers(i?.headers).has('authorization'),false);return Response.json({voices:['jf_alpha','af_heart']});}) as typeof fetch,ttsFetcher:(async()=>{throw Error('Host service must not be used');}) as typeof fetch},async base=>{
    const response=await fetch(base+'/api/local-tts/voices',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({url:'builtin'})});assert.equal(response.status,200);assert.equal(destination,'http://kokoro:8880/v1/audio/voices');
  });
});
