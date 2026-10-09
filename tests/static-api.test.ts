import test from 'node:test';import assert from 'node:assert/strict';
import {staticApi} from '../model/static-api';import {readGeneration} from '../model/stream';
const origin='https://zvision755.github.io';
const config={provider:'deepseek',model:'deepseek-flash',prompt:'说明',input:'测试',maxTokens:128,reasoning:'none',stream:true};
const init=(body:unknown):RequestInit=>({method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer static-test-only-key'},body:JSON.stringify(body)});
test('Pages direct AI shares protocol, streaming and credential redaction without calling a site API',async()=>{
 let target='',body='';const mock:typeof fetch=async(input,options)=>{target=String(input);body=String(options?.body);return new Response('data: '+JSON.stringify({choices:[{delta:{content:'结果'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:3}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});};
 const response=await staticApi('/api/generate',init(config),origin,mock),seen:string[]=[];const result=await readGeneration(response,new AbortController().signal,text=>seen.push(text));
 assert.equal(target,'https://api.deepseek.com/chat/completions');assert.equal(result.text,'结果');assert.ok(seen.includes('结果'));assert.equal(JSON.parse(body).stream,true);assert.ok(!body.includes('static-test-only-key'));
});
test('Pages rejects arbitrary/private destinations and disables Codex, storage and free TTS',async()=>{
 let calls=0;const mock:typeof fetch=async()=>{calls++;return new Response('{}');};
 for(const customUrl of ['http://127.0.0.1:1234/v1','https://evil.example/v1','https://169.254.169.254/v1'])assert.equal((await staticApi('/api/generate',init({...config,provider:'custom',customUrl}),origin,mock)).status,400);
 for(const path of ['/api/local-agent/generate','/api/workspace','/api/settings'])assert.equal((await staticApi(path,init({}),origin,mock)).status,404);
 assert.equal((await staticApi('/api/local-tts/speech',init({url:'volcengine-free'}),origin,mock)).status,400);assert.equal(calls,0);
 for(const url of ['https://localhost:1234/v1','https://127.0.0.1:8880/v1'])assert.equal((await staticApi('/api/local-tts/speech',init({url,model:'tts-1',voice:'alloy',input:'测试',speed:1}),origin,mock)).status,400);assert.equal(calls,0);
});
test('Pages reports CORS/network without repeated automatic calls or raw credentials',async()=>{
 const result=await staticApi('/api/generate',init(config),origin,async()=>{throw Error('raw private static-test-only-key');});const data=await result.json() as {error:{code:string;retryable:boolean}};assert.equal(data.error.code,'cors_or_network');assert.equal(data.error.retryable,false);assert.ok(!JSON.stringify(data).includes('static-test-only-key'));
});
test('Pages direct TTS forwards only reviewed HTTPS, omits cookies and sanitizes failures',async()=>{
 let target='',credentials='';const response=await staticApi('/api/local-tts/speech',init({url:'https://api.openai.com/v1',model:'tts-1',voice:'alloy',input:'朗读',speed:1}),origin,async(url,options)=>{target=String(url);credentials=String(options?.credentials);return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'audio/mpeg'}});});assert.equal(target,'https://api.openai.com/v1/audio/speech');assert.equal(credentials,'omit');assert.equal(response.status,200);
});
