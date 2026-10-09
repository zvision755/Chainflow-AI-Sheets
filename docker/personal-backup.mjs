import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash, createDecipheriv } from 'node:crypto';
import { join, resolve } from 'node:path';
const [mode,directory]=process.argv.slice(2);
if(!directory||!['backup','verify'].includes(mode))throw Error('Usage: personal-backup.mjs backup|verify DIRECTORY');
const root=resolve(directory);
const keyFile=process.env.CHAINFLOW_MASTER_KEY_FILE??'/run/secrets/chainflow_master_key';
if(mode==='backup'){
  await mkdir(root,{mode:0o700});
  const db=new DatabaseSync('/data/chainflow/personal.sqlite',{readOnly:true});
  try{await backup(db,join(root,'personal.sqlite'));}finally{db.close();}
  await copyFile('/data/chainflow/auth.json',join(root,'auth.json'));
  await copyFile(keyFile,join(root,'master-key'));
  const manifest={version:1,createdAt:new Date().toISOString(),files:{}};
  for(const name of ['personal.sqlite','auth.json','master-key'])manifest.files[name]=createHash('sha256').update(await readFile(join(root,name))).digest('hex');
  await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
}
const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
if(manifest.version!==1)throw Error('Unknown backup version');
for(const name of ['personal.sqlite','auth.json','master-key'])if(createHash('sha256').update(await readFile(join(root,name))).digest('hex')!==manifest.files[name])throw Error('Backup checksum mismatch');
const key=Buffer.from((await readFile(join(root,'master-key'),'utf8')).trim(),'hex');
if(key.length!==32)throw Error('Missing or invalid master key');
const db=new DatabaseSync(join(root,'personal.sqlite'),{readOnly:true});
try{
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Database integrity check failed');
  if(db.prepare("SELECT value FROM documents WHERE name='master'").get()?.value!==createHash('sha256').update(key).digest('hex'))throw Error('Master key does not match database');
  const row=db.prepare("SELECT value FROM documents WHERE name='settings'").get();
  const settings=row?JSON.parse(row.value):null;
  for(const credential of db.prepare('SELECT name,value FROM credentials').all()){
    const value=JSON.parse(credential.value), config=settings.connection;
    const raw=config.provider==='openai'?'https://api.openai.com/v1/responses':config.provider==='deepseek'?'https://api.deepseek.com/chat/completions':config.provider==='local'?(config.localUrl??'http://127.0.0.1:1234/v1'):config.customUrl;
    const u=new URL(raw);let path=u.pathname.replace(/\/+$/,'');if(!path.endsWith('/responses')&&!path.endsWith('/chat/completions'))path+=(path?'':'/v1')+'/chat/completions';
    const destination=credential.name==='tts'?settings.tts.url:u.origin+path;
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));decipher.setAAD(Buffer.from(credential.name+'\n'+destination));decipher.setAuthTag(Buffer.from(value.tag,'base64'));decipher.update(Buffer.from(value.bytes,'base64'));decipher.final();
  }
  JSON.parse(await readFile(join(root,'auth.json'),'utf8'));
}finally{db.close();}
console.log('Backup integrity and credential decryption verified; no credentials displayed.');
