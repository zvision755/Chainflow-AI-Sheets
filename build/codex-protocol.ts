// Local development transport only; never import this module from app routes.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface, type Interface } from 'node:readline';

export type RpcMessage = { id?: number|string; method?: string; params?: any; result?: any; error?: {code:number;message:string} };
export class LocalAgentError extends Error {
  constructor(public code:string,message:string,public status=502,public retryable=false){super(message);}
}
export interface CodexTransport {
  request(method:string,params:unknown,timeoutMs?:number):Promise<any>;
  onNotification(listener:(message:RpcMessage)=>void):()=>void;
  close():void;
}
export class StdioCodexTransport implements CodexTransport {
  private child:ChildProcessWithoutNullStreams;
  private lines:Interface;
  private events=new EventEmitter();
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private sequence=0;
  private closed=false;
  constructor(binary:string,args:string[],cwd:string,env:NodeJS.ProcessEnv){
    this.events.setMaxListeners(20);
    this.child=spawn(binary,args,{cwd,env,stdio:['pipe','pipe','pipe'],shell:false});
    // Codex diagnostics may contain private context. Never forward them to web/server logs.
    this.child.stderr.resume();
    this.lines=createInterface({input:this.child.stdout});
    this.lines.on('line',line=>{
      if(line.length>2_000_000){this.close();return;}
      let message:RpcMessage;try{message=JSON.parse(line);}catch{return;}
      if(message.id!==undefined&&message.method){
        // No approvals, commands, tools, credential exchange or user questions through this bridge.
        this.send({id:message.id,error:{code:-32601,message:'This text-only client does not expose tools'}});
        return;
      }
      const pending=typeof message.id==='number'?this.pending.get(message.id):undefined;
      if(pending){clearTimeout(pending.timer);this.pending.delete(message.id as number);if(message.error)pending.reject(new LocalAgentError('codex_protocol','Codex 拒绝了连接参数，请检查版本与登录状态',409));else pending.resolve(message.result);}
      else if(message.method)this.events.emit('notification',message);
    });
    const fail=()=>{if(this.closed)return;this.closed=true;this.lines.close();const error=new LocalAgentError('codex_disconnected','Codex 本地连接已断开，请重新连接',503,true);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.events.emit('notification',{method:'bridge/disconnected'});};
    this.child.once('error',fail);this.child.once('exit',fail);
  }
  private send(message:unknown){if(!this.closed)this.child.stdin.write(JSON.stringify(message)+'\n',()=>{});}
  async initialize(){await this.request('initialize',{clientInfo:{name:'chainflow_ai_sheets',title:'ChainFlow AI Sheets',version:'0.2.0'}},20000);this.send({method:'initialized'});}
  request(method:string,params:unknown,timeoutMs=20000):Promise<any>{
    if(this.closed)return Promise.reject(new LocalAgentError('codex_disconnected','Codex 本地连接已断开，请重新连接',503,true));
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new LocalAgentError('codex_connection_timeout','Codex 连接超时，请重试',504,true));},timeoutMs);this.pending.set(id,{resolve,reject,timer});this.send({id,method,params});});
  }
  onNotification(listener:(message:RpcMessage)=>void){this.events.on('notification',listener);return ()=>this.events.off('notification',listener);}
  close(){if(this.closed)return;this.child.kill('SIGTERM');const timer=setTimeout(()=>{if(this.child.exitCode===null)this.child.kill('SIGKILL');},1500);timer.unref();}
}
