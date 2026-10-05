import { streamFrame, type StreamEvent } from '../core/stream-protocol';
import type { GenerateResult } from '../core/types';

export function generationStream(run:(onText:(text:string)=>void)=>Promise<GenerateResult>,cancel:()=>void,error:(error:unknown)=>StreamEvent&{type:'error'},cleanup:()=>void=()=>{}) {
  let closed=false,last='';
  const body=new ReadableStream<Uint8Array>({
    async start(controller){
      const send=(event:StreamEvent)=>{if(!closed)controller.enqueue(streamFrame(event));};
      const text=(value:string)=>{if(value===last)return;send(value.startsWith(last)?{type:'delta',delta:value.slice(last.length)}:{type:'text',text:value});last=value;};
      try{const result=await run(text);text(result.text);send({type:'done',result});}catch(e){send(error(e));}
      finally{if(!closed){closed=true;controller.close();}cleanup();}
    },
    cancel(){closed=true;cancel();cleanup();},
  });
  return new Response(body,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Accel-Buffering':'no'}});
}
