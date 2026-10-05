import { spawn } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const origin='http://127.0.0.1:3002';
try{
  const response=await fetch(origin+'/api/capabilities',{signal:AbortSignal.timeout(1500)});
  const data=await response.json();
  if(response.ok&&data.providers?.includes('custom')){console.log(`预览已运行：${origin}/`);process.exit(0);}
  throw Error('端口 3002 已被其他服务占用');
}catch(error){if(error.message==='端口 3002 已被其他服务占用')throw error;}
mkdirSync(new URL('../outputs/',import.meta.url),{recursive:true});
const log=openSync(new URL('../outputs/preview.log',import.meta.url),'a');
const child=spawn(process.execPath,['scripts/run-framework.mjs','dev','--host','127.0.0.1','--port','3002'],{cwd:root,detached:true,stdio:['ignore',log,log]});
child.unref();writeFileSync(new URL('../outputs/preview.pid',import.meta.url),String(child.pid));
console.log(`预览已启动：${origin}/（进程 ${child.pid}，日志 outputs/preview.log）`);
