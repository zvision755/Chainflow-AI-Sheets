import { randomBytes } from 'node:crypto';
import { mkdirSync,writeFileSync,existsSync,chmodSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const file=resolve(process.argv[2]??process.env.CHAINFLOW_MASTER_KEY_PATH??'local-only/secrets/master-key');
if(existsSync(file)){console.log('Existing master key retained.');process.exit(0);}
mkdirSync(dirname(file),{recursive:true,mode:0o700});
writeFileSync(file,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
if(process.platform==='win32'){
  const identity=spawnSync('powershell',['-NoProfile','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8'});
  if(identity.status!==0)throw Error('Could not obtain Windows identity to restrict master key permissions');
  const permissions=spawnSync('icacls',[file,'/inheritance:r','/grant:r',`*${identity.stdout.trim()}:(F)`,'*S-1-5-18:(F)'],{stdio:'ignore'});
  if(permissions.status!==0)throw Error('Could not restrict master key permissions');
}else chmodSync(file,0o600);
console.log('Master key created with restricted permissions. Back it up with the database; key contents are not displayed.');
