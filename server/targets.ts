import type { Connection } from '../model/credentials';
// Reviewed destinations keep the public relay away from arbitrary/private networks.
export const allowedHosts=['api.openai.com','api.deepseek.com','aihubmix.com','api.aihubmix.com','openrouter.ai'];
export function target(connection:Connection){
  const raw=connection.provider==='openai'?'https://api.openai.com/v1/responses':connection.provider==='deepseek'?'https://api.deepseek.com/chat/completions':connection.customUrl;
  let u:URL;try{u=new URL(raw);}catch{throw new Error('请输入完整的 HTTPS API 地址');}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||(u.port&&u.port!=='443')||!allowedHosts.includes(u.hostname))throw new Error('API 地址须为 HTTPS，不含凭证或查询参数。当前支持 OpenAI、DeepSeek、aihubmix 和 OpenRouter 的官方 API 域名');
  if(!/^\/[a-zA-Z0-9/_-]*$/.test(u.pathname))throw new Error('API 路径不合法');
  let path=u.pathname.replace(/\/+$/,'');
  const responses=path.endsWith('/responses');
  if(!responses&&!path.endsWith('/chat/completions'))path+=(path?'':'/v1')+'/chat/completions';
  const base=path.replace(/\/(responses|chat\/completions)$/,'');
  return {generate:u.origin+path,models:u.origin+base+'/models',protocol:responses?'responses':'chat',name:connection.provider==='openai'?'OpenAI 官方':connection.provider==='deepseek'?'DeepSeek 官方':u.hostname};
}
