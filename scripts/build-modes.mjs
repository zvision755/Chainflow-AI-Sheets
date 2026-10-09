import {spawn} from 'node:child_process';
async function run(file,args=[],env={}){
  const child=spawn(process.execPath,[file,...args],{env:{...process.env,...env},stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)throw Error('Mode build failed: '+file);
}
await run('docker/build.mjs',[],{CHAINFLOW_DEPLOYMENT:'server',CHAINFLOW_BUILD_DIR:'dist-server'});
await run('docker/build.mjs',[],{CHAINFLOW_DEPLOYMENT:'local-docker',CHAINFLOW_BUILD_DIR:'dist-local-docker'});
await run('node_modules/vite/bin/vite.js',['build','--config','static/vite.config.ts']);
