import type { Column, Generate, GenerateResult } from '../core/types';
export type AgentContext={claim:()=>void;record:(phase:string,run:()=>Promise<GenerateResult>)=>Promise<GenerateResult>;maxRetries:number};
export async function runAgent(column:Column,input:string,_sourceValues:string[],generate:Generate,signal:AbortSignal,ctx:AgentContext):Promise<GenerateResult>{
  if(signal.aborted)throw new Error('已停止');
  ctx.claim();
  return ctx.record('生成结果',()=>generate({model:column.model,prompt:column.prompt,input,maxTokens:column.maxTokens,reasoning:column.reasoning},signal));
}
