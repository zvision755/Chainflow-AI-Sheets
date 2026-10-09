import {providerRequest,json} from '../core/provider-transport';
export {json};
/** Server entry protection stays outside the shared browser-compatible provider protocol. */
export async function proxy(request:Request,operation:'generate'|'models',fetcher:typeof fetch=fetch,allowLocal=false,authenticated=false):Promise<Response>{
  const origin=request.headers.get('origin');
  if(!authenticated&&origin!==new URL(request.url).origin)return json({error:{code:'origin',message:'仅接受本站页面发出的请求',retryable:false}},403);
  return providerRequest(request,operation,fetcher,allowLocal);
}
