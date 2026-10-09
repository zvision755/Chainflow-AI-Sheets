import { spawnSync } from 'node:child_process';
import { writeFileSync,unlinkSync } from 'node:fs';
import { join } from 'node:path';
const [mode,container,remote,directory]=process.argv.slice(2);
if(!['fetch','push'].includes(mode)||!container||!remote||!directory)throw Error('Invalid archive arguments');
function run(command,args,input){const result=spawnSync(command,args,{input,maxBuffer:256*1024*1024});if(result.status!==0)throw Error('Archive transfer failed');return result.stdout;}
if(mode==='fetch'){
  const archive=join(directory,'snapshot-transfer.tar');
  writeFileSync(archive,run('docker',['exec',container,'tar','-C',remote,'-cf','-','.']),{mode:0o600,flag:'wx'});
  run('tar',['-xf',archive,'-C',directory]);unlinkSync(archive);
}else{
  const archive=run('tar',['-cf','-','-C',directory,'personal.sqlite','auth.json','master-key','manifest.json']);
  run('docker',['exec','-i',container,'tar','--no-same-owner','-C',remote,'-xf','-'],archive);
}
