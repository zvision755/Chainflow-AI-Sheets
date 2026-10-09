import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { backup } from 'node:sqlite';
import { PersonalStore, RevisionConflict } from '../server/personal-store';
import { AdminAuth } from '../server/admin-auth';
import { createDockerHandler } from '../docker/http';
import { initialWorkspace, restoreWorkspace, serializeWorkspace } from '../core/workspace';
import { externalTtsConfig } from '../core/tts';
const connection={provider:'openai' as const,customUrl:''};
async function fixture(run:(store:PersonalStore,directory:string,key:Buffer)=>Promise<void>){const directory=await mkdtemp(join(tmpdir(),'chainflow-personal-'));const key=randomBytes(32);const store=new PersonalStore(join(directory,'personal.sqlite'),key);try{await run(store,directory,key);}finally{try{store.close();}catch{}await rm(directory,{recursive:true,force:true});}}
test('workspace migrates every sheet, history and workflow; CAS prevents two devices overwriting each other',()=>fixture(async store=>{
  const workspace=initialWorkspace();workspace.tables[0].sheet.rows[0].cells.input.value='Windows';workspace.tables[0].sheet.rows[0].cells.output.value='existing output';workspace.tables[0].sheet.rows[0].cells.output.history=['old','existing output'];
  const expected=serializeWorkspace(restoreWorkspace(serializeWorkspace(workspace),null,null));assert.equal(store.saveWorkspace(0,workspace),1);assert.equal(serializeWorkspace(restoreWorkspace(JSON.stringify(store.workspace().workspace),null,null)),expected);
  const iphone=structuredClone(store.workspace().workspace);iphone.tables[0].sheet.rows[0].cells.input.value='iPhone';assert.equal(store.saveWorkspace(1,iphone),2);
  assert.throws(()=>store.saveWorkspace(1,workspace),RevisionConflict);assert.equal(store.workspace().workspace.tables[0].sheet.rows[0].cells.input.value,'iPhone');
}));
test('keys are encrypted, never returned, purpose-bound, replaceable and removable; settings conflict is atomic',()=>fixture(async store=>{
  const secret='sk-fixture-secret-123';store.saveSettings({revision:0,connection,modelKey:secret,tts:externalTtsConfig,ttsKey:'tts-fixture-secret'});
  assert.equal(JSON.stringify(store.settings()).includes(secret),false);assert.equal(store.settings().modelKeyConfigured,true);assert.equal(store.upstreamKey('model',store.modelDestination(connection)),secret);
  const records=store.db.prepare('SELECT value FROM credentials').all();assert.equal(JSON.stringify(records).includes(secret),false);
  assert.throws(()=>store.upstreamKey('model','https://api.deepseek.com/chat/completions'));
  assert.throws(()=>store.saveSettings({revision:0,connection,modelKey:'replace-wrong-version'}),RevisionConflict);assert.equal(store.upstreamKey('model',store.modelDestination(connection)),secret);
  store.saveSettings({revision:1,modelKey:'new-fixture-key'});assert.equal(store.upstreamKey('model',store.modelDestination(connection)),'new-fixture-key');
  store.saveSettings({revision:2,connection:{provider:'deepseek',customUrl:''}});assert.equal(store.settings().modelKeyConfigured,false);
  store.saveSettings({revision:3,ttsKey:null});assert.equal(store.settings().ttsKeyConfigured,false);
}));
test('online SQLite backup plus master key restores workbook and keys; missing/wrong master fails closed',()=>fixture(async(store,directory,key)=>{
  store.saveWorkspace(0,initialWorkspace());store.saveSettings({revision:0,connection,modelKey:'backup-secret-fixture'});
  const dest=join(directory,'snapshot.sqlite');await backup(store.db,dest);const restored=new PersonalStore(dest,key);assert.equal(restored.workspace().revision,1);assert.equal(restored.upstreamKey('model',restored.modelDestination(connection)),'backup-secret-fixture');restored.close();
  assert.throws(()=>new PersonalStore(dest,randomBytes(32)),/does not match/);assert.throws(()=>new PersonalStore(dest,Buffer.alloc(0)),/32 bytes/);
  store.close();const reopened=new PersonalStore(join(directory,'personal.sqlite'),key);assert.equal(reopened.settings().modelKeyConfigured,true);assert.equal(reopened.workspace().revision,1);reopened.close();
  const bytes=await readFile(dest);assert.equal(bytes.includes(Buffer.from('backup-secret-fixture')),false);
}));
test('authenticated APIs share data and inject server-only keys; client destinations and keys cannot redirect secrets',()=>fixture(async(store,directory)=>{
  const auth=new AdminAuth(join(directory,'auth.json'));const setup=await auth.handle(new Request('http://local/api/auth/setup',{method:'POST',headers:{'content-type':'application/json','x-chainflow-auth':'1'},body:JSON.stringify({username:'owner',password:'a',secure:false})}));const cookie=setup!.headers.get('set-cookie')!.split(';')[0];const {csrf}=await setup!.json() as {csrf:string};
  const requests: {url:string;key:string}[]=[];
  const handler=createDockerHandler({auth,store,fetcher:(async(input,init)=>{requests.push({url:String(input),key:new Headers(init?.headers).get('authorization')??''});return new Response(JSON.stringify({data:[{id:'model-1'}]}),{headers:{'content-type':'application/json'}});}) as typeof fetch});
  const req=(path:string,body?:unknown,loggedIn=true)=>new Request('https://nas.example'+path,{method:body===undefined?'GET':'PUT',headers:{'content-type':'application/json',...(loggedIn?{cookie,'x-chainflow-csrf':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  for(const path of ['/api/workspace','/api/settings'])assert.equal((await handler(req(path,undefined,false)))!.status,401);
  assert.equal((await handler(req('/api/workspace',{revision:0,workspace:initialWorkspace()})))!.status,200);
  assert.equal((await handler(req('/api/settings',{revision:0,connection,modelKey:'server-key-fixture',tts:externalTtsConfig,ttsKey:'server-tts-fixture'})))!.status,200);
  const configured=await (await handler(req('/api/settings')))!.text();assert.equal(configured.includes('server-key-fixture'),false);assert.equal(configured.includes('server-tts-fixture'),false);
  const model=await handler(new Request('https://other-device.example/api/models',{method:'POST',headers:{cookie,'x-chainflow-csrf':csrf,'content-type':'application/json',authorization:'Bearer client-key'},body:JSON.stringify({provider:'custom',customUrl:'http://169.254.169.254/latest/meta-data/'})}));assert.equal(model!.status,200);assert.deepEqual(requests.pop(),{url:'https://api.openai.com/v1/models',key:'Bearer server-key-fixture'});
  const voices=await handler(new Request('https://phone.example/api/local-tts/voices',{method:'POST',headers:{cookie,'x-chainflow-csrf':csrf,'content-type':'application/json'},body:JSON.stringify({url:'http://169.254.169.254/'})}));assert.equal(voices!.status,200);assert.deepEqual(requests.pop(),{url:'https://api.openai.com/v1/models',key:'Bearer server-tts-fixture'});
}));
test('SSRF targets, URL credentials and arbitrary local TTS ports are rejected without changing settings',()=>fixture(async store=>{
  for(const url of ['http://169.254.169.254/v1','https://api.openai.com.evil.example/v1','https://user:pass@api.openai.com/v1'])assert.throws(()=>store.saveSettings({revision:0,connection:{provider:'custom',customUrl:url},modelKey:'never-forward'}));
  assert.throws(()=>store.saveSettings({revision:0,tts:{...externalTtsConfig,url:'http://127.0.0.1:9000/v1'}}));assert.equal(store.settings().revision,0);
}));
