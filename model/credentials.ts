export type Provider='openai'|'deepseek'|'custom'|'local';
export type LocalProvider='lmstudio'|'ollama';
export type Connection={provider:Provider;customUrl:string;localProvider?:LocalProvider;localUrl?:string};
export const CREDENTIAL_STORAGE='chainflow-connection-v1';
export const connectionDefaults:Connection={provider:'openai',customUrl:'',localProvider:'lmstudio'};
export const providerNames={openai:'OpenAI 官方',deepseek:'DeepSeek 官方',custom:'自定义 API',local:'本地大语言模型'};
export const modelPresets={openai:['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'],deepseek:['deepseek-flash','deepseek-v4-pro'],custom:['gpt-6-luna'],local:[]};
export function loadConnection(storage:Pick<Storage,'getItem'>):{connection:Connection;key:string;remember:boolean}{
  const fallback={connection:{...connectionDefaults},key:'',remember:false};
  try{const raw=JSON.parse(storage.getItem(CREDENTIAL_STORAGE)??'null');if(!raw||!['openai','deepseek','custom','local'].includes(raw.provider)||typeof raw.customUrl!=='string')return fallback;const localProvider=raw.localProvider==='ollama'?'ollama':'lmstudio';return {connection:{provider:raw.provider,customUrl:raw.customUrl.slice(0,500),...(raw.provider==='local'?{localProvider}:{}),...(typeof raw.localUrl==='string'?{localUrl:raw.localUrl.slice(0,500)}:{})},key:raw.remember===true&&typeof raw.key==='string'?raw.key.slice(0,300):'',remember:raw.remember===true};}catch{return fallback;}
}
export function saveConnection(storage:Pick<Storage,'setItem'>,connection:Connection,key:string,remember:boolean){storage.setItem(CREDENTIAL_STORAGE,JSON.stringify({...connection,remember,...(remember&&key.trim()?{key:key.trim()}:{})}));}
export function clearConnection(storage:Pick<Storage,'removeItem'>){storage.removeItem(CREDENTIAL_STORAGE);}
