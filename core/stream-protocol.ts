import type { GenerateResult } from './types';

export class StreamFailure extends Error {
  constructor(message:string,public code:string,public retryable=false){super(message);}
}
export type StreamEvent={type:'delta';delta:string}|{type:'text';text:string}|{type:'done';result:GenerateResult}|{type:'error';error:{message:string;code:string;retryable:boolean}};
export const streamFrame=(event:StreamEvent)=>new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
export async function* sseEvents(body:ReadableStream<Uint8Array>|null,signal:AbortSignal,maxBytes=1500000):AsyncGenerator<{event:string;data:string}> {
  if(!body)throw new StreamFailure('流式响应没有内容','invalid_response');
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,event='',data:string[]=[];
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{
    while(true){
      if(signal.aborted)throw new StreamFailure('流式请求已取消或超时','cancelled');
      const chunk=await reader.read();if(signal.aborted)throw new StreamFailure('流式请求已取消或超时','cancelled');
      if(!chunk.done){bytes+=chunk.value.byteLength;if(bytes>maxBytes)throw new StreamFailure('流式响应超过本站大小限制','response_size');buffer+=decoder.decode(chunk.value,{stream:true});}else buffer+=decoder.decode();
      if(chunk.done&&buffer&&!buffer.endsWith('\n'))buffer+='\n';
      let newline:number;
      while((newline=buffer.indexOf('\n'))!==-1){
        const line=buffer.slice(0,newline).replace(/\r$/,'');buffer=buffer.slice(newline+1);
        if(!line){if(data.length)yield{event,data:data.join('\n')};event='';data=[];}
        else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));
        else if(line.startsWith('event:'))event=line.slice(6).trim();
      }
      if(chunk.done){if(data.length)yield{event,data:data.join('\n')};break;}
    }
  }finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
