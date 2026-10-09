import { sessionFetch } from './session';
import type { Workspace } from '../core/workspace';
import type { Connection } from './credentials';
import type { TtsConfig } from '../core/tts';
export type PersonalSettings = { revision:number; connection:Connection; tts:TtsConfig; modelKeyConfigured:boolean; ttsKeyConfigured:boolean };
export const PENDING_WORKSPACE='chainflow-pending-server-workspace-v1';
export async function personalRequest<T>(path:string,body?:unknown):Promise<T>{
  const response=await sessionFetch(path,{method:body===undefined?'GET':'PUT',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',signal:AbortSignal.timeout(30000)});
  const data=await response.json() as T & {error?:{code:string;message:string}};
  if(!response.ok)throw Object.assign(Error(data.error?.message??'服务器保存失败'),{code:data.error?.code,status:response.status});
  return data;
}
/** Only confirmed responses advance the revision. A conflict permanently pauses writes until explicit reload. */
export class WorkspaceSync {
  private pending:string|null=null; private confirmed:string; private running:Promise<void>|null=null; private conflict=false; private disposed=false; private retry:ReturnType<typeof setTimeout>|null=null;
  constructor(private revision:number,workspace:Workspace,private status:(saved:boolean,message?:string)=>void){this.confirmed=JSON.stringify(workspace);}
  enqueue(workspace:Workspace){
    if(this.disposed)return;
    const text=JSON.stringify(workspace);if(text===this.confirmed&&!this.pending){this.status(true);return;}
    if(text===this.pending)return;
    this.pending=text;this.status(false);
    localStorage.setItem(PENDING_WORKSPACE,JSON.stringify({revision:this.revision,workspace}));
    void this.flush().catch(()=>{});
  }
  async flush(){
    if(this.disposed)return;
    if(this.conflict)throw Error('存在版本冲突，请先导出未保存副本并重新加载');
    if(this.retry){clearTimeout(this.retry);this.retry=null;}
    if(this.running)return this.running;
    this.running=this.drain().finally(()=>{this.running=null;if(this.pending&&!this.conflict&&!this.retry)void this.flush().catch(()=>{});});return this.running;
  }
  private async drain(){
    while(this.pending&&!this.disposed){const text=this.pending;
      try{const result=await personalRequest<{revision:number}>('/api/workspace',{revision:this.revision,workspace:JSON.parse(text)});this.revision=result.revision;this.confirmed=text;
        if(this.pending===text){this.pending=null;localStorage.removeItem(PENDING_WORKSPACE);this.status(true);}else{localStorage.setItem(PENDING_WORKSPACE,JSON.stringify({revision:this.revision,workspace:JSON.parse(this.pending)}));}
      }catch(error){this.conflict=(error as {status?:number}).status===409;if(!this.disposed){this.status(false,this.conflict?'保存冲突：另一台设备已有更新。请先导出未保存副本，再重新加载服务器数据。':'网络或服务不可用：修改尚未保存到服务器，已保留本机待同步副本。');if(!this.conflict)this.retry=setTimeout(()=>{void this.flush().catch(()=>{});},10000);}throw error;}
    }
  }
  dispose(){if(this.retry)clearTimeout(this.retry);this.disposed=true;this.conflict=true;}
}
