import { sseEvents, StreamFailure } from '../core/stream-protocol';
import type { GenerateResult, Usage } from '../core/types';

const usage=(raw:any):Usage=>({input:Number.isFinite(raw?.input_tokens??raw?.prompt_tokens)?raw.input_tokens??raw.prompt_tokens:0,output:Number.isFinite(raw?.output_tokens??raw?.completion_tokens)?raw.output_tokens??raw.completion_tokens:0});
const redactCredential=(text:string,key:string)=>key?text.replaceAll(key,'[已隐藏密钥]'):text;
export function providerStreamError(code:unknown):never {
  if(code==='insufficient_quota'||code==='billing_hard_limit_reached')throw new StreamFailure('API 账户余额不足或用量额度已耗尽','insufficient_quota');
  if(code==='invalid_api_key')throw new StreamFailure('提供商不接受此密钥，请检查连接配置','invalid_key');
  if(code==='rate_limit_exceeded'||code==='rate_limit')throw new StreamFailure('提供商限流，请稍后重试','rate_limit',true);
  throw new StreamFailure('提供商未能完成流式生成，请重试或关闭流式输出','generation_failed',true);
}
export async function readProviderStream(response:Response,protocol:string,signal:AbortSignal,key:string,onText:(text:string)=>void):Promise<GenerateResult> {
  let raw='',safe='',pending='',reported:Usage={input:0,output:0},finished=false;
  // Hold any suffix matching the credential prefix, so split chunks cannot leak it.
  function append(delta:string){
    raw+=delta;if(raw.length>32000)throw new StreamFailure('输出超过本站的 32000 字符限制','output_size');
    pending=redactCredential(pending+delta,key);let hold=0;
    for(let i=1;i<key.length&&i<=pending.length;i++)if(pending.endsWith(key.slice(0,i)))hold=i;
    safe+=pending.slice(0,pending.length-hold);pending=hold?pending.slice(-hold):'';onText(safe);
  }
  for await(const frame of sseEvents(response.body,signal)){
    if(frame.data==='[DONE]'){if(protocol==='chat')finished=true;break;}
    let event:any;try{event=JSON.parse(frame.data);}catch{throw new StreamFailure('提供商流式数据格式异常','invalid_response');}
    if(event.error||event.type==='error')providerStreamError(event.error?.code??event.code);
    if(protocol==='chat'){
      if(event.usage)reported=usage(event.usage);
      const choice=event.choices?.[0];
      if(choice?.finish_reason==='length')throw new StreamFailure('输出被截断，请提高输出上限或降低推理强度','incomplete');
      if(choice?.finish_reason&&choice.finish_reason!=='stop')throw new StreamFailure('模型未返回完整文本，可能拒绝回答或请求工具调用','empty_output');
      if(choice?.delta?.refusal)throw new StreamFailure('模型拒绝返回该内容','empty_output');
      if(typeof choice?.delta?.content==='string')append(choice.delta.content);
    }else{
      const type=event.type??frame.event;
      if(type==='response.output_text.delta'&&typeof event.delta==='string')append(event.delta);
      if(type==='response.incomplete')throw new StreamFailure('输出被截断，请提高输出上限或降低推理强度','incomplete');
      if(type==='response.failed')providerStreamError(event.response?.error?.code);
      if(type==='response.completed'){
        if(event.response?.status==='incomplete')throw new StreamFailure('输出被截断，请提高输出上限','incomplete');
        if(event.response?.status==='failed')providerStreamError(event.response?.error?.code);
        const content=Array.isArray(event.response?.output)?event.response.output.flatMap((o:any)=>Array.isArray(o.content)?o.content:[]):[];
        if(content.some((c:any)=>c.type==='refusal'))throw new StreamFailure('模型拒绝返回该内容','empty_output');
        const final=content.filter((c:any)=>c.type==='output_text'&&typeof c.text==='string').map((c:any)=>c.text).join('\n')||event.response?.output_text;
        if(typeof final==='string'){
          if(final.length>32000)throw new StreamFailure('输出超过本站的 32000 字符限制','output_size');
          raw=final;onText(redactCredential(raw,key));
        }
        reported=usage(event.response?.usage);finished=true;break;
      }
    }
  }
  if(!finished)throw new StreamFailure('提供商流式连接提前结束，未收到完成标记；请重试或关闭流式输出','stream_interrupted',true);
  if(!raw.trim())throw new StreamFailure('模型未返回文本，可能拒绝回答或输出额度不足','empty_output');
  const text=redactCredential(raw,key);onText(text);return{text,usage:reported};
}
