import { descendants, plan, topological } from './graph';
import { emptyCell, id, type Sheet, type Column, type Generate, type RunOptions, type Step } from './types';
import { runApi } from '../modes/api';
import { runAgent } from '../modes/agent';
import { ModelError } from '../model/client';
import { repeatedResult } from './fresh-results';
import { buildPrompts, promptContext, validatePromptTemplates } from './prompt-templates';
type Task={row:string;column:string;revision:number;attempt:number;retryAt:number;options:RunOptions;batch:Batch;avoidResults?:string[];duplicateRetries?:number;variantUsage?:{input:number;output:number}};
type Batch={steps:number;deadline:number;timer:ReturnType<typeof setTimeout>|null;columnCompletedAt:Map<string,number>};
export class Scheduler {
  sheet:Sheet;steps:Step[]=[];
  private queue=new Map<string,Task>();private active=new Map<string,{task:Task;controller:AbortController}>();
  private listeners=new Set<()=>void>();private version=0;private wakeTimer:ReturnType<typeof setTimeout>|null=null;
  private resultHistory=new Map<string,string[]>();
  constructor(sheet:Sheet,private generate:Generate){this.sheet=sheet;}
  setGenerate(generate:Generate){if(!this.busy)this.generate=generate;}
  subscribe=(cb:()=>void)=>{this.listeners.add(cb);return ()=>this.listeners.delete(cb);};
  snapshot=()=>this.version;
  private emit(){this.version++;this.listeners.forEach(cb=>cb());}
  get running(){return this.active.size;}
  get queued(){return this.queue.size;}
  get busy(){return !!(this.running+this.queued);}
  private key(row:string,col:string){return `${row}:${col}`;}
  private cell(row:string,col:string){return this.sheet.rows.find(r=>r.id===row)?.cells[col];}
  targets(scope:'all'|'row'|'column'|'cell',row?:string,col?:string){return this.sheet.rows.filter(r=>!row||r.id===row).flatMap(r=>this.sheet.columns.slice(1).filter(c=>!col||c.id===col).map(c=>({row:r.id,column:c.id})));}
  estimate(targets:{row:string;column:string}[],force=false){return plan(this.sheet,targets,force).length;}
  run(targets:{row:string;column:string}[],options:RunOptions,force=false){
    const todo=plan(this.sheet,targets,force);const batch:Batch={steps:0,deadline:Date.now()+options.totalTimeout,timer:null,columnCompletedAt:new Map()};
    const limit={...options,autoRetry:options.autoRetry!==false,apiMaxRetries:Math.max(0,Math.min(3,options.apiMaxRetries??2)),retryDelayMs:Math.max(10,Math.min(30000,options.retryDelayMs??2000)),dependencyDelayMs:Math.max(0,Math.min(60000,options.dependencyDelayMs??500)),concurrency:Math.max(1,Math.min(3,options.concurrency)),maxRetries:Math.max(0,Math.min(2,options.maxRetries)),maxSteps:Math.max(1,Math.min(3000,options.maxSteps)),timeout:Math.max(1000,Math.min(120000,options.timeout))};
    for(const t of todo){const key=this.key(t.row,t.column);if(this.queue.has(key)||this.active.has(key))continue;
      const cell=this.cell(t.row,t.column)!,column=this.sheet.columns.find(c=>c.id===t.column)!;
      const avoidResults=force&&column.freshResults&&targets.some(target=>target.row===t.row&&target.column===t.column)&&cell.value.trim()?Array.from(new Set([...(this.resultHistory?.get(key)??[]),cell.value])).slice(-5):undefined;
      cell.status='queued';delete cell.error;this.queue.set(key,{...t,revision:cell.revision,attempt:0,retryAt:0,options:limit,batch,avoidResults});}
    if([...this.queue.values()].some(t=>t.batch===batch))batch.timer=setTimeout(()=>this.stopBatch(batch,'已达到整次运行的时间上限'),options.totalTimeout);
    this.emit();this.pump();
  }
  private cleanupBatch(batch:Batch){if(![...this.queue.values(),...[...this.active.values()].map(a=>a.task)].some(t=>t.batch===batch)&&batch.timer){clearTimeout(batch.timer);batch.timer=null;}}
  private stopBatch(batch:Batch,message:string){
    for(const [key,t] of this.queue)if(t.batch===batch){const c=this.cell(t.row,t.column);if(c){c.status='cancelled';c.error=message;}this.queue.delete(key);}
    for(const {task,controller} of this.active.values())if(task.batch===batch){const c=this.cell(task.row,task.column);if(c){c.revision++;delete c.preview;c.status='cancelled';c.error=message;}controller.abort();}
    this.cleanupBatch(batch);this.emit();this.pump();
  }
  stop(){for(const batch of new Set([...this.queue.values(),...[...this.active.values()].map(a=>a.task)].map(t=>t.batch)))this.stopBatch(batch,'已停止；已提交给提供商的请求仍可能计费');}
  private invalidate(row:string,columns:Set<string>){
    const batches=new Set<Batch>();
    for(const col of columns){const key=this.key(row,col),c=this.cell(row,col);if(!c)continue;this.resultHistory?.delete(key);c.revision++;c.status='stale';delete c.preview;delete c.error;delete c.completedAt;
      const t=this.queue.get(key);if(t){batches.add(t.batch);this.queue.delete(key);}this.active.get(key)?.controller.abort();}
    batches.forEach(b=>this.cleanupBatch(b));
  }
  edit(row:string,col:string,value:string){const c=this.cell(row,col);if(!c||c.value===value)return;
    this.invalidate(row,new Set([col,...descendants(this.sheet.columns,col)]));c.value=value;c.status='done';this.emit();this.pump();
  }
  configure(column:Column){
    const existing=this.sheet.columns.find(c=>c.id===column.id);if(!existing)throw new Error('列不存在');
    const columns=this.sheet.columns.map(c=>c.id===column.id?column:c);topological(columns);
    if(column.id!==columns[0].id&&!column.sources.length)throw new Error('请至少选择一个来源列');
    if(column.id!==columns[0].id)validatePromptTemplates(column);
    const changed=['sources','prompt','userPrompt','model','maxTokens','reasoning','check','minLength','containsSource'].some(k=>JSON.stringify(existing[k as keyof Column])!==JSON.stringify(column[k as keyof Column]));
    this.sheet.columns=columns;if(changed)this.sheet.rows.forEach(r=>this.invalidate(r.id,new Set([column.id,...descendants(columns,column.id)])));this.emit();this.pump();
  }
  invalidateGeneratedResults(){if(this.busy)throw new Error('请先停止运行再切换 Agent 模型');const generated=new Set(this.sheet.columns.slice(1).map(c=>c.id));this.sheet.rows.forEach(row=>this.invalidate(row.id,generated));this.emit();}
  addColumn(column:Column){const columns=[...this.sheet.columns,column];topological(columns);this.sheet.columns=columns;this.sheet.rows.forEach(r=>r.cells[column.id]=emptyCell());this.emit();}
  removeColumn(col:string){if(col===this.sheet.columns[0].id)throw new Error('输入列不能删除');if(this.sheet.columns.some(c=>c.sources.includes(col)))throw new Error('其他列仍依赖此列，请先修改它们的来源');this.sheet.rows.forEach(r=>{this.invalidate(r.id,new Set([col]));delete r.cells[col];});this.sheet.columns=this.sheet.columns.filter(c=>c.id!==col);this.emit();}
  moveColumn(col:string,delta:number){const cols=[...this.sheet.columns],i=cols.findIndex(c=>c.id===col),j=i+delta;if(i<1||j<1||j>=cols.length)return;[cols[i],cols[j]]=[cols[j],cols[i]];this.sheet.columns=cols;this.emit();}
  addRow(copy?:string){const source=this.sheet.rows.find(r=>r.id===copy);this.sheet.rows.push({id:id(),cells:Object.fromEntries(this.sheet.columns.map((c,i)=>[c.id,emptyCell(source?.cells[c.id].value??'',i===0?'done':source?.cells[c.id].value?'stale':'idle')]))});this.emit();}
  removeRow(row:string){this.invalidate(row,new Set(this.sheet.columns.map(c=>c.id)));this.sheet.rows=this.sheet.rows.filter(r=>r.id!==row);this.emit();this.pump();}
  recentResults(row:string,column:string){return [...(this.resultHistory?.get(this.key(row,column))??[])];}
  replace(sheet:Sheet){if(this.busy)throw new Error('请先停止运行，等待计数回到 0');this.sheet=sheet;this.steps=[];this.resultHistory?.clear();this.emit();}
  private pump(){
    if(this.wakeTimer){clearTimeout(this.wakeTimer);this.wakeTimer=null;}
    let changed=false,nextWake=Infinity;
    for(const [key,task] of this.queue){
      const row=this.sheet.rows.find(r=>r.id===task.row),col=this.sheet.columns.find(c=>c.id===task.column),cell=row?.cells[task.column];
      if(!row||!col||!cell||cell.revision!==task.revision){this.queue.delete(key);this.cleanupBatch(task.batch);changed=true;continue;}
      const sources=col.sources.map(s=>row.cells[s]);
      if(sources.some(s=>s.status==='error'||s.status==='cancelled'||(!['done','running','queued'].includes(s.status)&&!this.queue.has(this.key(task.row,col.sources[sources.indexOf(s)]))))){cell.status='error';cell.error='上游未完成或失败，请先修正上游后重试';this.queue.delete(key);this.cleanupBatch(task.batch);changed=true;continue;}
      if(sources.some(s=>s.status!=='done'))continue;
      if(Date.now()<task.retryAt){nextWake=Math.min(nextWake,task.retryAt);continue;}
      // A dependent column waits for all scheduled upstream cells in this run.
      const pending=[...this.queue.values(),...[...this.active.values()].map(a=>a.task)];
      if(pending.some(t=>t.batch===task.batch&&col.sources.includes(t.column)))continue;
      const upstreamFinished=Math.max(0,...col.sources.map((s,i)=>Math.max(sources[i].completedAt??0,task.batch.columnCompletedAt.get(s)??0)));
      const readyAt=upstreamFinished+(task.options.dependencyDelayMs??500);
      if(Date.now()<readyAt){nextWake=Math.min(nextWake,readyAt);continue;}
      if(this.running>=task.options.concurrency)continue;
      this.queue.delete(key);const controller=new AbortController();this.active.set(key,{task,controller});cell.status='running';delete cell.error;changed=true;void this.execute(key,task,col,row.cells,controller);
    }
    if(Number.isFinite(nextWake)&&this.queue.size)this.wakeTimer=setTimeout(()=>{this.wakeTimer=null;this.pump();},Math.max(1,nextWake-Date.now()));
    if(changed)this.emit();
  }
  private async execute(key:string,task:Task,col:Column,cells:Sheet['rows'][number]['cells'],controller:AbortController){
    const started=Date.now(),sourceValues=col.sources.map(s=>cells[s].value),input=col.sources.length===1?sourceValues[0]:col.sources.map((s,i)=>`[${this.sheet.columns.find(c=>c.id===s)?.name}]\n${sourceValues[i]}`).join('\n\n');
    let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},task.options.timeout);
    const record=async(phase:string,fn:()=>ReturnType<Generate>)=>{
      const step:Step={model:task.options.mode==='agent'&&task.options.agentBackend==='codex'?task.options.agentModel??'gpt-6-luna':col.model,backend:task.options.mode==='agent'?task.options.agentBackend??'api':'api',id:id(),row:task.row,column:col.name,phase,state:'running',started:Date.now()};this.steps=[...this.steps.slice(-299),step];this.emit();
      try{const result=await fn();step.state=controller.signal.aborted?'cancelled':'done';step.usage=result.usage;return result;}catch(error){step.state=controller.signal.aborted?'cancelled':'error';step.error=controller.signal.aborted?'已取消':error instanceof Error?error.message:'调用失败';throw error;}finally{step.elapsed=Date.now()-step.started;this.emit();}
    };
    let progressTimer:ReturnType<typeof setTimeout>|undefined,lastProgress=0;
    const guarded:Generate=async(payload,signal,display)=>{
      const initial=this.cell(task.row,task.column);if(initial&&initial.revision===task.revision&&display?.display!==false){delete initial.preview;this.emit();}
      const onText=task.options.streaming!==false&&display?.display!==false?(text:string)=>{
        const cell=this.cell(task.row,task.column);if(!cell||cell.revision!==task.revision||signal.aborted||cell.status!=='running')return;
        cell.preview=text;
        if(Date.now()-lastProgress>=50){lastProgress=Date.now();this.emit();}
        else if(!progressTimer)progressTimer=setTimeout(()=>{progressTimer=undefined;if(!signal.aborted&&cell.revision===task.revision){lastProgress=Date.now();this.emit();}},50);
      }:undefined;
      return new Promise((resolve,reject)=>{const abort=()=>reject(new Error('请求已取消'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
        Promise.resolve().then(()=>this.generate(task.options.mode==='agent'&&task.options.agentBackend==='codex'?{...payload,model:task.options.agentModel??'gpt-6-luna'}:payload,signal,{mode:task.options.mode,agentBackend:task.options.agentBackend,stream:task.options.streaming!==false,onText})).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
    };
    try{
      if(!input.trim())throw new Error('来源内容为空，请先填写输入');if(!col.prompt.trim())throw new Error('请先配置列提示词');
      const expanded=buildPrompts(col,promptContext(this.sheet,task.row,col,this.recentResults(task.row,col.id)));
      const generationColumn={...col,prompt:expanded.prompt};
      const result=task.options.mode==='agent'?await runAgent(generationColumn,expanded.input,sourceValues,guarded,controller.signal,{maxRetries:task.options.autoRetry===false?0:task.options.maxRetries,record,claim:()=>{if(Date.now()>=task.batch.deadline)throw new Error('已达到运行时间上限');if(task.batch.steps>=task.options.maxSteps)throw new Error('已达到 Agent 最大调用步数');task.batch.steps++;}}):await record(task.attempt?`API 生成 · 自动重试 ${task.attempt}/${task.options.apiMaxRetries}`:'API 生成',()=>runApi(generationColumn,expanded.input,guarded,controller.signal));
      if(task.avoidResults){task.variantUsage={input:(task.variantUsage?.input??0)+result.usage.input,output:(task.variantUsage?.output??0)+result.usage.output};if(repeatedResult(result.text,task.avoidResults))throw new ModelError('模型仍返回与已有结果相同的例句；原结果已保留', 'repeated_output', true);}
      const cell=this.cell(task.row,task.column);
      if(cell&&cell.revision===task.revision&&!controller.signal.aborted){
        if(cell.value!==result.text){const affected=descendants(this.sheet.columns,task.column);for(const d of affected){const downstream=this.cell(task.row,d);if(downstream&&downstream.status!=='queued')this.invalidate(task.row,new Set([d]));}}
        const completedAt=Date.now();task.batch.columnCompletedAt.set(col.id,completedAt);
        Object.assign(cell,{value:result.text,status:'done',completedAt,elapsed:Date.now()-started,usage:task.variantUsage??result.usage});delete cell.error;
        {this.resultHistory??=new Map();const history=this.recentResults(task.row,col.id);this.resultHistory.delete(key);this.resultHistory.set(key,Array.from(new Set([...history,...(task.avoidResults??[]),result.text])).slice(-5));if(this.resultHistory.size>100)this.resultHistory.delete(this.resultHistory.keys().next().value!);}
      }
    }catch(error){
      const cell=this.cell(task.row,task.column);
      if(cell&&cell.revision===task.revision){
        const message=timedOut?`请求超过 ${task.options.timeout/1000} 秒，已终止`:controller.signal.aborted?'请求已取消':error instanceof Error?error.message:'未知错误';
        const retryable=timedOut||(!controller.signal.aborted&&error instanceof ModelError&&error.retryable);
        const delay=Math.min(60000,(task.options.retryDelayMs??2000)*2**task.attempt);
        const repeated=error instanceof ModelError&&error.code==='repeated_output';
        if(task.options.autoRetry!==false&&retryable&&(!repeated||(task.duplicateRetries??0)<1)&&task.attempt<(task.options.apiMaxRetries??2)&&Date.now()+delay<task.batch.deadline){
          if(repeated)task.duplicateRetries=(task.duplicateRetries??0)+1;
          task.attempt++;task.retryAt=Date.now()+delay;cell.status='queued';cell.error=`${message}；${delay/1000} 秒后自动重试（${task.attempt}/${task.options.apiMaxRetries??2}）`;this.queue.set(key,task);
        }else{cell.status=controller.signal.aborted&&!timedOut?'cancelled':'error';cell.error=message+(repeated?'；重复结果最多额外尝试 1 次，已停止（受自动重试设置及总时限限制）':retryable&&task.options.autoRetry!==false?`；已停止自动重试（最多 ${task.options.apiMaxRetries??2} 次，受总时限限制）`:'');}
        cell.elapsed=Date.now()-started;
      }
    }
    finally{clearTimeout(timeout);clearTimeout(progressTimer);const cell=this.cell(task.row,task.column);if(cell&&cell.revision===task.revision)delete cell.preview;this.active.delete(key);this.cleanupBatch(task.batch);this.emit();this.pump();}
  }
}
