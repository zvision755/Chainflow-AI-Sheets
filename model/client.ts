import { readGeneration } from './stream';
import type { Generate, GenerateInput } from '../core/types';
import { ModelError } from './errors';
import { isLocalModelUrl } from '../core/local-model-endpoint';
export { ModelError } from './errors';
export function apiClient(key:()=>string, connection:()=>{provider:string;customUrl?:string;localUrl?:string;localProvider?:string}):Generate {
  return async (input:GenerateInput,signal,context)=>{
    const config=connection(),token=key().trim(),effectiveUrl=config.provider==='local'?(config.localUrl??config.customUrl??''):(config.customUrl??''),local=config.provider==='local'&&isLocalModelUrl(effectiveUrl);if(!token&&!local)throw new ModelError('请先输入你自己的 API key','missing_key');
    let response:Response;
    try {response=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({...input,stream:context?.stream??input.stream??true,provider:config.provider,customUrl:effectiveUrl,localProvider:config.localProvider}),signal,cache:'no-store'});}
    catch {if(signal.aborted)throw new ModelError('请求已取消或超时','cancelled');throw new ModelError('无法连接本站服务端，请检查网络','network',true);}
    return readGeneration(response,signal,context?.onText);
  };
}
