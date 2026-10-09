import type { Generate, GenerateResult } from '../core/types';
import { sessionFetch as fetch } from './session';
import { ModelError } from './client';
import { readGeneration } from './stream';
export type AgentModel={id:string;name:string;efforts:string[];defaultEffort:string};
export type LocalAgentStatus={connected:true;auth:'chatgpt';plan:string;version:string;models:AgentModel[];defaultModel:string;transport:'app-server'};
async function post(path:string,body:unknown,signal:AbortSignal){
  let response:Response;
  try{response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal,cache:'no-store'});}catch{if(signal.aborted)throw new ModelError('本地 Agent 已取消或连接超时','cancelled');throw new ModelError('无法连接本地 Agent 服务，请检查预览是否运行','network',true);}
  const data=await response.json().catch(()=>null) as any;
  if(!response.ok)throw new ModelError(data?.error?.message??'本地 Agent 服务不可用',data?.error?.code??'local_agent',data?.error?.retryable??false);
  return data;
}
export async function connectLocalAgent(signal:AbortSignal):Promise<LocalAgentStatus>{
  const status=await post('/api/local-agent/status',{},signal);
  if(status?.connected!==true||status.auth!=='chatgpt'||!Array.isArray(status.models))throw new ModelError('本地 Codex 连接信息无效','invalid_response');
  return status;
}
export const localAgentClient:Generate=async(input,signal,context)=>{
  let response:Response;
  try{response=await fetch('/api/local-agent/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,stream:context?.stream??input.stream??true}),signal,cache:'no-store'});}catch{if(signal.aborted)throw new ModelError('本地 Agent 已取消或连接超时','cancelled');throw new ModelError('无法连接本地 Agent 服务，请检查预览是否运行','network',true);}
  return readGeneration(response,signal,context?.onText);
};
