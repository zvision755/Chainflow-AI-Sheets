import {BrowserWorkspaceStore} from './browser-workspace';
import {CREDENTIAL_STORAGE} from './credentials';
import {TTS_STORAGE} from '../core/tts';
const keys=[CREDENTIAL_STORAGE,TTS_STORAGE,'chainflow-local-tts-key-v1'];
/** Small synchronous UI cache; IndexedDB is the only durable Web settings store. */
export class BrowserSettingsStore {
  private cache:Record<string,string>={};private pending:Record<string,string|null>={};private running:Promise<void>|null=null;
  constructor(private store:BrowserWorkspaceStore){}
  async load(legacy?:Pick<Storage,'getItem'|'removeItem'>){
    const saved=await this.store.loadSettings();
    if(saved){for(const key of keys)if(typeof saved[key]==='string')this.cache[key]=saved[key];}
    else if(legacy){for(const key of keys){const value=legacy.getItem(key);if(value!==null)this.setItem(key,value);}await this.flush();}
    // Remove legacy keys only after the IndexedDB copy has been confirmed.
    if(legacy)for(const key of keys)legacy.removeItem(key);
  }
  getItem(key:string){return this.cache[key]??null;}
  setItem(key:string,value:string){if(!keys.includes(key))throw Error('未知浏览器配置');this.cache[key]=value;this.pending[key]=value;}
  removeItem(key:string){if(!keys.includes(key))throw Error('未知浏览器配置');delete this.cache[key];this.pending[key]=null;}
  isPending(){return !!this.running||Object.keys(this.pending).length>0;}
  flush(){if(this.running)return this.running;this.running=this.drain().finally(()=>{this.running=null;});return this.running;}
  private async drain(){while(Object.keys(this.pending).length){const patch=this.pending;this.pending={};try{await this.store.patchSettings(patch);}catch(error){this.pending={...patch,...this.pending};throw error;}}}
}
