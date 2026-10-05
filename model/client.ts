import type { Generate, GenerateInput } from '../core/types';
export class ModelError extends Error { constructor(message:string,public code:string,public retryable=false){super(message);} }
export function apiClient(key:()=>string, connection:()=>{provider:string;customUrl?:string}):Generate {
  return async (input:GenerateInput,signal)=>{
    const token=key().trim();if(!token)throw new ModelError('请先输入你自己的 API key','missing_key');
    let response:Response;
    try {response=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({...input,...connection()}),signal,cache:'no-store'});}
    catch {if(signal.aborted)throw new ModelError('请求已取消或超时','cancelled');throw new ModelError('无法连接本站服务端，请检查网络','network',true);}
    const data=await response.json().catch(()=>null) as {text?:string;usage?:{input:number;output:number};error?:{message:string;code:string;retryable:boolean}}|null;
    if(!response.ok)throw new ModelError(data?.error?.message??'服务端返回无效响应',data?.error?.code??'server',data?.error?.retryable??false);
    if(!data||typeof data.text!=='string'||!data.usage)throw new ModelError('服务端返回的数据格式不正确','invalid_response');
    return {text:data.text,usage:data.usage};
  };
}
