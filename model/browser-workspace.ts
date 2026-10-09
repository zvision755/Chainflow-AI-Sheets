import {serializeWorkspace,restoreWorkspace,type Workspace} from '../core/workspace';
export type BrowserDocument={revision:number;workspace:Workspace};
/** IndexedDB is authoritative in Web. Revision checks protect simultaneous tabs. */
export class BrowserWorkspaceStore {
  private db?:Promise<IDBDatabase>;
  constructor(private factory:IDBFactory|undefined=undefined,private name='chainflow-local-v1'){}
  private open(){
    return this.db??=new Promise<IDBDatabase>((resolve,reject)=>{
      const factory=this.factory??globalThis.indexedDB;
      if(!factory){reject(Error('此浏览器无法使用 IndexedDB，请允许站点存储'));return;}
      const request=factory.open(this.name,1);
      request.onupgradeneeded=()=>request.result.createObjectStore('documents');
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.db=undefined;};resolve(db);};
      request.onerror=()=>reject(Error('无法打开浏览器数据库，请检查站点存储权限'));
      request.onblocked=()=>reject(Error('浏览器数据库被另一标签页占用，请关闭旧标签页后重试'));
    });
  }
  async load():Promise<BrowserDocument|null>{const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('documents','readonly'),request=tx.objectStore('documents').get('workspace');tx.oncomplete=()=>{try{const result=request.result as {revision:number;workspace:unknown}|undefined;resolve(result?{revision:result.revision,workspace:restoreWorkspace(JSON.stringify(result.workspace),null,null)}:null);}catch{reject(Error('浏览器工作簿无法读取，原数据保留，请先备份'));}};tx.onabort=()=>reject(Error('读取浏览器工作簿失败'));});}
  async save(workspace:Workspace,expectedRevision:number):Promise<number>{
    const snapshot=JSON.parse(serializeWorkspace(workspace));const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents'),request=store.get('workspace');let conflict=false;
      request.onsuccess=()=>{if((request.result?.revision??0)!==expectedRevision){conflict=true;tx.abort();return;}store.put({revision:expectedRevision+1,workspace:snapshot},'workspace');};
      tx.oncomplete=()=>resolve(expectedRevision+1);
      tx.onabort=()=>reject(Error(conflict?'另一标签页已有更新，请先导出当前副本再刷新；未覆盖已有数据':'浏览器保存失败，修改未保存，请导出 JSON 备份并检查存储空间'));
    });
  }
  async close(){if(this.db)(await this.db).close();this.db=undefined;}
  async loadSettings():Promise<Record<string,string>|null>{const db=await this.open();return new Promise((resolve,reject)=>{const tx=db.transaction('documents','readonly'),request=tx.objectStore('documents').get('settings');tx.oncomplete=()=>resolve(request.result??null);tx.onabort=()=>reject(Error('读取浏览器配置失败'));});}
  async patchSettings(patch:Record<string,string|null>){const db=await this.open();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents'),request=store.get('settings');request.onsuccess=()=>{const next={...(request.result??{})};for(const [key,value]of Object.entries(patch)){if(value===null)delete next[key];else next[key]=value;}store.put(next,'settings');};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(Error('浏览器配置保存失败，请检查存储权限和空间；当前配置仍在页面内存中'));});}
}
/** Serialize saves; only completed transactions are reported as saved. */
export class BrowserWorkspaceSync {
  private pending:string|null=null;private running:Promise<void>|null=null;private paused=false;private disposed=false;private confirmed:string;
  constructor(private store:BrowserWorkspaceStore,private revision:number,workspace:Workspace,private status:(saved:boolean,message?:string)=>void){this.confirmed=serializeWorkspace(workspace);}
  enqueue(workspace:Workspace){if(this.disposed)return;const text=serializeWorkspace(workspace);if(!this.pending&&text===this.confirmed){this.status(true);return;}this.pending=text;this.status(false);void this.flush().catch(()=>{});}
  async flush(){if(this.disposed||this.paused)return;if(this.running)return this.running;this.running=this.drain().finally(()=>{this.running=null;});return this.running;}
  private async drain(){while(this.pending&&!this.disposed){const text=this.pending;try{this.revision=await this.store.save(JSON.parse(text),this.revision);this.confirmed=text;if(this.pending===text){this.pending=null;this.status(true);}}catch(error){this.paused=true;this.status(false,error instanceof Error?error.message:'浏览器保存失败，请导出备份');throw error;}}}
  dispose(){this.disposed=true;}
}
