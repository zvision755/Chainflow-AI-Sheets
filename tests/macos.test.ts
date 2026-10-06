import test from 'node:test';
import assert from 'node:assert/strict';
import {createDockerHandler} from '../docker/http';
import {BundledKokoro} from '../macos/kokoro';
const origin='http://127.0.0.1:3004';
const post=(path:string,body:unknown={},headers:Record<string,string>={})=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
test('Bundled model starts idle and never loads from construction',()=>{
 const model=new BundledKokoro('/unavailable-bundle','/unavailable-profile');
 assert.deepEqual(model.status(),{state:'idle',loaded:false,autoLoad:false,memoryMiB:900});
});
test('Model loading requires explicit memory acknowledgement and remains same-origin',async()=>{
 let calls=0;const initial={state:'idle' as const,loaded:false,autoLoad:false,memoryMiB:900};
 const handler=createDockerHandler({runtime:'macos',ttsRuntime:{status:()=>initial,load:async remember=>{calls++;return {...initial,state:'ready',loaded:true,autoLoad:remember};},unload:async()=>initial}});
 assert.equal((await handler(post('/api/local-tts/runtime',{action:'load',autoLoad:true})))?.status,400);
 assert.equal((await handler(post('/api/local-tts/runtime',{action:'load',autoLoad:true,acceptedMemoryWarning:true},{Origin:'https://untrusted.example'})))?.status,403);
 assert.equal(calls,0);
 const result=await handler(post('/api/local-tts/runtime',{action:'load',autoLoad:false,acceptedMemoryWarning:true}));assert.ok(result);assert.equal((await result.json()as{autoLoad:boolean}).autoLoad,false);assert.equal(calls,1);
 const speech=await handler(post('/api/local-tts/speech',{url:'builtin'}));assert.equal(speech?.status,503);assert.equal(calls,1);
});
test('Mac Lite exposes external speech without a model or Docker fallback',async()=>{
 let calls=0;const handler=createDockerHandler({runtime:'macos',builtinTts:false,builtinTtsFetcher:async()=>{calls++;throw Error();}});
 const response=await handler(new Request(origin+'/api/capabilities'));assert.ok(response);
 const caps=await response.json() as {runtime:string;tts:boolean;builtinTts:boolean};
 assert.equal(caps.runtime,'macos');assert.equal(caps.tts,true);assert.equal(caps.builtinTts,false);
 const result=await handler(post('/api/local-tts/speech',{url:'builtin'}));assert.equal(result?.status,503);assert.equal(calls,0);
});
test('Desktop login rejects cross-origin, credentials and payload before starting OAuth',async()=>{
 let calls=0;const handler=createDockerHandler({runtime:'macos',login:async()=>{calls++;return {authUrl:'https://auth.openai.com/oauth/authorize?state=fixture'};}});
 assert.equal((await handler(post('/api/local-agent/login',{}, {Origin:'https://untrusted.example'})))?.status,403);
 assert.equal((await handler(post('/api/local-agent/login',{}, {Authorization:'Bearer fixture'})))?.status,403);
 for(const body of [null,[],{type:'apiKey',key:'fixture'}])assert.equal((await handler(post('/api/local-agent/login',body)))?.status,400);
 assert.equal(calls,0);
 assert.equal((await handler(post('/api/local-agent/login')))?.status,200);assert.equal(calls,1);
});
test('Mac Full directs built-in speech only to its own fixed MLX process',async()=>{
 let address='';const handler=createDockerHandler({runtime:'macos',builtinTtsUrl:'http://127.0.0.1:49001/v1',builtinTtsFetcher:async input=>{address=String(input);return new Response(JSON.stringify({voices:['jf_alpha','af_heart']}));}});
 assert.equal((await handler(post('/api/local-tts/voices',{url:'builtin'})))?.status,200);assert.equal(address,'http://127.0.0.1:49001/v1/audio/voices');
});
