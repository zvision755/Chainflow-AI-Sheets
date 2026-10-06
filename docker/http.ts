import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, proxy } from '../server/proxy';
import { localAgentRequest } from '../build/local-agent-http';
import type { CodexBridge } from '../build/codex-bridge';
import { createLocalTtsHandler } from '../build/local-tts-http';

export function hostTtsFetch(fetcher:typeof fetch=fetch):typeof fetch {
  return (input,init)=>{const url=new URL(String(input));if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Unexpected TTS destination');url.hostname='host.docker.internal';return fetcher(url,init);};
}
export function createDockerHandler(options:{bridge?:Pick<CodexBridge,'status'|'generate'>;fetcher?:typeof fetch;ttsFetcher?:typeof fetch;builtinTtsFetcher?:typeof fetch}={}) {
  const tts=createLocalTtsHandler((input,init)=>['127.0.0.1','localhost','[::1]'].includes(new URL(String(input)).hostname) ? (options.ttsFetcher??hostTtsFetch())(input,init) : (options.fetcher??fetch)(input,init),90000,{url:'http://kokoro:8880/v1',fetcher:options.builtinTtsFetcher??fetch});
  return async(request:Request):Promise<Response|null>=>{
    const url=new URL(request.url);
    // Only localhost browser access. Port publishing is additionally loopback-only.
    if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))return json({error:{code:'host',message:'Docker 版仅接受本机访问',retryable:false}},403);
    if(url.pathname==='/healthz')return request.method==='GET'?json({ok:true,runtime:'docker'}):json({},405);
    if(url.pathname==='/api/capabilities')return request.method==='GET'?json({providers:['openai','deepseek','custom'],codex:!!options.bridge,tts:true,runtime:'docker'}):json({},405);
    if(!url.pathname.startsWith('/api/'))return null;
    if(request.method!=='POST')return json({error:{code:'method',message:'请使用 POST 请求',retryable:false}},405);
    if(url.pathname==='/api/generate'||url.pathname==='/api/models')return proxy(request,url.pathname==='/api/generate'?'generate':'models',options.fetcher);
    if(url.pathname==='/api/local-agent/status'||url.pathname==='/api/local-agent/generate')return options.bridge?localAgentRequest(request,url.pathname.endsWith('/status')?'status':'generate',options.bridge):json({error:{code:'codex_disabled',message:'容器 Codex 已关闭',retryable:false}},503);
    if(url.pathname==='/api/local-tts/voices'||url.pathname==='/api/local-tts/speech')return tts(request,url.pathname.endsWith('/voices')?'voices':'speech');
    return json({error:{code:'not_found',message:'接口不存在',retryable:false}},404);
  };
}

export async function serveDockerRequest(req:IncomingMessage,res:ServerResponse,handler:ReturnType<typeof createDockerHandler>,fallback:(req:IncomingMessage,res:ServerResponse)=>void) {
  const abort=new AbortController();req.once('aborted',()=>abort.abort());res.once('close',()=>{if(!res.writableEnded)abort.abort();});
  try{
    const host=req.headers.host??'';
    if(!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)){res.writeHead(403,{'Cache-Control':'no-store'});res.end();return;}
    const path=new URL(req.url??'/',`http://${host}`).pathname;
    if(!path.startsWith('/api/')&&path!=='/healthz'){fallback(req,res);return;}
    const chunks:Buffer[]=[];let bytes=0;
    for await(const part of req){bytes+=part.length;if(bytes>70000){res.writeHead(413,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{code:'request_size',message:'请求超过 70 KB',retryable:false}}));return;}chunks.push(part);}
    const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(typeof v==='string')headers.set(k,v);
    const response=await handler(new Request(`http://${host}${req.url}`,{method:req.method,headers,signal:abort.signal,...(!['GET','HEAD'].includes(req.method??'GET')?{body:Buffer.concat(chunks).toString('utf8')}:{})}));
    if(!response){fallback(req,res);return;}
    res.statusCode=response.status;response.headers.forEach((v,k)=>res.setHeader(k,v));
    if(!response.body){res.end();return;}if(response.headers.get('content-type')?.includes('text/event-stream'))res.flushHeaders();
    await new Promise<void>((resolve,reject)=>{const body=Readable.fromWeb(response.body as any);body.once('error',reject);res.once('finish',resolve);res.once('close',()=>{body.destroy();resolve();});body.pipe(res);});
  }catch{abort.abort();if(res.headersSent)res.destroy();else if(!res.writableEnded){res.writeHead(502,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{code:'docker_network',message:'容器请求失败，请检查网络或代理设置',retryable:true}}));}}
}
