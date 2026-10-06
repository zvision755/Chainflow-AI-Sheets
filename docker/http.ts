import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, proxy } from '../server/proxy';
import { localAgentRequest } from '../build/local-agent-http';
import type { CodexBridge } from '../build/codex-bridge';
import { createLocalTtsHandler } from '../build/local-tts-http';
import type {KokoroState} from '../macos/kokoro';
type TtsRuntime={status():KokoroState;load(remember:boolean):Promise<KokoroState>;unload():Promise<KokoroState>};

function isPrivateIPv4(hostname:string){
  const parts=hostname.split('.');
  if(parts.length!==4||parts.some(part=>!/^\d{1,3}$/.test(part)||Number(part)>255))return false;
  const [a,b]=parts.map(Number);
  return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
}
function allowedHostname(hostname:string,allowLan:boolean){
  return ['127.0.0.1','localhost','[::1]'].includes(hostname)||(allowLan&&isPrivateIPv4(hostname));
}

export function hostTtsFetch(fetcher:typeof fetch=fetch):typeof fetch {
  return (input,init)=>{const url=new URL(String(input));if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Unexpected TTS destination');url.hostname='host.docker.internal';return fetcher(url,init);};
}
export function createDockerHandler(options:{bridge?:Pick<CodexBridge,'status'|'generate'>;fetcher?:typeof fetch;ttsFetcher?:typeof fetch;builtinTtsFetcher?:typeof fetch;runtime?:'docker'|'macos';builtinTtsUrl?:string;builtinTts?:boolean;ttsRuntime?:TtsRuntime;login?:()=>Promise<{authUrl:string}>;logout?:()=>Promise<void>;allowLan?:boolean}={}) {
  const runtime=options.runtime??'docker';
  const tts=createLocalTtsHandler((input,init)=>['127.0.0.1','localhost','[::1]'].includes(new URL(String(input)).hostname) ? (options.ttsFetcher??hostTtsFetch())(input,init) : (options.fetcher??fetch)(input,init),90000,{url:options.builtinTtsUrl??'http://kokoro:8880/v1',fetcher:options.builtinTtsFetcher??fetch});
  return async(request:Request):Promise<Response|null>=>{
    const url=new URL(request.url);
    // LAN requests are opt-in and accepted only for RFC1918 private IPv4 addresses.
    if(!allowedHostname(url.hostname,options.allowLan===true))return json({error:{code:'host',message:'此主机地址未获准访问',retryable:false}},403);
    if(url.pathname==='/healthz')return request.method==='GET'?json({ok:true,runtime}):json({},405);
    if(url.pathname==='/api/capabilities')return request.method==='GET'?json({providers:['openai','deepseek','custom'],codex:!!options.bridge,tts:true,runtime,builtinTts:options.builtinTts!==false,ttsEngine:runtime==='macos'?'mlx':'cpu',ttsControl:!!options.ttsRuntime,codexLogin:!!options.login}):json({},405);
    if(!url.pathname.startsWith('/api/'))return null;
    if(request.method!=='POST')return json({error:{code:'method',message:'请使用 POST 请求',retryable:false}},405);
    if(url.pathname==='/api/local-tts/runtime'&&options.ttsRuntime){
      if(request.headers.get('origin')!==url.origin||request.headers.has('authorization')||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:{code:'origin',message:'模型控制只接受本机同源请求',retryable:false}},403);
      let data:{action?:unknown;autoLoad?:unknown;acceptedMemoryWarning?:unknown};
      try{data=await request.json()as typeof data;if(!data||Array.isArray(data)||typeof data!=='object'||Object.keys(data).some(k=>!['action','autoLoad','acceptedMemoryWarning'].includes(k))||!['inspect','load','unload'].includes(String(data.action))||(data.action==='load'&&(typeof data.autoLoad!=='boolean'||data.acceptedMemoryWarning!==true)))throw Error();}catch{return json({error:{code:'parameters',message:'请确认内存占用提示后启用模型',retryable:false}},400);}
      try{return json(data.action==='load'?await options.ttsRuntime.load(data.autoLoad as boolean):data.action==='unload'?await options.ttsRuntime.unload():options.ttsRuntime.status());}catch{return json({error:{code:'tts_load',message:'模型加载失败，请确认是 M 系列 Mac 并稍后重试',retryable:true}},503);}
    }
    if(url.pathname==='/api/local-agent/login'||url.pathname==='/api/local-agent/logout'){
      if(request.headers.get('origin')!==url.origin||request.headers.has('authorization')||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:{code:'origin',message:'登录只接受本机同源页面请求',retryable:false}},403);
      try{const data=await request.json();if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length)throw Error();}catch{return json({error:{code:'parameters',message:'登录参数无效',retryable:false}},400);}
      if(url.pathname.endsWith('/login')&&options.login){try{return json(await options.login());}catch{return json({error:{code:'codex_login',message:'无法开始 ChatGPT 登录，请检查网络及登录回调端口是否被占用',retryable:true}},503);}}
      if(url.pathname.endsWith('/logout')&&options.logout){try{await options.logout();return json({ok:true});}catch{return json({error:{code:'codex_logout',message:'退出登录失败，请稍后重试',retryable:true}},503);}}
      return json({error:{code:'not_available',message:'当前版本不提供应用内登录',retryable:false}},404);
    }
    if(url.pathname==='/api/generate'||url.pathname==='/api/models')return proxy(request,url.pathname==='/api/generate'?'generate':'models',options.fetcher);
    if(url.pathname==='/api/local-agent/status'||url.pathname==='/api/local-agent/generate')return options.bridge?localAgentRequest(request,url.pathname.endsWith('/status')?'status':'generate',options.bridge):json({error:{code:'codex_disabled',message:'容器 Codex 已关闭',retryable:false}},503);
    if(url.pathname==='/api/local-tts/voices'||url.pathname==='/api/local-tts/speech'){
      if(options.ttsRuntime&&!options.ttsRuntime.status().loaded){try{if(((await request.clone().json())as{url?:unknown})?.url==='builtin')return json({error:{code:'tts_model_unloaded',message:options.ttsRuntime.status().state==='loading'?'内置模型正在加载，请稍候':'内置模型未加载，请在「配置 TTS」中手动启用',retryable:false}},503);}catch{}}
      if(options.builtinTts===false){try{if(((await request.clone().json()) as {url?:unknown})?.url==='builtin')return json({error:{code:'tts_not_bundled',message:'精简版不含 Kokoro 模型，请配置第三方 TTS，或安装包含 MLX 模型的完整版',retryable:false}},503);}catch{}}
      return tts(request,url.pathname.endsWith('/voices')?'voices':'speech');
    }
    return json({error:{code:'not_found',message:'接口不存在',retryable:false}},404);
  };
}

export async function serveDockerRequest(req:IncomingMessage,res:ServerResponse,handler:ReturnType<typeof createDockerHandler>,fallback:(req:IncomingMessage,res:ServerResponse)=>void,allowLan=false) {
  const abort=new AbortController();req.once('aborted',()=>abort.abort());res.once('close',()=>{if(!res.writableEnded)abort.abort();});
  try{
    const host=req.headers.host??'';
    let hostname='';try{hostname=new URL(`http://${host}`).hostname;}catch{}
    if(!allowedHostname(hostname,allowLan)){res.writeHead(403,{'Cache-Control':'no-store'});res.end();return;}
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
