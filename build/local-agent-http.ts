// Preview-only routes. Production capabilities and routes never import this file.
import { z } from 'zod';
import type { CodexBridge } from './codex-bridge';
import { LocalAgentError } from './codex-protocol';
import { json } from '../server/proxy';
import { generationStream } from '../server/generation-stream';
const payload=z.object({model:z.string().regex(/^[a-zA-Z0-9._:/-]{1,100}$/),prompt:z.string().min(1).max(12000),input:z.string().min(1).max(32000),maxTokens:z.number().int().min(64).max(4096),reasoning:z.enum(['none','low','medium','high']),stream:z.boolean().default(false)}).strict();
export function localRequestAllowed(host:string,address:string|undefined){
  try{return ['127.0.0.1','localhost','[::1]'].includes(new URL(`http://${host}`).hostname)&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address??'');}catch{return false;}
}
const fail=(code:string,message:string,status:number,retryable=false)=>json({error:{code,message,retryable}},status);
export async function localAgentRequest(request:Request,operation:'status'|'generate',bridge:Pick<CodexBridge,'status'|'generate'>,authenticated=false){
  if(request.method!=='POST')return fail('method','请使用 POST 请求',405);
  if(!authenticated&&request.headers.get('origin')!==new URL(request.url).origin)return fail('origin','本地 Agent 只接受本机同源页面请求',403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return fail('content_type','请使用 JSON 请求',415);
  if(request.headers.has('authorization'))return fail('unexpected_key','本地 Codex Agent 不接受 API key',400);
  let raw:unknown;try{
    const reader=request.body?.getReader(),decoder=new TextDecoder();let text='',bytes=0;
    if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>70000)return fail('request_size','请求超过 70 KB',413);text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    raw=JSON.parse(text);
  }catch{return fail('invalid_request','请求格式不正确',400);}
  const parsed=operation==='generate'?payload.safeParse(raw):z.object({}).strict().safeParse(raw);
  if(!parsed.success)return fail('parameters','Agent 参数不合法，请检查模型、输入长度与输出预算',400);
  if(operation==='generate'&&(parsed.data as z.infer<typeof payload>).stream){
    const abort=new AbortController(),cancel=()=>abort.abort();request.signal.addEventListener('abort',cancel,{once:true});if(request.signal.aborted)cancel();
    return generationStream(onText=>bridge.generate(parsed.data as z.infer<typeof payload>,abort.signal,onText),cancel,error=>({type:'error',error:error instanceof LocalAgentError?{code:error.code,message:error.message,retryable:error.retryable}:{code:'codex_connection',message:'无法连接本地 Codex，请检查桌面应用登录状态',retryable:true}}),()=>request.signal.removeEventListener('abort',cancel));
  }
  try{return json(operation==='status'?await bridge.status():await bridge.generate(parsed.data as z.infer<typeof payload>,request.signal));}
  catch(error){if(error instanceof LocalAgentError)return fail(error.code,error.message,error.status,error.retryable);return fail('codex_connection','无法连接本地 Codex，请检查桌面应用登录状态',503,true);}
}
