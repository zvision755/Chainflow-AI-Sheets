import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, readdir, rename, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';

const MAX_AUDIO_BYTES=32*1024*1024;
export const MAX_SPEECH_CACHE_BYTES=1024*1024*1024;
export type SpeechIdentity={provider:string;endpoint:string;model:string;voice:string;language:string;speed:number;input:string;format:string;stream:boolean};
export interface SpeechCache {
  getOrCreate(identity:SpeechIdentity,signal:AbortSignal,produce:(signal:AbortSignal)=>Promise<Response>):Promise<Response>;
}
export type CacheEvent='hit'|'miss'|'shared'|'stored'|'evicted'|'invalid'|'read-error'|'write-error';
type Entry={version:1;type:string;size:number;sha256:string};
type Result={response:Response;status:'HIT'|'MISS'|'BYPASS'};
type Flight={controller:AbortController;waiters:number;promise:Promise<Result>};

// Fixed field order and exact submitted text: no Unicode, whitespace, punctuation,
// case or kana folding. Credentials and workbook/cell identifiers are never keys.
export function speechCacheKey(value:SpeechIdentity){
  return digest(JSON.stringify([1,value.provider,value.endpoint,value.model,value.voice,value.language,value.speed,value.input,value.format,value.stream]));
}
function digest(value:string|Uint8Array){return createHash('sha256').update(value).digest('hex');}
function text(bytes:Uint8Array,start:number,length:number){return new TextDecoder().decode(bytes.subarray(start,start+length));}
// Detect empty/truncated WAV containers and incomplete MPEG frames. The checksum
// additionally detects any change to a previously committed audio file.
export function validSpeechAudio(bytes:Uint8Array,type:string){
  if(!bytes.length||bytes.length>MAX_AUDIO_BYTES)return false;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(type==='audio/wav'){
    if(bytes.length<44||text(bytes,0,4)!=='RIFF'||text(bytes,8,4)!=='WAVE'||view.getUint32(4,true)+8!==bytes.length)return false;
    let format=false,data=false,offset=12;
    while(offset+8<=bytes.length){
      const name=text(bytes,offset,4),length=view.getUint32(offset+4,true),start=offset+8;
      if(start+length>bytes.length)return false;
      if(name==='fmt '){if(length<16||![1,3,0xfffe].includes(view.getUint16(start,true))||!view.getUint16(start+2,true)||!view.getUint32(start+4,true))return false;format=true;}
      if(name==='data'&&length>0)data=true;
      offset=start+length+(length%2);
    }
    return format&&data&&offset===bytes.length;
  }
  if(type!=='audio/mpeg')return false;
  let offset=0,frames=0;
  if(text(bytes,0,3)==='ID3'){
    if(bytes.length<10||[6,7,8,9].some(i=>bytes[i]>127))return false;
    offset=10+((bytes[6]<<21)|(bytes[7]<<14)|(bytes[8]<<7)|bytes[9])+((bytes[3]===4&&(bytes[5]&16))?10:0);
  }
  while(offset+4<=bytes.length){
    if(bytes.length-offset===128&&text(bytes,offset,3)==='TAG')return frames>0;
    const a=bytes[offset],b=bytes[offset+1],c=bytes[offset+2];
    const version=(b>>3)&3,layer=(b>>1)&3,rateIndex=(c>>2)&3,bitrateIndex=c>>4;
    if(a!==255||(b&224)!==224||version===1||!layer||rateIndex===3||!bitrateIndex||bitrateIndex===15)return false;
    const rates=version===3?[44100,48000,32000]:version===2?[22050,24000,16000]:[11025,12000,8000];
    const table=version===3?(layer===3?[0,32,64,96,128,160,192,224,256,288,320,352,384,416,448]:layer===2?[0,32,48,56,64,80,96,112,128,160,192,224,256,320,384]:[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]):layer===3?[0,32,48,56,64,80,96,112,128,144,160,176,192,224,256]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
    const bitrate=table[bitrateIndex]*1000,padding=(c>>1)&1;
    const length=layer===3?(Math.floor(12*bitrate/rates[rateIndex])+padding)*4:Math.floor((version!==3&&layer===1?72:144)*bitrate/rates[rateIndex])+padding;
    if(length<4||offset+length>bytes.length)return false;
    offset+=length;frames++;
  }
  return frames>0&&offset===bytes.length;
}
function audioResponse(bytes:Uint8Array,type:string){return new Response(new Uint8Array(bytes),{headers:{'Content-Type':type,'Content-Length':String(bytes.length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}

export class FileSpeechCache implements SpeechCache {
  private flights=new Map<string,Flight>();
  private capacityReady?:Promise<void>;
  private capacityQueue:Promise<void>=Promise.resolve();
  constructor(readonly directory:string,private onEvent:(event:CacheEvent,key:string)=>void=()=>{},readonly maxBytes=MAX_SPEECH_CACHE_BYTES){}
  private event(event:CacheEvent,key:string){try{this.onEvent(event,key);}catch{/* diagnostics must not break playback */}}
  private paths(key:string){const directory=join(this.directory,key.slice(0,2));return {directory,audio:join(directory,key+'.audio'),meta:join(directory,key+'.json')};}
  private async read(key:string):Promise<Response|null>{
    const paths=this.paths(key);
    try{
      if((await stat(paths.meta)).size>1024)throw Error('invalid');
      const meta=JSON.parse(await readFile(paths.meta,'utf8')) as Entry;
      if(meta.version!==1||!['audio/wav','audio/mpeg'].includes(meta.type)||!Number.isInteger(meta.size)||meta.size<1||meta.size>MAX_AUDIO_BYTES||!/^[a-f0-9]{64}$/.test(meta.sha256))throw Error('invalid');
      if((await stat(paths.audio)).size!==meta.size)throw Error('invalid');
      const bytes=await readFile(paths.audio);
      if(bytes.length!==meta.size||digest(bytes)!==meta.sha256||!validSpeechAudio(bytes,meta.type))throw Error('invalid');
      this.event('hit',key);return audioResponse(bytes,meta.type);
    }catch(error){
      const code=(error as NodeJS.ErrnoException).code;
      if(code==='ENOENT'){
        await Promise.all([rm(paths.audio,{force:true}),rm(paths.meta,{force:true})]);
        return null;
      }
      this.event(code&&code!=='invalid'?'read-error':'invalid',key);
      // Metadata is the commit marker. A bad/missing pair is never a cache hit.
      await Promise.all([rm(paths.audio,{force:true}),rm(paths.meta,{force:true})]).catch(()=>{});
      return null;
    }
  }
  private async write(key:string,bytes:Uint8Array,type:string){
    const paths=this.paths(key),suffix='.'+randomUUID()+'.tmp';
    const tempAudio=paths.audio+suffix,tempMeta=paths.meta+suffix;
    await mkdir(paths.directory,{recursive:true,mode:0o700});
    const write=async(path:string,value:Uint8Array|string)=>{const handle=await open(path,'wx',0o600);try{await handle.writeFile(value);await handle.sync();}finally{await handle.close();}};
    try{
      await write(tempAudio,bytes);
      await write(tempMeta,JSON.stringify({version:1,type,size:bytes.length,sha256:digest(bytes)} satisfies Entry));
      await rename(tempAudio,paths.audio);
      await rename(tempMeta,paths.meta);
    }finally{await Promise.all([rm(tempAudio,{force:true}),rm(tempMeta,{force:true})]);}
  }
  private trimToLimit():Promise<void>{
    return this.withCapacityLock(()=>this.evictOldest());
  }
  private withCapacityLock(work:()=>Promise<void>):Promise<void>{
    const run=this.capacityQueue.then(work);
    this.capacityQueue=run.catch(()=>{});
    return run;
  }
  private storeWithinLimit(key:string,bytes:Uint8Array,type:string){
    return this.withCapacityLock(async()=>{await this.write(key,bytes,type);this.event('stored',key);await this.evictOldest();});
  }
  private async ensureCapacity(){
    this.capacityReady??=this.trimToLimit().catch(()=>{this.event('write-error','capacity');});
    await this.capacityReady;
  }
  private async evictOldest(){
    const entries:{key:string;audio:string;meta:string;size:number;created:number}[]=[];
    let total=0;
    for(const shard of await readdir(this.directory,{withFileTypes:true}).catch(error=>{
      if((error as NodeJS.ErrnoException).code==='ENOENT')return [];
      throw error;
    })){
      if(!shard.isDirectory()||! /^[a-f0-9]{2}$/.test(shard.name))continue;
      const directory=join(this.directory,shard.name);
      for(const file of await readdir(directory,{withFileTypes:true}).catch(()=>[])){
        if(!file.isFile()||! /^[a-f0-9]{64}\.audio$/.test(file.name))continue;
        const key=file.name.slice(0,64),audio=join(directory,file.name),metaPath=join(directory,key+'.json');
        try{
          const audioStat=await stat(audio),metaSize=await stat(metaPath).then(value=>value.size,()=>0);
          entries.push({key,audio,meta:metaPath,size:audioStat.size+metaSize,created:audioStat.mtimeMs});total+=audioStat.size+metaSize;
        }catch{/* incomplete/corrupt pairs are ignored and will be regenerated on lookup */}
      }
    }
    if(total<=this.maxBytes)return;
    entries.sort((a,b)=>a.created-b.created||a.key.localeCompare(b.key));
    for(const entry of entries){
      if(total<=this.maxBytes)break;
      await Promise.all([rm(entry.audio,{force:true}),rm(entry.meta,{force:true})]);
      total-=entry.size;this.event('evicted',entry.key);
    }
  }
  private async resolve(key:string,signal:AbortSignal,produce:(signal:AbortSignal)=>Promise<Response>):Promise<Result>{
    await this.ensureCapacity();
    const hit=await this.read(key);signal.throwIfAborted();
    if(hit)return {response:hit,status:'HIT'};
    this.event('miss',key);
    const response=await produce(signal);signal.throwIfAborted();
    if(!response.ok)return {response,status:'BYPASS'};
    const type=response.headers.get('content-type')?.split(';')[0]??'';
    const bytes=new Uint8Array(await response.arrayBuffer());signal.throwIfAborted();
    if(!validSpeechAudio(bytes,type))return {response:Response.json({error:{code:'tts_audio',message:'TTS 返回了空白、不完整或无效的音频，请重试',retryable:false}},{status:502,headers:{'Cache-Control':'no-store'}}),status:'BYPASS'};
    let status:Result['status']='MISS';
    try{await this.storeWithinLimit(key,bytes,type);}catch{status='BYPASS';this.event('write-error',key);}
    return {response:audioResponse(bytes,type),status};
  }
  getOrCreate(identity:SpeechIdentity,signal:AbortSignal,produce:(signal:AbortSignal)=>Promise<Response>):Promise<Response>{
    if(signal.aborted)return Promise.reject(signal.reason);
    const key=speechCacheKey(identity);let flight=this.flights.get(key);
    const shared=!!flight&&!flight.controller.signal.aborted;
    if(!shared){
      const controller=new AbortController();
      flight={controller,waiters:0,promise:this.resolve(key,controller.signal,produce)};
      this.flights.set(key,flight);
      const current=flight;const clear=()=>{if(this.flights.get(key)===current)this.flights.delete(key);};
      void flight.promise.then(clear,clear);
    }else this.event('shared',key);
    const current=flight!;current.waiters++;
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=()=>{if(settled)return false;settled=true;signal.removeEventListener('abort',abort);current.waiters--;return true;};
      const abort=()=>{if(!finish())return;if(!current.waiters)current.controller.abort();reject(signal.reason);};
      signal.addEventListener('abort',abort,{once:true});
      current.promise.then(result=>{if(!finish())return;const response=result.response.clone();if(response.ok)response.headers.set('X-Chainflow-TTS-Cache',shared&&result.status==='MISS'?'SHARED':result.status);resolve(response);},error=>{if(finish())reject(error);});
      if(signal.aborted)abort();
    });
  }
}
