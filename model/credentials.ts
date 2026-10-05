export type Provider='openai'|'deepseek'|'custom';
export type Connection={provider:Provider;customUrl:string};
export const CREDENTIAL_STORAGE='chainflow-connection-v1';
export const connectionDefaults:Connection={provider:'openai',customUrl:''};
export const providerNames={openai:'OpenAI 官方',deepseek:'DeepSeek 官方',custom:'自定义 API'};
export const modelPresets={openai:['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'],deepseek:['deepseek-flash','deepseek-v4-pro'],custom:['gpt-6-luna']};
export function loadConnection(storage:Pick<Storage,'getItem'>):{connection:Connection;key:string;remember:boolean}{
  const fallback={connection:{...connectionDefaults},key:'',remember:false};
  try{const raw=JSON.parse(storage.getItem(CREDENTIAL_STORAGE)??'null');if(!raw||!['openai','deepseek','custom'].includes(raw.provider)||typeof raw.customUrl!=='string')return fallback;return {connection:{provider:raw.provider,customUrl:raw.customUrl.slice(0,500)},key:raw.remember===true&&typeof raw.key==='string'?raw.key.slice(0,300):'',remember:raw.remember===true};}catch{return fallback;}
}
export function saveConnection(storage:Pick<Storage,'setItem'>,connection:Connection,key:string,remember:boolean){storage.setItem(CREDENTIAL_STORAGE,JSON.stringify({...connection,remember,...(remember&&key.trim()?{key:key.trim()}:{})}));}
export function clearConnection(storage:Pick<Storage,'removeItem'>){storage.removeItem(CREDENTIAL_STORAGE);}
