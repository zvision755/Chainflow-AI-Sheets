import test from 'node:test';
import assert from 'node:assert/strict';
import {createDockerHandler} from '../docker/http';
import {BrowserWorkspaceSync,BrowserWorkspaceStore} from '../model/browser-workspace';
import {initialWorkspace} from '../core/workspace';
import {browserTtsConfig,validateTtsConfig} from '../core/tts';
import {localBackup,localBackupSettings} from '../core/local-backup';

test('Local Docker has no auth, storage or Codex and rejects private storage routes',async()=>{
  const handler=createDockerHandler({builtinTts:false});
  assert.deepEqual(await (await handler(new Request('http://localhost:3004/api/auth/status')))?.json(),{enabled:false});
  const caps=await (await handler(new Request('http://localhost:3004/api/capabilities')))?.json() as {storage:boolean;codex:boolean;builtinTts:boolean};
  assert.equal(caps.storage,false);assert.equal(caps.codex,false);assert.equal(caps.builtinTts,false);
  for(const path of ['/api/workspace','/api/settings','/api/local-agent/generate']){
    const response=await handler(new Request('http://localhost:3004'+path,{method:'POST',headers:{origin:'http://localhost:3004','content-type':'application/json'},body:'{}'}));assert.notEqual(response?.status,200);
  }
  assert.equal((await handler(new Request('http://evil.example/api/capabilities')))?.status,403);
});
test('Local persistence waits for a successful write and retains unsaved data on failure',async()=>{
  const sheet=initialWorkspace(),states:boolean[]=[],messages:string[]=[];let written=0;
  const store={save:async()=>{written++;if(written===2)throw Error('storage full');return written;}} as unknown as BrowserWorkspaceStore;
  const sync=new BrowserWorkspaceSync(store,0,sheet,(saved,message)=>{states.push(saved);if(message)messages.push(message);});
  sheet.tables[0].sheet.name='first';sync.enqueue(sheet);await sync.flush();assert.equal(states.at(-1),true);
  sheet.tables[0].sheet.name='second';sync.enqueue(sheet);await sync.flush().catch(()=>{});assert.equal(states.at(-1),false);assert.equal(messages.at(-1),'storage full');
  sheet.tables[0].sheet.name='third';sync.enqueue(sheet);await sync.flush();assert.equal(written,2);sync.dispose();
});
test('browser TTS validates only public nonsecret settings',()=>{
  const config=validateTtsConfig({...browserTtsConfig,apiKey:'should-not-export'});assert.deepEqual(config,browserTtsConfig);assert.throws(()=>validateTtsConfig({...browserTtsConfig,speed:99}));
});
test('Local backup is interoperable and removes keys from model and TTS settings',()=>{
 const text=localBackup(initialWorkspace(),{provider:'deepseek',customUrl:'',key:'private-key'} as never,{...browserTtsConfig,apiKey:'private-tts'} as never);
 assert.ok(!text.includes('private-key'));assert.ok(!text.includes('private-tts'));const settings=localBackupSettings(JSON.parse(text));assert.equal(settings?.connection.provider,'deepseek');assert.deepEqual(settings?.tts,browserTtsConfig);
});
