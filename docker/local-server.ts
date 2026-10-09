import {startProdServer} from 'vinext/server/prod-server';
import {ProxyAgent} from 'undici';
import {createDockerHandler,serveDockerRequest} from './http';
// This entry never imports authentication, SQLite, master keys or Codex credentials.
const port=Number(process.env.PORT??8080);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid PORT');
const proxyUrl=process.env.CHAINFLOW_HTTP_PROXY||undefined;
if(proxyUrl){const u=new URL(proxyUrl);if(!['http:','https:'].includes(u.protocol)||!['host.docker.internal','localhost','127.0.0.1'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Invalid local proxy');}
const dispatcher=proxyUrl?new ProxyAgent(proxyUrl):undefined;
const fetcher:typeof fetch=(input,init)=>{const url=new URL(String(input));const local=url.hostname==='host.docker.internal';return fetch(input,{...init,...(dispatcher&&!local?{dispatcher}:{})} as RequestInit);};
const allowLan=process.env.CHAINFLOW_LAN_ACCESS==='true';
const handler=createDockerHandler({fetcher,allowLan,builtinTts:false});
const {server}=await startProdServer({port,host:'0.0.0.0',outDir:'dist-docker',silent:true});
const fallback=server.listeners('request')[0] as Parameters<typeof serveDockerRequest>[3];
server.removeAllListeners('request');server.on('request',(req,res)=>void serveDockerRequest(req,res,handler,fallback,allowLan,false));
server.requestTimeout=150000;server.headersTimeout=15000;server.maxHeadersCount=50;
console.log('ChainFlow Local Docker listening on '+port+'; browser storage; Codex disabled');
process.on('SIGTERM',()=>{void dispatcher?.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();});
