import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, writeFile, rm, utimes, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileSpeechCache,speechCacheKey,validSpeechAudio,type SpeechIdentity} from '../server/tts-audio-cache';
import {createLocalTtsHandler} from '../build/local-tts-http';
import {createDockerHandler} from '../docker/http';
import {AdminAuth} from '../server/admin-auth';

function wav(){const data=Buffer.alloc(48);data.write('RIFF');data.writeUInt32LE(40,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(24000,24);data.writeUInt32LE(48000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(4,40);return data;}
function mp3(){const data=Buffer.alloc(417);data.set([255,251,144,0]);return data;}
const identity:SpeechIdentity={provider:'builtin',endpoint:'http://kokoro:8880/v1/audio/speech',model:'kokoro',voice:'jf_alpha',language:'ja',speed:1,input:'備える。',format:'wav',stream:false};
const audio=()=>new Response(new Uint8Array(wav()),{headers:{'content-type':'audio/wav'}});
const base='http://localhost:3003';
const input={url:'builtin',model:'kokoro',input:identity.input,voice:'jf_alpha',language:'ja',speed:1};
function request(payload=input,signal?:AbortSignal,extra:Record<string,string>={}){return new Request(base+'/api/local-tts/speech',{method:'POST',headers:{origin:base,'content-type':'application/json',...extra},body:JSON.stringify(payload),signal});}
async function fixture(fn:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'chainflow-tts-cache-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}

test('Server TTS cache covers Kokoro, VolcEngine and external API; survives new instances and excludes keys/text from disk metadata',async()=>fixture(async root=>{
  for(const provider of ['builtin','volcengine','external']){
    let calls=0;const directory=join(root,provider),events:string[]=[];
    const fetcher:typeof fetch=async()=>{calls++;return provider==='volcengine'?Response.json({audio:{data:mp3().toString('base64')}}):audio();};
    const cache=new FileSpeechCache(directory,(event)=>events.push(event));
    const handler=createLocalTtsHandler(fetcher,1000,{url:'http://kokoro:8880/v1',fetcher},false,cache);
    const payload=provider==='builtin'?input:provider==='volcengine'?{...input,url:'volcengine-free',model:'volcengine-tts',voice:'jp_male_satoshi'}:{...input,url:'https://api.aihubmix.com/v1',model:'tts-1',voice:'alloy'};
    const headers:Record<string,string>=provider==='external'?{Authorization:'Bearer secret-never-persist'}:{};
    const first=await handler(request(payload,undefined,headers),'speech');assert.equal(first.status,200);assert.equal(first.headers.get('x-chainflow-tts-cache'),'MISS');
    const bytes=Buffer.from(await first.arrayBuffer());
    assert.equal((await handler(request(payload,undefined,headers),'speech')).headers.get('x-chainflow-tts-cache'),'HIT');assert.equal(calls,1);
    const restarted=createLocalTtsHandler(fetcher,1000,{url:'http://kokoro:8880/v1',fetcher},false,new FileSpeechCache(directory));
    const response=await restarted(request(payload,undefined,headers),'speech');assert.equal(response.headers.get('x-chainflow-tts-cache'),'HIT');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(calls,1);
    const shard=(await readdir(directory))[0],files=await readdir(join(directory,shard));assert.equal(files.length,2);assert.ok(files.every(file=>/^[a-f0-9]{64}\.(audio|json)$/.test(file)));
    const metadata=await readFile(join(directory,shard,files.find(file=>file.endsWith('.json'))!),'utf8');assert.ok(!metadata.includes(payload.input));assert.ok(!metadata.includes('secret-never-persist'));assert.deepEqual(events,['miss','stored','hit']);
  }
}));

test('cache hashes exact effective text and all synthesis settings, without cell IDs or key aliases',async()=>fixture(async root=>{
  const cache=new FileSpeechCache(root);let calls=0;const produce=async()=>{calls++;return audio();};
  const variants:SpeechIdentity[]=[identity,...Object.entries({provider:'external',endpoint:'https://api.openai.com/v1/audio/speech',model:'tts-2',voice:'jm_kumo',language:'zh',speed:1.1,input:'備える！',format:'mp3',stream:true}).map(([key,value])=>({...identity,[key]:value}))];
  assert.equal(new Set(variants.map(speechCacheKey)).size,variants.length);
  for(const value of variants){assert.equal((await cache.getOrCreate(value,new AbortController().signal,produce)).headers.get('x-chainflow-tts-cache'),'MISS');assert.equal((await cache.getOrCreate({...value},new AbortController().signal,produce)).headers.get('x-chainflow-tts-cache'),'HIT');}
  assert.equal(calls,variants.length);
  for(const text of ['word','Word','word ','word  x','word x','カナ','かな','備える','備える。'])assert.notEqual(speechCacheKey({...identity,input:text}),speechCacheKey({...identity,input:text+'!'}));
  let upstream=0;const fetcher:typeof fetch=async()=>{upstream++;return audio();};const handler=createLocalTtsHandler(fetcher,1000,{url:'http://kokoro:8880/v1',fetcher},false,new FileSpeechCache(join(root,'effective')));
  assert.equal((await handler(request({...input,input:'  備える。  '}),'speech')).headers.get('x-chainflow-tts-cache'),'MISS');
  assert.equal((await handler(request(input),'speech')).headers.get('x-chainflow-tts-cache'),'HIT');assert.equal(upstream,1);
}));

test('concurrent requests coalesce one synthesis; cancellation of one device retains other waiters',async()=>fixture(async root=>{
  const cache=new FileSpeechCache(root);let calls=0;let release!:(response:Response)=>void;let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
  const produce=async(signal:AbortSignal)=>{calls++;started();return new Promise<Response>((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});};
  const firstSignal=new AbortController();const first=cache.getOrCreate(identity,firstSignal.signal,produce);const rejected=assert.rejects(first,{name:'AbortError'});
  const others=Array.from({length:7},()=>cache.getOrCreate(identity,new AbortController().signal,produce));await ready;firstSignal.abort();release(audio());await rejected;
  for(const result of await Promise.all(others)){assert.equal(result.status,200);assert.equal(result.headers.get('x-chainflow-tts-cache'),'SHARED');assert.equal((await result.arrayBuffer()).byteLength,48);}assert.equal(calls,1);
  assert.equal((await cache.getOrCreate(identity,new AbortController().signal,produce)).headers.get('x-chainflow-tts-cache'),'HIT');
}));

test('HTTP speech requests join before the existing engine busy guard and cached speech works while another text synthesizes',async()=>fixture(async root=>{
  let calls=0,release!:()=>void,started!:()=>void;let ready=new Promise<void>(resolve=>started=resolve);
  const fetcher:typeof fetch=async()=>{calls++;started();await new Promise<void>(resolve=>release=resolve);return audio();};
  const handler=createLocalTtsHandler(fetcher,1000,{url:'http://kokoro:8880/v1',fetcher},false,new FileSpeechCache(root));
  const requests=Array.from({length:5},()=>handler(request(),'speech'));await ready;release();
  const responses=await Promise.all(requests);assert.equal(calls,1);assert.equal(responses[0].headers.get('x-chainflow-tts-cache'),'MISS');for(const response of responses.slice(1))assert.equal(response.headers.get('x-chainflow-tts-cache'),'SHARED');
  ready=new Promise<void>(resolve=>started=resolve);const other=handler(request({...input,input:'新しい文章。'}),'speech');await ready;
  assert.equal((await handler(request(),'speech')).headers.get('x-chainflow-tts-cache'),'HIT');assert.equal(calls,2);release();assert.equal((await other).status,200);
}));

test('failed, empty, truncated audio and cancelled synthesis never commit valid files',async()=>fixture(async root=>{
  const cache=new FileSpeechCache(root);
  const failures=[()=>Response.json({error:{message:'upstream failed'}},{status:502}),()=>new Response(new Uint8Array(),{headers:{'content-type':'audio/wav'}}),()=>new Response(wav().subarray(0,46),{headers:{'content-type':'audio/wav'}}),()=>new Response(mp3().subarray(0,100),{headers:{'content-type':'audio/mpeg'}})];
  for(const produce of failures){const response=await cache.getOrCreate(identity,new AbortController().signal,async()=>produce());assert.equal(response.status,502);assert.equal(response.headers.get('x-chainflow-tts-cache'),null);}
  assert.deepEqual(await readdir(root),[]);
  const controller=new AbortController();let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
  const waiting=cache.getOrCreate(identity,controller.signal,async signal=>{started();return new Promise<Response>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});const rejected=assert.rejects(waiting,{name:'AbortError'});await ready;controller.abort();await rejected;
  await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(await readdir(root),[]);
  assert.equal((await cache.getOrCreate(identity,new AbortController().signal,async()=>audio())).status,200);
}));

test('corrupted audio, invalid metadata and orphan audio are misses, and regenerate atomically',async()=>fixture(async root=>{
  let calls=0;const cache=new FileSpeechCache(root);const produce=async()=>{calls++;return audio();};const key=speechCacheKey(identity),directory=join(root,key.slice(0,2));
  await cache.getOrCreate(identity,new AbortController().signal,produce);
  await writeFile(join(directory,key+'.audio'),wav().fill(5,44));
  assert.equal((await cache.getOrCreate(identity,new AbortController().signal,produce)).headers.get('x-chainflow-tts-cache'),'MISS');
  await writeFile(join(directory,key+'.json'),'{broken');await cache.getOrCreate(identity,new AbortController().signal,produce);
  await rm(join(directory,key+'.json'));await writeFile(join(directory,key+'.audio.tmp'),'partial');await cache.getOrCreate(identity,new AbortController().signal,produce);assert.equal(calls,4);
  assert.equal((await cache.getOrCreate(identity,new AbortController().signal,produce)).headers.get('x-chainflow-tts-cache'),'HIT');
  assert.equal((await readdir(directory)).filter(file=>file.endsWith('.tmp')).length,1); // our simulated old orphan is never used
}));

test('cache applies a hard audio-size limit and evicts the oldest committed entry, including on restart',async()=>fixture(async root=>{
  let calls=0;const produce=async()=>{calls++;return audio();};const original=new FileSpeechCache(root);
  const older={...identity,input:'最初の音声。'},newer={...identity,input:'最近の音声。'};
  await original.getOrCreate(older,new AbortController().signal,produce);
  const olderKey=speechCacheKey(older),olderMeta=join(root,olderKey.slice(0,2),olderKey+'.json');
  await utimes(olderMeta,new Date(0),new Date(0));
  await original.getOrCreate(newer,new AbortController().signal,produce);
  assert.equal((await readdir(root)).length,2);

  const events:string[]=[];const bounded=new FileSpeechCache(root,event=>events.push(event),200);
  assert.equal((await bounded.getOrCreate(newer,new AbortController().signal,produce)).headers.get('x-chainflow-tts-cache'),'HIT');
  assert.equal((await bounded.getOrCreate(older,new AbortController().signal,produce)).headers.get('x-chainflow-tts-cache'),'MISS');
  assert.equal(calls,3);assert.ok(events.some(event=>event==='evicted'));
  let cacheBytes=0;
  for(const shard of await readdir(root))for(const file of await readdir(join(root,shard)))if(file.endsWith('.audio')||file.endsWith('.json'))cacheBytes+=(await stat(join(root,shard,file))).size;
  assert.ok(cacheBytes<=200,`cache files ${cacheBytes} exceed 200-byte cap`);
}));

test('disk write failure preserves normal playback and records a sanitized bypass',async()=>fixture(async root=>{
  const file=join(root,'not-a-directory');await writeFile(file,'');const events:string[]=[];const cache=new FileSpeechCache(file,(event)=>events.push(event));
  const response=await cache.getOrCreate(identity,new AbortController().signal,async()=>audio());assert.equal(response.status,200);assert.equal(response.headers.get('x-chainflow-tts-cache'),'BYPASS');assert.ok(events.includes('write-error'));
}));

test('cache hits remain behind server authentication, JSON/URL/voice validation and paid-provider credentials',async()=>fixture(async root=>{
  let cacheCalls=0;const handler=createDockerHandler({auth:new AdminAuth(join(root,'auth.json')),speechCache:{getOrCreate:async()=>{cacheCalls++;return audio();}}});
  assert.equal((await handler(request()))?.status,401);assert.equal(cacheCalls,0);
  const cache=new FileSpeechCache(join(root,'audio'));const tts=createLocalTtsHandler(async()=>audio(),1000,{url:'http://kokoro:8880/v1',fetcher:async()=>audio()},false,cache);
  await tts(request(),'speech');
  assert.equal((await tts(new Request(request(),{headers:{origin:'https://evil.example','content-type':'application/json'}}),'speech')).status,403);
  assert.equal((await tts(request({...input,url:'http://169.254.169.254/'}),'speech')).status,400);
  assert.equal((await tts(request({...input,url:'https://api.openai.com/v1',model:'tts-1',voice:'alloy'}),'speech')).status,401);
}));

test('audio validator supports real WAV chunks and MP3 ID3 tags, rejects fake headers and broken sizes',()=>{
  assert.equal(validSpeechAudio(wav(),'audio/wav'),true);assert.equal(validSpeechAudio(mp3(),'audio/mpeg'),true);
  const tagged=Buffer.concat([Buffer.from([73,68,51,4,0,0,0,0,0,0]),mp3()]);assert.equal(validSpeechAudio(tagged,'audio/mpeg'),true);
  const bad=wav();bad.writeUInt32LE(500,40);assert.equal(validSpeechAudio(bad,'audio/wav'),false);assert.equal(validSpeechAudio(Buffer.from('ID3'+'x'.repeat(100)),'audio/mpeg'),false);
});
