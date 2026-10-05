import { startProdServer } from 'vinext/server/prod-server';
import { ProxyAgent } from 'undici';
import { CodexBridge } from '../build/codex-bridge';
import { LocalAgentError } from '../build/codex-protocol';
import { createDockerHandler, serveDockerRequest } from './http';

const port=Number(process.env.PORT??8080);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT must be 1024–65535');
const proxyUrl=process.env.CHAINFLOW_HTTP_PROXY||undefined;
if(proxyUrl){const url=new URL(proxyUrl);if(!['http:','https:'].includes(url.protocol)||!['host.docker.internal','127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Invalid local HTTP proxy');}
const dispatcher=proxyUrl?new ProxyAgent(proxyUrl):undefined;
const fetcher:typeof fetch=(input,init)=>fetch(input,{...init,...(dispatcher?{dispatcher}:{})} as RequestInit);
const bridge=process.env.CHAINFLOW_CODEX_ENABLED==='false'?undefined:new CodexBridge('/tmp/chainflow-codex-workspace',proxyUrl);
const containerLoginError=(error:unknown):never=>{if(error instanceof LocalAgentError&&error.code==='codex_login')throw new LocalAgentError('codex_login','容器尚未使用 ChatGPT 订阅登录。请在项目目录运行 npm run docker:login，完成登录后点击重新连接',401);throw error;};
const handler=createDockerHandler({fetcher,bridge:bridge?{status:()=>bridge.status().catch(containerLoginError),generate:(input,signal,onText)=>bridge.generate(input,signal,onText).catch(containerLoginError)}:undefined});
const {server}=await startProdServer({port,host:'0.0.0.0',outDir:'dist-docker',silent:true});
const fallback=server.listeners('request')[0] as (req:any,res:any)=>void;
server.removeAllListeners('request');server.on('request',(req,res)=>void serveDockerRequest(req,res,handler,fallback));
server.requestTimeout=150000;server.headersTimeout=15000;server.maxHeadersCount=50;
console.log(`ChainFlow Docker listening on ${port}`);
let stopping=false;const stop=()=>{if(stopping)return;stopping=true;bridge?.close();void dispatcher?.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
