import {spawn} from 'node:child_process';import {resolve} from 'node:path';
const processes=[];
function start(file,args=[],env={}){const child=spawn(process.execPath,[...(file.endsWith('.ts')?['--import','tsx']:[]),resolve(file),...args],{env:{...process.env,...env},stdio:'inherit'});processes.push(child);return child;}
async function ready(url){for(let i=0;i<60;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('Preview unavailable: '+url);}
try{
 start('scripts/mode-preview.ts',['legacy'],{CHAINFLOW_BUILD_DIR:'dist-server',PORT:'3002'});
 start('scripts/mode-preview.ts',['server'],{CHAINFLOW_BUILD_DIR:'dist-server',PORT:'3006'});
 start('node_modules/vite/bin/vite.js',['preview','--config','static/vite.config.ts']);
 await Promise.all([3002,3006].map(port=>ready('http://127.0.0.1:'+port+'/healthz')));await ready('http://127.0.0.1:3005/Chainflow-AI-Sheets/');
 const child=start('node_modules/@playwright/test/cli.js',['test','--project=desktop-chromium','--project=mobile-chromium','--project=server-auth','--project=web','--project=web-mobile']);
 const code=await new Promise(resolve=>child.once('exit',resolve));if(code!==0)throw Error('Cross-mode browser tests failed');
}finally{for(const child of processes)child.kill();}
