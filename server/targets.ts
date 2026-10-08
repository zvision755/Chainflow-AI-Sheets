import type { Connection } from '../model/credentials';
import { isLocalModelUrl } from '../core/local-model-endpoint';
// Reviewed destinations keep the public relay away from arbitrary/private networks.
export const allowedHosts=['api.openai.com','api.deepseek.com','aihubmix.com','api.aihubmix.com','openrouter.ai'];
export function target(connection:Connection,allowLocal=false){
  const raw=connection.provider==='openai'?'https://api.openai.com/v1/responses':connection.provider==='deepseek'?'https://api.deepseek.com/chat/completions':connection.customUrl;
  let u:URL;try{u=new URL(raw);}catch{throw new Error('请输入完整的 HTTPS API 地址');}
  const local=connection.provider==='local'&&isLocalModelUrl(raw)&&((connection.localProvider==='ollama'&&u.port==='11434')||(connection.localProvider!=='ollama'&&u.port==='1234'));
  if(connection.provider==='local'&&!local)throw new Error('本地服务地址无效：LM Studio 使用 1234 端口，Ollama 使用 11434 端口；请填写对应本机 HTTP 地址');
  if(local&&!allowLocal)throw new Error('当前公开部署不允许访问本机模型地址；请在本机 Docker 或开发版中使用 LM Studio / Ollama');
  if(local&&!['','/','/v1','/v1/','/v1/chat/completions','/v1/responses'].includes(u.pathname))throw new Error('本地模型只接受 /v1、/v1/chat/completions 或 /v1/responses 地址');
  if(!local&&(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||(u.port&&u.port!=='443')||!allowedHosts.includes(u.hostname)))throw new Error('API 地址须为 HTTPS，不含凭证或查询参数。官方支持 OpenAI、DeepSeek、aihubmix 和 OpenRouter；本机模式仅开放 1234（LM Studio）和 11434（Ollama）');
  if(!/^\/[a-zA-Z0-9/_-]*$/.test(u.pathname))throw new Error('API 路径不合法');
  let path=u.pathname.replace(/\/+$/,'');
  const responses=path.endsWith('/responses');
  if(!responses&&!path.endsWith('/chat/completions'))path+=(path?'':'/v1')+'/chat/completions';
  const base=path.replace(/\/(responses|chat\/completions)$/,'');
  return {generate:u.origin+path,models:u.origin+base+'/models',protocol:responses?'responses':'chat',name:local?(u.port==='1234'?'LM Studio':'Ollama'):connection.provider==='openai'?'OpenAI 官方':connection.provider==='deepseek'?'DeepSeek 官方':u.hostname,local};
}
