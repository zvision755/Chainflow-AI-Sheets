/** Isolated CI fixture. Never loads deployment .env, user volumes or real credentials. */
import {startProdServer} from 'vinext/server/prod-server';
import {createDockerHandler,serveDockerRequest} from '../docker/http';
import {AdminAuth} from '../server/admin-auth';
import {PersonalStore} from '../server/personal-store';
import {mkdtempSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
const mode=process.argv[2]??'legacy',port=Number(process.env.PORT??(mode==='server'?3006:3002));
if(!['legacy','server'].includes(mode))throw Error('Invalid test mode');
let auth:AdminAuth|undefined,store:PersonalStore|undefined;
if(mode==='server'){const dir=mkdtempSync(join(tmpdir(),'chainflow-test-'));chmodSync(dir,0o700);auth=new AdminAuth(join(dir,'auth.json'));store=new PersonalStore(join(dir,'personal.sqlite'),randomBytes(32));}
const fakeFetch:typeof fetch=async(input)=>new URL(String(input)).pathname.endsWith('/audio/speech')?new Response(Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),Buffer.alloc(32)]),{headers:{'content-type':'audio/wav'}}):new Response(JSON.stringify({output_text:'测试生成结果',usage:{input_tokens:2,output_tokens:3}}));
const bridge=mode==='server'?{status:async()=>({connected:true as const,auth:'chatgpt' as const,models:[{id:'gpt-6-luna',name:'Test',efforts:['low'],defaultEffort:'low'}],defaultModel:'gpt-6-luna',plan:'test',version:'test',transport:'app-server' as const}),generate:async(_input:unknown,_signal:AbortSignal,onText?:(s:string)=>void)=>{onText?.('Agent ');await new Promise(r=>setTimeout(r,30));onText?.('Agent 测试结果');return {text:'Agent 测试结果',usage:{input:2,output:3}};}}:undefined;
const handler=createDockerHandler({auth,store,bridge,...(mode==='server'?{fetcher:fakeFetch}:{}),builtinTts:mode==='legacy'});
const {server}=await startProdServer({port,host:'127.0.0.1',outDir:process.env.CHAINFLOW_BUILD_DIR??'dist-server',silent:true});
const fallback=server.listeners('request')[0] as Parameters<typeof serveDockerRequest>[3];server.removeAllListeners('request');server.on('request',(req,res)=>void serveDockerRequest(req,res,handler,fallback,false,mode==='server'));
console.log('Isolated '+mode+' fixture ready on '+port);
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
