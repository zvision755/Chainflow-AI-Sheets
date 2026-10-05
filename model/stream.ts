import { sseEvents, StreamFailure } from '../core/stream-protocol';
import type { GenerateResult } from '../core/types';
import { ModelError } from './errors';

export async function readGeneration(response:Response,signal:AbortSignal,onText?:(text:string)=>void):Promise<GenerateResult> {
  if(response.ok&&response.headers.get('content-type')?.includes('text/event-stream')){
    let text='';
    try{
      for await(const frame of sseEvents(response.body,signal)){
        let event:any;try{event=JSON.parse(frame.data);}catch{throw new ModelError('流式数据格式不正确','invalid_response');}
        if(event.type==='error')throw new ModelError(event.error?.message??'流式生成失败',event.error?.code??'generation_failed',event.error?.retryable===true);
        if(event.type==='delta'&&typeof event.delta==='string')text+=event.delta;
        else if(event.type==='text'&&typeof event.text==='string')text=event.text;
        else if(event.type==='done'){
          const result=event.result;
          if(typeof result?.text!=='string'||!result.text.trim()||result.text.length>32000||!Number.isFinite(result.usage?.input)||!Number.isFinite(result.usage?.output))throw new ModelError('流式完成结果无效','invalid_response');
          onText?.(result.text);return result;
        }else throw new ModelError('流式事件格式不正确','invalid_response');
        if(text.length>32000)throw new ModelError('流式输出超过 32000 字符限制','output_size');
        onText?.(text);
      }
      throw new ModelError('流式连接提前结束，未收到完成标记；请重试或关闭流式输出','stream_interrupted',true);
    }catch(error){
      if(signal.aborted)throw new ModelError('流式请求已取消或超时','cancelled');
      if(error instanceof ModelError)throw error;
      if(error instanceof StreamFailure)throw new ModelError(error.message,error.code,error.retryable);
      throw new ModelError('流式连接中断，请重试或关闭流式输出','stream_interrupted',true);
    }
  }
  const data=await response.json().catch(()=>null) as any;
  if(!response.ok)throw new ModelError(data?.error?.message??'服务端返回无效响应',data?.error?.code??'server',data?.error?.retryable??false);
  if(typeof data?.text!=='string'||!data.text.trim()||!data.usage)throw new ModelError('服务端返回的数据格式不正确','invalid_response');
  return data;
}
