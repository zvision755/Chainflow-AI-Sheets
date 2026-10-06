import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalTtsHandler } from '../build/local-tts-http';
import { defaultTtsConfig, readTtsConfig, ttsBaseUrl, validateTtsConfig, externalTtsConfig, externalTtsUrl } from '../core/tts';
import { parseSheet, serialize } from '../core/storage';
import { savedExample } from '../core/example-workflow';
import { Scheduler } from '../core/scheduler';
import { SpeechPlayer } from '../model/tts';
import { GET as capabilities } from '../app/api/capabilities/route';
const base = 'http://127.0.0.1:3002';
const payload = { url: defaultTtsConfig.url, model: 'kokoro', input: 'フレーム', language: 'ja', voice: 'jf_alpha', speed: 1 };
const request = (body: unknown = payload, origin = base, headers = {}) => new Request(base + '/api/local-tts/speech', { method: 'POST', headers: { origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
function wav() { const bytes = new Uint8Array(44); bytes.set(new TextEncoder().encode('RIFF'),0); bytes.set(new TextEncoder().encode('WAVE'),8); return bytes; }
test('TTS targets normalize only local speech endpoints and reject redirects/remote credentials', () => {
  assert.equal(ttsBaseUrl('http://localhost:8880/v1/audio/speech'), 'http://127.0.0.1:8880/v1');
  assert.equal(ttsBaseUrl('http://[::1]:8880'), 'http://[::1]:8880/v1');
  for (const url of ['https://evil.example/v1', 'http://192.168.0.1:8880/v1', 'http://127.0.0.1:8880/admin', 'file:///tmp/key', 'http://key:secret@127.0.0.1:8880/v1', 'http://127.0.0.1:8880/v1?url=x', 'http://127.0.0.1:22/v1', 'http://127.0.0.1:8880/v1#key']) assert.throws(() => ttsBaseUrl(url));
  assert.throws(() => validateTtsConfig({ ...defaultTtsConfig, voices: { ...defaultTtsConfig.voices, ja: 'af_heart' } }));
  assert.deepEqual(readTtsConfig('{broken'), defaultTtsConfig);
});
test('TTS settings export language only; old sheets import with speech disabled; metadata does not invalidate results', () => {
  const sheet = savedExample(); const source = JSON.parse(serialize(sheet));
  assert.equal(source.columns[0].ttsLanguage, 'ja'); assert.equal(source.columns[1].ttsLanguage, 'ja');
  assert.equal(source.columns[2].ttsLanguage, 'off');
  source.columns.forEach((c: any) => delete c.ttsLanguage);
  assert.ok(parseSheet(source).columns.every(c => c.ttsLanguage === 'off'));
  const engine = new Scheduler(sheet, async () => { throw Error('TTS must not call an LLM'); });
  const before = structuredClone(sheet.rows.map(row => row.cells));
  engine.configure({ ...sheet.columns[1], ttsLanguage: 'en' });
  assert.equal(engine.running, 0); assert.equal(engine.queued, 0);
  assert.ok(sheet.rows.every(row => row.cells.explain.status === 'done'));
  assert.deepEqual(sheet.rows.map(row => row.cells), before);
  assert.equal(parseSheet(JSON.parse(serialize(sheet))).columns[1].ttsLanguage, 'en');
});
test('TTS origin, input, key and language guards run before the upstream request', async () => {
  let calls = 0; const handler = createLocalTtsHandler((async () => { calls++; return new Response(wav()); }) as typeof fetch);
  for (const [req,status] of [[request(payload,'https://evil.example'),403],[request({...payload,input:'x'.repeat(4097)}),400],[request({...payload,voice:'af_heart'}),400],[request({...payload,secret:'hidden'}),400],[request(payload,base,{Authorization:'Bearer hidden'}),400],[request({...payload,url:'http://169.254.169.254/v1'}),400]] as const) assert.equal((await handler(req,'speech')).status,status);
  assert.equal(calls,0);
});
test('TTS sends language-specific speech once and returns uncached binary bytes', async () => {
  let destination = '', sent: any;
  const handler = createLocalTtsHandler((async (url, init) => { destination=String(url);sent=init;return new Response(wav(),{headers:{'Content-Type':'audio/wav'}}); }) as typeof fetch);
  const r=await handler(request(),'speech');
  assert.equal(destination,'http://127.0.0.1:8881/v1/audio/speech');assert.equal(sent.redirect,'error');assert.equal(sent.cache,'no-store');assert.equal(sent.headers.Authorization,undefined);
  assert.deepEqual(JSON.parse(sent.body),{model:'kokoro',input:'フレーム',voice:'jf_alpha',language:'ja',speed:1,response_format:'wav',stream:false});
  assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Content-Type'),'audio/wav');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),wav());
});
test('voice discovery is bounded and does not synthesize speech or return unexpected provider fields', async () => {
  let method='';const handler=createLocalTtsHandler((async (_url,init)=>{method=init?.method??'';return Response.json({voices:['jf_alpha','af_heart','invalid'],secret:'do-not-echo'});}) as typeof fetch);
  const r=await handler(request({url:defaultTtsConfig.url}),'voices');assert.equal(method,'GET');assert.deepEqual(await r.json(),{voices:['jf_alpha','af_heart']});
});
test('TTS malformed/oversized audio and provider errors are finite sanitized failures', async () => {
  for(const upstream of [new Response('not audio'),new Response(wav(),{headers:{'Content-Length':String(33*1024*1024)}}),Response.json({error:'private diagnostics'},{status:500})]){
    const handler=createLocalTtsHandler((async()=>upstream) as typeof fetch);const r=await handler(request(),'speech');assert.equal(r.status,502);assert.ok(!(await r.text()).includes('private diagnostics'));
  }
});
test('TTS enforces one in-flight request and releases the slot after cancel or timeout', async () => {
  let entered!:()=>void;const started=new Promise<void>(r=>entered=r);
  const handler=createLocalTtsHandler((async(_url,init)=>new Promise((_resolve,reject)=>{entered();init?.signal?.addEventListener('abort',()=>reject(Error('abort')),{once:true});})) as typeof fetch,25);
  const run=handler(request(),'speech');await started;assert.equal((await handler(request(),'speech')).status,429);assert.equal((await run).status,504);
  assert.equal((await handler(request(),'speech')).status,504);
  const stopped=new AbortController();stopped.abort();const raw=request();const req=new Request(raw,{signal:stopped.signal});assert.equal((await handler(req,'speech')).status,499);
});
function playerSetup(synthesize?: NonNullable<ConstructorParameters<typeof SpeechPlayer>[0]>['synthesize']) {
  const revoked:string[]=[], audios:any[]=[];let created=0,calls=0;
  const player=new SpeechPlayer({synthesize:synthesize??(async()=>{calls++;return new Blob([wav()]);}),audio:()=>{const audio={src:'',onended:null,onerror:null,paused:false,play:async()=>{},pause(){this.paused=true;},removeAttribute(){this.src='';},load(){}};audios.push(audio);return audio;},createUrl:()=>`blob:test-${++created}`,revokeUrl:url=>revoked.push(url),timeout:25});
  return {player,revoked,audios,get created(){return created;},get calls(){return calls;}};
}
test('player holds one transient URL, releases it on end/stop, and synthesizes again on each click', async () => {
  const s=playerSetup();await s.player.speak('A','フレーム','ja',defaultTtsConfig);assert.equal(s.player.snapshot().phase,'playing');s.audios[0].onended();assert.equal(s.player.snapshot().phase,'idle');assert.deepEqual(s.revoked,['blob:test-1']);
  await s.player.speak('A','フレーム','ja',defaultTtsConfig);s.player.stop();assert.equal(s.calls,2);assert.deepEqual(s.revoked,['blob:test-1','blob:test-2']);assert.ok(s.audios.every(a=>a.paused&&a.src===''));
});
test('late speech cannot start after cancel, changing cells or changing the text', async () => {
  let release!:(blob:Blob)=>void;const s=playerSetup(async()=>new Promise(r=>release=r));
  const run=s.player.speak('A','old','ja',defaultTtsConfig);s.player.cancelIfChanged('A','new','ja');release(new Blob([wav()]));await run;assert.equal(s.created,0);assert.equal(s.player.snapshot().phase,'idle');
  let calls=0,finish!:(blob:Blob)=>void;const t=playerSetup(async()=>++calls===1?new Promise(r=>finish=r):new Blob([wav()]));
  const old=t.player.speak('A','old','ja',defaultTtsConfig);await t.player.speak('D','English','en',defaultTtsConfig);finish(new Blob([wav()]));await old;assert.equal(t.created,1);assert.equal(t.player.snapshot().key,'D');t.player.stop();
});
test('player timeout and playback error reset to actionable error without retaining audio',async()=>{
  const s=playerSetup(async()=>new Promise(()=>{}));await s.player.speak('A','text','ja',defaultTtsConfig);assert.equal(s.player.snapshot().phase,'error');assert.match(s.player.snapshot().message!,/超时/);assert.equal(s.created,0);
  const t=playerSetup();await t.player.speak('A','text','ja',defaultTtsConfig);t.audios[0].onerror();assert.equal(t.player.snapshot().phase,'error');assert.equal(t.revoked.length,1);
});
test('autoplay restriction offers user-triggered playback without a second synthesis',async()=>{
  let calls=0,plays=0;const player=new SpeechPlayer({synthesize:async()=>{calls++;return new Blob([wav()]);},audio:()=>({src:'',onended:null,onerror:null,play:async()=>{if(++plays===1)throw Object.assign(Error('blocked'),{name:'NotAllowedError'});},pause(){},removeAttribute(){},load(){}}),createUrl:()=> 'blob:test',revokeUrl(){}});
  await player.speak('A','text','ja',defaultTtsConfig);assert.equal(player.snapshot().phase,'ready');await player.resume();assert.equal(player.snapshot().phase,'playing');assert.equal(calls,1);player.stop();
});
test('production explicitly disables local TTS',async()=>{assert.equal((await capabilities().json() as any).tts,false);});

test('bundled defaults migrate the old host model without saving credentials or changing voices',()=>{
  const old={...defaultTtsConfig,provider:undefined,url:'http://127.0.0.1:8880/v1',apiKey:'private-key'};
  assert.deepEqual(readTtsConfig(JSON.stringify(old)),defaultTtsConfig);
  assert.equal(validateTtsConfig({...externalTtsConfig,apiKey:'private-key'}).url,'https://api.openai.com/v1');
  assert.equal(JSON.stringify(validateTtsConfig({...externalTtsConfig,apiKey:'private-key'})).includes('private-key'),false);
  assert.equal(readTtsConfig(JSON.stringify({...old,url:'http://127.0.0.1:9000/v1'})).provider,'external');
  for(const url of ['https://evil.example/v1','http://api.openai.com/v1','https://api.openai.com:444/v1','https://key:password@api.openai.com/v1','https://api.openai.com/v1?key=secret','http://192.168.0.1/v1'])assert.throws(()=>externalTtsUrl(url));
});
test('third-party speech forwards an explicit session key once with no language extension or key in body',async()=>{
  let sent:any,url='';const handler=createLocalTtsHandler((async(u,i)=>{url=String(u);sent=i;return new Response(wav());}) as typeof fetch);
  const response=await handler(request({...payload,url:'https://api.openai.com/v1/audio/speech',model:'gpt-4o-mini-tts',voice:'alloy'},base,{Authorization:'Bearer tts-session-key'}),'speech');
  assert.equal(response.status,200);assert.equal(url,'https://api.openai.com/v1/audio/speech');assert.equal(sent.headers.Authorization,'Bearer tts-session-key');
  assert.equal(JSON.parse(sent.body).language,undefined);assert.equal(sent.body.includes('tts-session-key'),false);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('external connection tests validate account without synthesis and sanitize auth failure',async()=>{
  let calls=0,url='';const handler=createLocalTtsHandler((async(u)=>{calls++;url=String(u);return Response.json({data:[{id:'tts-1'}],private:'never echo'});}) as typeof fetch);
  assert.equal((await handler(request({url:'https://api.openai.com/v1'}),'voices')).status,401);assert.equal(calls,0);
  const response=await handler(request({url:'https://api.openai.com/v1'},base,{Authorization:'Bearer tts-key'}),'voices');assert.equal(url,'https://api.openai.com/v1/models');assert.deepEqual(await response.json(),{voices:[]});
  const bad=createLocalTtsHandler((async()=>Response.json({error:'provider private key diagnostics'},{status:401})) as typeof fetch);
  const failed=await bad(request({...payload,url:'https://api.openai.com/v1',voice:'alloy'},base,{Authorization:'Bearer private-key'}),'speech');assert.equal(failed.status,502);assert.equal((await failed.text()).includes('private'),false);
});
