import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { restoreWorkspace, serializeWorkspace } from '../core/workspace';
import { defaultTtsConfig, validateTtsConfig } from '../core/tts';
import { target } from './targets';
import { json } from './proxy';
import type { Connection } from '../model/credentials';

const connectionSchema = z.object({ provider: z.enum(['openai','deepseek','custom','local']), customUrl: z.string().max(500), localProvider: z.enum(['lmstudio','ollama']).optional(), localUrl: z.string().max(500).optional() }).strict();
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const keySchema = z.string().min(1).max(500).regex(/^[a-zA-Z0-9_.-]+$/);
type Settings = { connection: Connection; tts: ReturnType<typeof validateTtsConfig> };
type Row = { revision: number; value: string };
export class RevisionConflict extends Error {}
/** Single-owner documents, independently versioned settings and purpose-bound encrypted credentials. */
export class PersonalStore {
  readonly db: DatabaseSync;
  constructor(file: string, private master: Buffer) {
    if (master.length !== 32) throw Error('Encryption master key must be exactly 32 bytes');
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    const version=this.db.prepare('PRAGMA user_version').get() as {user_version:number};
    if(version.user_version>1){this.db.close();throw Error('Database schema is newer than this application; do not downgrade');}
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS documents (name TEXT PRIMARY KEY, revision INTEGER NOT NULL, value TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS credentials (name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT; PRAGMA user_version=1;');
    chmodSync(file, 0o600);
    const fingerprint = createHash('sha256').update(master).digest('hex');
    const previous = this.db.prepare('SELECT value FROM documents WHERE name=?').get('master') as {value:string}|undefined;
    if (previous && previous.value !== fingerprint) { this.db.close(); throw Error('Encryption master key does not match database; restore the matching key'); }
    this.db.prepare('INSERT OR IGNORE INTO documents VALUES (?,0,?)').run('master', fingerprint);
  }
  close() { this.db.close(); }
  private row(name: string) { return this.db.prepare('SELECT revision,value FROM documents WHERE name=?').get(name) as Row|undefined; }
  workspace() { const row = this.row('workspace'); return { revision: row?.revision ?? 0, workspace: row ? JSON.parse(row.value) : null }; }
  settings() { const row = this.row('settings'); const value: Settings = row ? JSON.parse(row.value) : { connection: { provider:'openai', customUrl:'' }, tts: structuredClone(defaultTtsConfig) }; return { revision: row?.revision ?? 0, ...value, modelKeyConfigured: this.hasKey('model'), ttsKeyConfigured: this.hasKey('tts') }; }
  private hasKey(name: string) { return !!this.db.prepare('SELECT name FROM credentials WHERE name=?').get(name); }
  private cas(name: string, revision: number, value: string) {
    if (!this.row(name)) { if (revision !== 0) throw new RevisionConflict(); this.db.prepare('INSERT INTO documents VALUES (?,1,?)').run(name,value); return 1; }
    const update = this.db.prepare('UPDATE documents SET revision=revision+1,value=? WHERE name=? AND revision=?').run(value,name,revision);
    if (!update.changes) throw new RevisionConflict(); return revision + 1;
  }
  private transaction<T>(run: () => T) { this.db.exec('BEGIN IMMEDIATE'); try { const result=run(); this.db.exec('COMMIT'); return result; } catch(error) { this.db.exec('ROLLBACK'); throw error; } }
  saveWorkspace(revision: number, workspace: unknown) {
    revisionSchema.parse(revision);
    const restored = restoreWorkspace(JSON.stringify(workspace),null,null);
    if(restored.tables.length > 100) throw Error('Too many tables');
    return this.transaction(()=>this.cas('workspace',revision,serializeWorkspace(restored)));
  }
  private credential(name: string, key: string|null, destination: string) {
    if (key === null) { this.db.prepare('DELETE FROM credentials WHERE name=?').run(name); return; }
    keySchema.parse(key);
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',this.master,iv);
    cipher.setAAD(Buffer.from(name+'\n'+destination));
    const bytes=Buffer.concat([cipher.update(key,'utf8'),cipher.final()]);
    this.db.prepare('INSERT INTO credentials VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run(name,JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),bytes:bytes.toString('base64')}));
  }
  /** Called only while constructing a validated upstream request, never by a configuration API. */
  upstreamKey(name:'model'|'tts',destination:string) {
    const row=this.db.prepare('SELECT value FROM credentials WHERE name=?').get(name) as {value:string}|undefined;
    if(!row)return '';
    const data=JSON.parse(row.value);const decipher=createDecipheriv('aes-256-gcm',this.master,Buffer.from(data.iv,'base64'));
    decipher.setAAD(Buffer.from(name+'\n'+destination));decipher.setAuthTag(Buffer.from(data.tag,'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data.bytes,'base64')),decipher.final()]).toString('utf8');
  }
  modelDestination(connection: Connection) { return target({...connection,customUrl:connection.provider==='local'?(connection.localUrl??'http://127.0.0.1:1234/v1'):connection.customUrl},true).generate; }
  saveSettings(raw:unknown) {
    const data=z.object({revision:revisionSchema,connection:connectionSchema.optional(),tts:z.unknown().optional(),modelKey:keySchema.nullable().optional(),ttsKey:keySchema.nullable().optional()}).strict().parse(raw);
    const current=this.settings(); const connection=data.connection??current.connection; const tts=data.tts===undefined?current.tts:validateTtsConfig(data.tts);
    const destination=this.modelDestination(connection);
    if(tts.provider==='external'){const url=new URL(tts.url);if(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&!['8880','8881'].includes(url.port))throw Error('Local TTS port is not approved');}
    return this.transaction(()=>{
      const revision=this.cas('settings',data.revision,JSON.stringify({connection,tts}));
      // Changing a destination invalidates its previous credential; never send a key to another host/path.
      if(destination!==this.modelDestination(current.connection))this.credential('model',null,'');
      if(tts.url!==current.tts.url)this.credential('tts',null,'');
      if(data.modelKey!==undefined)this.credential('model',data.modelKey,destination);
      if(data.ttsKey!==undefined)this.credential('tts',data.ttsKey,tts.url);
      return revision;
    });
  }
  async handle(request:Request):Promise<Response|null> {
    const path=new URL(request.url).pathname;
    if(!['/api/workspace','/api/settings'].includes(path))return null;
    if(request.method==='GET')return json(path==='/api/workspace'?this.workspace():this.settings());
    if(request.method!=='PUT')return json({error:{code:'method',message:'请使用 GET 或 PUT'}},405);
    try {
      if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error();
      const data=await request.json();
      if(path==='/api/workspace') { const parsed=z.object({revision:revisionSchema,workspace:z.unknown()}).strict().parse(data); return json({revision:this.saveWorkspace(parsed.revision,parsed.workspace)}); }
      this.saveSettings(data);return json(this.settings());
    }catch(error){return error instanceof RevisionConflict?json({error:{code:'revision_conflict',message:'另一台设备已更新数据；当前修改尚未保存，请保留副本并重新加载'}},409):json({error:{code:'storage_write',message:'保存失败，请检查内容、配置地址或存储空间；当前修改尚未保存'}},400);}
  }
  /** Ignores client credentials/destinations: credentials only reach the server-approved saved destination. */
  async upstreamRequest(request:Request,kind:'model'|'tts') {
    const data=await request.json() as Record<string,unknown>; const settings=this.settings(); const headers=new Headers(request.headers);headers.delete('authorization');
    let body:Record<string,unknown>, key='';
    if(kind==='model'){const connection=settings.connection; const destination=this.modelDestination(connection);key=this.upstreamKey('model',destination);body={...data,provider:connection.provider,customUrl:connection.provider==='local'?(connection.localUrl??'http://127.0.0.1:1234/v1'):connection.customUrl,localProvider:connection.localProvider};}
    else { const tts=settings.tts;key=tts.provider==='external'?this.upstreamKey('tts',tts.url):'';const speech=new URL(request.url).pathname.endsWith('/speech');body=speech?{...data,url:tts.url,model:tts.model,speed:tts.speed,voice:tts.voices[data.language as keyof typeof tts.voices]}:{url:tts.url}; }
    if(key)headers.set('authorization','Bearer '+key);
    return new Request(request.url,{method:request.method,headers,body:JSON.stringify(body),signal:request.signal});
  }
}
