import test from 'node:test';import assert from 'node:assert/strict';
import {BrowserSettingsStore} from '../model/browser-settings';import {BrowserWorkspaceStore} from '../model/browser-workspace';
import {CREDENTIAL_STORAGE,saveConnection,loadConnection} from '../model/credentials';
test('Web migrates remembered configuration to IndexedDB, then deletes legacy keys',async()=>{
 const legacy=new Map([[CREDENTIAL_STORAGE,JSON.stringify({provider:'openai',customUrl:'',remember:true,key:'fake-test-key'})]]);const saved:Record<string,string>={};
 const store={loadSettings:async()=>null,patchSettings:async(patch:Record<string,string|null>)=>{for(const [k,v]of Object.entries(patch))if(v!==null)saved[k]=v;else delete saved[k];}}as unknown as BrowserWorkspaceStore;
 const settings=new BrowserSettingsStore(store);await settings.load({getItem:k=>legacy.get(k)??null,removeItem:k=>{legacy.delete(k);}});assert.equal(loadConnection(settings).key,'fake-test-key');assert.equal(legacy.size,0);assert.ok(saved[CREDENTIAL_STORAGE]);
 saveConnection(settings,{provider:'deepseek',customUrl:''},'',false);await settings.flush();assert.ok(!JSON.stringify(saved).includes('fake-test-key'));
});
test('Web migration failure retains the legacy credential and does not claim success',async()=>{
 const legacy=new Map([[CREDENTIAL_STORAGE,'legacy-fake-key']]);const store={loadSettings:async()=>null,patchSettings:async()=>{throw Error('storage full');}}as unknown as BrowserWorkspaceStore;
 const settings=new BrowserSettingsStore(store);await assert.rejects(settings.load({getItem:k=>legacy.get(k)??null,removeItem:k=>{legacy.delete(k);}}),/storage full/);assert.equal(legacy.get(CREDENTIAL_STORAGE),'legacy-fake-key');
});
