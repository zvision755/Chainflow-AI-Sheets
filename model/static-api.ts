import {providerRequest,json} from '../core/provider-transport';
import {externalTtsUrl} from '../core/tts';
/** Browser-only adapter. Shared Web API protocol code runs here; no hosted relay exists. */
export async function staticApi(input:RequestInfo|URL,init:RequestInit|undefined,base:string,fetcher:typeof fetch=fetch):Promise<Response>{
  const request=new Request(new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,base),init);
  const path=new URL(request.url).pathname;
  if(path==='/api/capabilities')return json({storage:false,codex:false,tts:true,builtinTts:false,runtime:'local-static',providers:['openai','deepseek','custom']});
  if(path==='/api/auth/status')return json({enabled:false});
  if(path==='/api/generate'||path==='/api/models'){
    // A local Request envelope invokes shared validation/protocol handling. Only the reviewed provider target is fetched.

    const result=await providerRequest(request,path.endsWith('/models')?'models':'generate',fetcher,false);
    if(!result.ok){const data=await result.clone().json().catch(()=>null) as {error?:{code?:string}}|null;if(data?.error?.code==='network')return json({error:{code:'cors_or_network',message:'浏览器无法直连此 API：请检查网络及提供商 CORS 支持。静态版没有代理；可改用 Local Docker。',retryable:false}},502);}
    return result;
  }
  if(path==='/api/local-tts/speech'){
    let data:{url:string;model:string;input:string;voice:string;speed:number};
    try{data=await request.json();if(typeof data.input!=='string'||!data.input.trim()||data.input.length>4096||!Number.isFinite(data.speed)||data.speed<0.25||data.speed>4||!/^[a-zA-Z0-9._:/-]{1,100}$/.test(data.model)||!/^[a-zA-Z0-9._:/-]{1,120}$/.test(data.voice))throw Error();const url=new URL(externalTtsUrl(data.url));if(url.protocol!=='https:')throw Error();data.url=url.href;}catch{return json({error:{code:'tts_unavailable',message:'静态版仅允许已审阅的 HTTPS TTS API；火山免配置、Kokoro 与本机接口不可用'}},400);}
    const authorization=request.headers.get('authorization')??'';if(!/^Bearer [a-zA-Z0-9_.-]{1,300}$/.test(authorization))return json({error:{code:'missing_key',message:'请填写第三方 TTS API key'}},401);
    try{const response=await fetcher(data.url.replace(/\/$/,'')+'/audio/speech',{method:'POST',headers:{'Content-Type':'application/json',Authorization:authorization},body:JSON.stringify({model:data.model,input:data.input,voice:data.voice,speed:data.speed,response_format:'mp3'}),signal:request.signal,redirect:'error',credentials:'omit',cache:'no-store'});if(!response.ok){await response.body?.cancel();return json({error:{code:'tts_provider',message:'TTS 提供商拒绝请求，请检查密钥、模型与音色'}},response.status);}return response;}catch{return json({error:{code:'tts_cors',message:'浏览器无法直连 TTS，请检查 CORS 与网络，或改用浏览器原生朗读'}},502);}
  }
  return json({error:{code:'static_unavailable',message:'此能力需要受保护的 Server 或 Local Docker，静态版不提供'}},404);
}
