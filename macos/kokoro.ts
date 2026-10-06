import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

export type KokoroState={state:'idle'|'loading'|'ready'|'failed';loaded:boolean;autoLoad:boolean;memoryMiB:number};
export class BundledKokoro {
 private child:ChildProcess|undefined;
 private starting:Promise<KokoroState>|undefined;
 private phase:KokoroState['state']='idle';
 private port=0;
 private remember=false;
 private generation=0;
 constructor(private resources:string,private profile:string){
  try{this.remember=JSON.parse(readFileSync(join(profile,'kokoro.json'),'utf8')).autoLoad===true;}catch{}
 }
 status():KokoroState{return {state:this.phase,loaded:this.phase==='ready',autoLoad:this.remember,memoryMiB:900};}
 private save(remember:boolean){this.remember=remember;writeFileSync(join(this.profile,'kokoro.json'),JSON.stringify({autoLoad:remember}),{mode:0o600});}
 async load(remember:boolean){
  if(this.starting)return this.starting;
  if(this.phase==='ready'){this.save(remember);return this.status();}
  const generation=++this.generation;this.phase='loading';
  this.starting=(async()=>{
   try{
    const listener=createServer();await new Promise<void>((ok,bad)=>{listener.once('error',bad);listener.listen(0,'127.0.0.1',ok);});
    this.port=(listener.address()as{port:number}).port;await new Promise<void>(ok=>listener.close(()=>ok()));
    if(generation!==this.generation)throw Error('Cancelled');
    const child=spawn(join(this.resources,'kokoro','kokoro-mlx'),[],{cwd:this.resources,stdio:'ignore',env:{NODE_ENV:'production',HOME:process.env.HOME,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',KOKORO_MODEL_DIR:join(this.resources,'models'),KOKORO_HOST:'127.0.0.1',KOKORO_PORT:String(this.port),CHAINFLOW_PARENT_PID:String(process.pid),HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',TOKENIZERS_PARALLELISM:'false'}});
    this.child=child;let exited=false;
    child.once('error',()=>{exited=true;});child.once('exit',()=>{exited=true;if(generation===this.generation){this.phase='failed';this.child=undefined;}});
    const end=Date.now()+90000;
    while(Date.now()<end&&!exited&&generation===this.generation){
     try{const response=await fetch(`http://127.0.0.1:${this.port}/health`,{signal:AbortSignal.timeout(700),cache:'no-store'});if(response.ok){const data=await response.json()as{ok?:boolean;metal?:boolean};if(data.ok&&data.metal){this.phase='ready';this.save(remember);return this.status();}}}catch{}
     await new Promise(ok=>setTimeout(ok,300));
    }
    throw Error('Model startup failed');
   }catch{this.child?.kill('SIGKILL');this.child=undefined;if(generation===this.generation)this.phase='failed';throw Error('内置 MLX 模型加载失败，请确认是 M 系列 Mac，稍后重试');}
   finally{this.starting=undefined;}
  })();return this.starting;
 }
 async unload(forget=true){
  ++this.generation;const child=this.child;this.child=undefined;this.phase='idle';
  if(child&&child.exitCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);timer.unref();await new Promise<void>(resolve=>{child.once('exit',()=>{clearTimeout(timer);resolve();});setTimeout(resolve,3500).unref();});}
  if(forget)this.save(false);return this.status();
 }
 async fetch(input:Parameters<typeof fetch>[0],init?:RequestInit){
  if(this.phase!=='ready')return new Response(JSON.stringify({error:{message:'模型未加载'}}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  const path=new URL(String(input)).pathname;
  if(!['/v1/audio/speech','/v1/audio/voices'].includes(path))throw Error('Invalid model endpoint');
  return fetch(`http://127.0.0.1:${this.port}${path}`,{...init,redirect:'error'});
 }
}
