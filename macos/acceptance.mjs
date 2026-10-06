// Developer-only integration test against a complete, relocated Full app.
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const resources=resolve(process.argv[2],'Contents/Resources');
const profile=mkdtempSync(join(tmpdir(),'ChainFlow-QA-'));
let child,origin;
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
async function post(path,body){return fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(100000)});}
async function inspect(){const r=await post('/api/local-tts/runtime',{action:'inspect'});assert.equal(r.status,200);return r.json();}
async function start(){
 const listener=createServer();await new Promise(ok=>listener.listen(0,'127.0.0.1',ok));const port=listener.address().port;await new Promise(ok=>listener.close(ok));origin=`http://127.0.0.1:${port}`;
 child=spawn(join(resources,'node-arm64'),['dist-docker/desktop.mjs'],{cwd:resources,stdio:'ignore',env:{HOME:process.env.HOME,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',NODE_ENV:'production',PORT:String(port),CHAINFLOW_DESKTOP_STATE:profile,CHAINFLOW_PARENT_PID:String(process.pid),CHAINFLOW_CODEX_BIN:join(resources,'codex-arm64'),CHAINFLOW_BUNDLED_KOKORO:'1'}});
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Server exited');try{if((await fetch(origin+'/healthz')).ok)return;}catch{}await delay(100);}throw Error('Server timeout');
}
async function stop(){if(!child)return;const p=child;child=undefined;p.kill('SIGTERM');await Promise.race([new Promise(ok=>p.once('exit',ok)),delay(5000).then(()=>{p.kill('SIGKILL');})]);}
async function load(remember){const r=await post('/api/local-tts/runtime',{action:'load',autoLoad:remember,acceptedMemoryWarning:true});assert.equal(r.status,200);const data=await r.json();assert.equal(data.loaded,true);assert.equal(data.autoLoad,remember);}
async function unload(){const r=await post('/api/local-tts/runtime',{action:'unload'});assert.equal(r.status,200);const data=await r.json();assert.equal(data.loaded,false);assert.equal(data.autoLoad,false);}
try{
 await start();assert.deepEqual(await inspect(),{state:'idle',loaded:false,autoLoad:false,memoryMiB:900});
 assert.equal((await post('/api/local-tts/runtime',{action:'load',autoLoad:true})).status,400);
 await load(false);
 for(const [language,voice,input]of [['ja','jf_alpha','写真をフレームに入れました。'],['en','af_heart','I put the photo in a frame.'],['zh','zf_xiaobei','这是一段中文朗读测试。']]){
  const r=await post('/api/local-tts/speech',{url:'builtin',model:'kokoro',language,voice,input,speed:1});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const b=Buffer.from(await r.arrayBuffer());assert.equal(b.toString('ascii',8,12),'WAVE');assert.ok(b.length>10000);console.log('speech',language,b.length);
 }
 await unload();await stop();await start();assert.equal((await inspect()).loaded,false);assert.equal((await inspect()).autoLoad,false);
 await load(true);await stop();await start();
 let state;for(let i=0;i<160;i++){state=await inspect();if(state.loaded)break;await delay(300);}assert.equal(state.loaded,true);assert.equal(state.autoLoad,true);
 await unload();await stop();await start();assert.equal((await inspect()).loaded,false);assert.equal((await inspect()).autoLoad,false);
 console.log('PASS: default idle; acknowledgement required; ja/en/zh speech; unload; restart without consent; explicit remembered auto-load; cancel auto-load.');
}finally{await stop();rmSync(profile,{recursive:true,force:true});}
