// Standalone native app entry. No Docker or developer-machine paths.
import {startProdServer} from 'vinext/server/prod-server';
import {ProxyAgent} from 'undici';
import {join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {CodexBridge} from '../build/codex-bridge';
import {createDockerHandler,serveDockerRequest} from '../docker/http';
import {BundledKokoro} from './kokoro';
const port=Number(process.env.PORT);
const state=process.env.CHAINFLOW_DESKTOP_STATE;
if(!state||!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid desktop startup');
process.env.CODEX_HOME=join(state,'Codex');mkdirSync(process.env.CODEX_HOME,{recursive:true,mode:0o700});
const proxyUrl=process.env.CHAINFLOW_HTTP_PROXY;
if(proxyUrl){const u=new URL(proxyUrl);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Invalid proxy');}
const dispatcher=proxyUrl?new ProxyAgent(proxyUrl):undefined;
const fetcher:typeof fetch=(input,init)=>fetch(input,{...init,...(dispatcher?{dispatcher}:{})}as RequestInit);
const bridge=new CodexBridge(join(state,'AgentWorkspace'),proxyUrl,undefined,true);
const model=process.env.CHAINFLOW_BUNDLED_KOKORO==='1'?new BundledKokoro(process.cwd(),state):undefined;
const handler=createDockerHandler({runtime:'macos',bridge,fetcher,ttsFetcher:fetch,builtinTtsFetcher:model?(input,init)=>model.fetch(input,init):fetch,builtinTts:!!model,ttsRuntime:model,login:()=>bridge.login(),logout:()=>bridge.logout()});
const {server}=await startProdServer({port,host:'127.0.0.1',outDir:'dist-docker',silent:true});
const fallback=server.listeners('request')[0]as any;server.removeAllListeners('request');server.on('request',(req,res)=>void serveDockerRequest(req,res,handler,fallback));
server.requestTimeout=150000;server.headersTimeout=15000;server.maxHeadersCount=50;
console.log('CHAINFLOW_READY');
if(model?.status().autoLoad)void model.load(true).catch(()=>{});
let stopping=false;const stop=()=>{if(stopping)return;stopping=true;bridge.close();void dispatcher?.close();void(model?.unload(false)??Promise.resolve()).finally(()=>server.close(()=>process.exit(0)));setTimeout(()=>process.exit(0),4000).unref();};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
const parent=Number(process.env.CHAINFLOW_PARENT_PID);if(parent>1)setInterval(()=>{try{process.kill(parent,0);}catch{stop();}},2000).unref();
