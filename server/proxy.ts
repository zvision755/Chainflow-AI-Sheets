import { z } from 'zod';
import { target } from './targets';
import { StreamFailure } from '../core/stream-protocol';
import { generationStream } from './generation-stream';
import { readProviderStream } from './provider-stream';
import { providerResponse } from './provider-response';
const connection=z.object({provider:z.enum(['openai','deepseek','custom']).default('openai'),customUrl:z.string().max(500).default('')});
const payload=connection.extend({model:z.string().regex(/^[a-zA-Z0-9._:/-]{1,100}$/),prompt:z.string().min(1).max(12000),input:z.string().min(1).max(32000),maxTokens:z.number().int().min(64).max(4096),reasoning:z.enum(['none','low','medium','high']),stream:z.boolean().default(false)}).strict();
const buckets=new Map<string,{active:number;count:number;expires:number}>();
let totalActive=0;
const headers={'Cache-Control':'no-store, max-age=0','Pragma':'no-cache','Content-Type':'application/json','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers});}
function fail(code:string,message:string,status:number,retryable=false){return json({error:{code,message,retryable}},status);}
async function limitedText(body:ReadableStream<Uint8Array>|null,limit:number){if(!body)return '';const reader=body.getReader(),decoder=new TextDecoder();let size=0,text='';try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new Error('size');text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
export async function proxy(request:Request,operation:'generate'|'models',fetcher:typeof fetch=fetch):Promise<Response>{
  const origin=request.headers.get('origin');if(origin!==new URL(request.url).origin)return fail('origin','仅接受本站页面发出的请求',403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return fail('content_type','请使用 JSON 请求',415);
  const authorization=request.headers.get('authorization')??'';
  const match=/^Bearer ([a-zA-Z0-9_.-]{20,300})$/.exec(authorization);if(!match)return fail('missing_key','请填写有效的 API key；本站没有后备密钥',401);
  const key=match[1];
  let body:unknown;try{if(Number(request.headers.get('content-length')??0)>70000)return fail('request_size','请求过大（上限 70 KB）',413);body=JSON.parse(await limitedText(request.body,70000));}catch{return fail('invalid_request','请求格式错误或超过 70 KB',400);}
  const parsed=operation==='generate'?payload.safeParse(body):connection.strict().safeParse(body);
  if(!parsed.success)return fail('parameters','参数不合法：请检查模型、输入长度与输出上限',400);
  const data=parsed.data;
  let destination:ReturnType<typeof target>;try{destination=target(data);}catch(e){return fail('api_url',e instanceof Error?e.message:'API 地址不合法',400);}
  const now=Date.now();for(const [hash,b] of buckets)if(b.expires<now&&!b.active)buckets.delete(hash);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));const hash=Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join('');
  let bucket=buckets.get(hash);if(!bucket){if(buckets.size>=1000)return fail('busy','服务繁忙，请稍后重试',429,true);bucket={active:0,count:0,expires:now+60000};buckets.set(hash,bucket);}
  if(bucket.expires<now){bucket.count=0;bucket.expires=now+60000;}
  if(bucket.active>=3||totalActive>=12||bucket.count>=60)return fail('rate_limit','本站并发或频率达到上限，请稍后重试（每个密钥最多 3 个并发、每分钟 60 次）',429,true);
  bucket.active++;bucket.count++;totalActive++;
  const controller=new AbortController();let timeout=false;const timer=setTimeout(()=>{timeout=true;controller.abort();},110000);
  const cancel=()=>controller.abort();request.signal.addEventListener('abort',cancel,{once:true});if(request.signal.aborted)cancel();
  const redact=(s:string)=>s.replaceAll(key,'[已隐藏密钥]');
  let handedOff=false,released=false;const cleanup=()=>{if(released)return;released=true;clearTimeout(timer);request.signal.removeEventListener('abort',cancel);bucket.active--;totalActive--;};
  try{
    const params=operation==='generate'?data as z.infer<typeof payload>:null;
    let response=await fetcher(operation==='generate'?destination.generate:destination.models,{method:params?'POST':'GET',headers:{Authorization:`Bearer ${key}`,...(params?{'Content-Type':'application/json',Accept:params.stream?'text/event-stream':'application/json'}:{})},...(params?{body:JSON.stringify(destination.protocol==='responses'?{model:params.model,instructions:params.prompt,input:params.input,max_output_tokens:params.maxTokens,reasoning:{effort:params.reasoning},store:false,stream:params.stream}:{model:params.model,messages:[{role:'system',content:params.prompt},{role:'user',content:params.input}],max_tokens:params.maxTokens,stream:params.stream,...(params.stream?{stream_options:{include_usage:true}}:{}),...(data.provider==='deepseek'?{thinking:{type:params.reasoning==='none'?'disabled':'enabled'},reasoning_effort:params.reasoning}:params.reasoning!=='none'?{reasoning_effort:params.reasoning}:{})})}:{}),signal:controller.signal,redirect:'error',cache:'no-store'});
    let isStream=false;if(params?.stream&&response.ok){const prepared=await providerResponse(response,controller.signal);response=prepared.response;isStream=prepared.stream;}
    if(isStream){
      handedOff=true;
      return generationStream(onText=>readProviderStream(response,destination.protocol,controller.signal,key,onText),()=>controller.abort(),error=>({type:'error',error:timeout?{code:'timeout',message:'提供商请求超过 110 秒，已终止',retryable:true}:controller.signal.aborted?{code:'cancelled',message:'请求已取消',retryable:false}:error instanceof StreamFailure?{code:error.code,message:redact(error.message),retryable:error.retryable}:{code:'stream_interrupted',message:'提供商流式连接中断，请重试或关闭流式输出',retryable:true}}),cleanup);
    }
    let result:any;try{result=JSON.parse(await limitedText(response.body,1500000));}catch(error){if(controller.signal.aborted)throw error;if(response.ok)return fail('invalid_response','提供商返回内容过大或格式异常',502);}
    if(!response.ok){const code=String(result?.error?.code??'');
      if(response.status===401)return fail('invalid_key',`${destination.name} 接口不接受此密钥，请确认密钥与接口提供商对应、没有多余空格且未撤销`,401);
      if(code==='insufficient_quota'||code==='billing_hard_limit_reached'||response.status===402)return fail('insufficient_quota','API 账户余额不足或用量额度已耗尽，请检查提供商账户',402);
      if(response.status===429)return fail('rate_limit','提供商限流，请降低并发并稍后重试',429,true);
      if(response.status===403||response.status===404)return fail('model_access','该模型不可用、无权限或地区受限；请加载账户模型并重新选择',response.status);
      if(response.status===400)return fail('provider_parameters',params?.stream?'提供商不接受此模型或流式参数，请尝试关闭流式输出或调整模型参数':'提供商不接受此模型或生成参数，请尝试调整模型、推理强度或输出上限',400);
      return fail('provider_error','提供商暂时无法处理请求，请稍后重试',502,true);
    }
    if(!params){if(!Array.isArray(result.data))return fail('invalid_response','模型列表格式异常',502);return json({models:result.data.map((m:any)=>m.id).filter((s:any)=>typeof s==='string'&&s!==key&&/^[a-zA-Z0-9._:/-]{1,100}$/.test(s)).slice(0,1000)});}
    if(result.status==='incomplete'||result.choices?.[0]?.finish_reason==='length')return fail('incomplete','输出被截断或推理已用完输出额度，请增加输出上限或降低推理强度',422);
    if(result.status==='failed'||result.error)return fail('generation_failed','提供商未能完成生成，请稍后重试',502,true);
    const text=destination.protocol==='chat'?(typeof result.choices?.[0]?.message?.content==='string'?result.choices[0].message.content:''):Array.isArray(result.output)?result.output.flatMap((o:any)=>Array.isArray(o.content)?o.content:[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).filter((s:any)=>typeof s==='string').join('\n'):typeof result.output_text==='string'?result.output_text:'';
    if(!text)return fail('empty_output','模型未返回文本，可能拒绝回答或输出额度不足',422);
    if(text.length>32000)return fail('output_size','输出超过本站的 32000 字符限制，请降低输出上限',422);
    return json({text:redact(text),usage:{input:Number.isFinite(result.usage?.input_tokens??result.usage?.prompt_tokens)?result.usage.input_tokens??result.usage.prompt_tokens:0,output:Number.isFinite(result.usage?.output_tokens??result.usage?.completion_tokens)?result.usage.output_tokens??result.usage.completion_tokens:0}});
  }catch(error){const code=String((error as {cause?:{code?:unknown};code?:unknown})?.cause?.code??(error as {code?:unknown})?.code??'');const reasons:Record<string,string>={ECONNRESET:'连接被中断',ETIMEDOUT:'连接超时',ENOTFOUND:'DNS 解析失败',ECONNREFUSED:'连接被拒绝',UND_ERR_CONNECT_TIMEOUT:'连接超时',UND_ERR_SOCKET:'连接被中断'};return fail(timeout?'timeout':controller.signal.aborted?'cancelled':'network',timeout?'提供商请求超过 110 秒，已终止':controller.signal.aborted?'请求已取消':reasons[code]?`无法连接提供商：${reasons[code]}，请稍后重试`:'无法连接提供商，请检查网络或稍后重试',timeout?504:controller.signal.aborted?499:502,timeout||!controller.signal.aborted);}
  finally{if(!handedOff)cleanup();}
}
