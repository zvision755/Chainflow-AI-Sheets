// Development tooling only. Never imported by app routes or the production Worker.
import type { Plugin } from 'vite';
import { execFileSync } from 'node:child_process';
import { ProxyAgent } from 'undici';
import { json, proxy } from '../server/proxy';
import { join } from 'node:path';
import { CodexBridge } from './codex-bridge';
import { localAgentRequest, localRequestAllowed } from './local-agent-http';
function systemProxy(): string | undefined {
  if(process.env.CHAINFLOW_DEV_PROXY==='off')return undefined;
  const explicit=process.env.CHAINFLOW_DEV_PROXY;
  if(explicit){const u=new URL(explicit);if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw new Error('本地开发代理仅允许回环地址');return u.href;}
  if(process.platform!=='darwin')return undefined;
  try{const text=execFileSync('/usr/sbin/scutil',['--proxy'],{encoding:'utf8',timeout:2000});if(!/HTTPSEnable\s*:\s*1/.test(text))return undefined;const host=text.match(/HTTPSProxy\s*:\s*(\S+)/)?.[1],port=text.match(/HTTPSPort\s*:\s*(\d+)/)?.[1];if(host&&port&&['localhost','127.0.0.1'].includes(host))return `http://${host}:${port}`;}catch{}return undefined;
}
export function localApi(): Plugin {
  return {name:'chainflow-local-api',apply:'serve',configureServer(server){
    const url=systemProxy();const agent=url?new ProxyAgent(url):undefined;
    const codex=new CodexBridge(join(server.config.root,'outputs/codex-workspace'),url);
    const forward:typeof fetch=(input,init)=>fetch(input,{...init,...(agent?{dispatcher:agent}:{})} as RequestInit);
    server.middlewares.use(async(req,res,next)=>{
      const path=req.url?.split('?')[0];if(!['/api/generate','/api/models','/api/capabilities','/api/local-agent/status','/api/local-agent/generate'].includes(path??''))return next();
      const host=req.headers.host??'127.0.0.1:3002';
      if(!localRequestAllowed(host,req.socket.remoteAddress)){res.statusCode=403;res.end();return;}
      if(path==='/api/capabilities'&&req.method==='GET'){const response=json({providers:['openai','deepseek','custom'],codex:true,localAgentTransport:'codex-app-server'});response.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await response.text());return;}
      if(req.method!=='POST'){res.statusCode=405;res.end();return;}
      const abort=new AbortController();req.once('aborted',()=>abort.abort());res.once('close',()=>{if(!res.writableEnded)abort.abort();});
      try{
        const chunks:Uint8Array[]=[];let size=0;
        for await (const chunk of req){size+=chunk.length;if(size>70000){res.statusCode=413;res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({error:{code:'request_size',message:'请求超过 70 KB',retryable:false}}));return;}chunks.push(chunk);}
        const headers=new Headers();for(const [name,value] of Object.entries(req.headers)){if(typeof value==='string')headers.set(name,value);}
        const request=new Request(`http://${host}${path}`,{method:'POST',headers,body:Buffer.concat(chunks).toString('utf8'),signal:abort.signal});
        const response=path?.startsWith('/api/local-agent/')
          ? await localAgentRequest(request,path.endsWith('/status')?'status':'generate',codex)
          : await proxy(request,path==='/api/generate'?'generate':'models',forward);
        res.statusCode=response.status;response.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await response.text());
      }catch{const response=json({error:{code:'local_network',message:'本地网络请求失败，请检查系统代理设置',retryable:true}},502);if(!res.writableEnded){res.statusCode=response.status;response.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await response.text());}}
    });
    server.httpServer?.once('close',()=>{codex.close();void agent?.close();});
  }};
}
