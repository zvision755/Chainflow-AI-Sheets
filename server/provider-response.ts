// Some compatible gateways omit the SSE media type. Inspect a bounded prefix,
// then replay the original bytes without collecting the whole response.
import { StreamFailure } from '../core/stream-protocol';
export async function providerResponse(response:Response,signal:AbortSignal):Promise<{response:Response;stream:boolean}> {
  if(response.headers.get('content-type')?.toLowerCase().includes('text/event-stream'))return {response,stream:true};
  if(!response.body)return {response,stream:false};
  const reader=response.body.getReader(),chunks:Uint8Array[]=[],decoder=new TextDecoder();let prefix='',ended=false,released=false;
  const release=()=>{if(released)return;released=true;signal.removeEventListener('abort',cancel);reader.releaseLock();};
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{
    while(!ended&&prefix.trim().length<6&&prefix.length<1024){
      if(signal.aborted)throw new StreamFailure('请求已取消','cancelled');
      const part=await reader.read();if(signal.aborted)throw new StreamFailure('请求已取消','cancelled');
      ended=part.done;if(!part.done){chunks.push(part.value);prefix+=decoder.decode(part.value.slice(0,1024-prefix.length),{stream:true});}
      if(/^[\s\uFEFF]*[\[{]/.test(prefix))break;
    }
  }catch(error){await reader.cancel().catch(()=>{});release();throw error;}
  const stream=/^[\s\uFEFF]*(?:data:|event:|:)/.test(prefix);
  const body=new ReadableStream<Uint8Array>({
    async pull(controller){try{if(chunks.length){controller.enqueue(chunks.shift()!);return;}if(ended){release();controller.close();return;}const part=await reader.read();if(part.done){ended=true;release();controller.close();}else controller.enqueue(part.value);}catch(error){release();controller.error(error);}},
    async cancel(){await reader.cancel().catch(()=>{});release();},
  });
  return {response:new Response(body,{status:response.status,headers:response.headers}),stream};
}
