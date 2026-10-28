import {alpacaCalendar,alpacaCorporateActions} from './reference-equities.ts';
import {ProviderError,type Instrument} from './types.ts';
import type {QuoteService} from './service.ts';

type Input={provider:string;kind:string;start:string;end:string};
type Reply={status:number;body:Record<string,unknown>};
const response=(status:number,code:string,error:string):Reply=>({status,body:{code,error}});
const dateMs=(s:string)=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return NaN;
 const n=Date.parse(`${s}T00:00:00Z`);
 return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===s?n:NaN;
};
const deadlineError=()=>new ProviderError('UPSTREAM_ERROR','参考数据请求超时');
/** Auth and asset selection must precede this service. */
export async function runReference(svc:QuoteService,asset:Instrument,input:Input,deadline=Date.now()+20000):Promise<Reply>{
 const {provider,kind,start,end}=input, a=dateMs(start), b=dateMs(end);
 if(!['alpaca','longbridge'].includes(provider)||!['calendar','corporate-actions'].includes(kind)||!Number.isFinite(a)||!Number.isFinite(b)||a>b||(b-a)/86400000+1>(kind==='calendar'?366:31))return response(400,'INVALID_ARGUMENT','参数或日期范围无效');
 if(provider==='longbridge')return response(503,'NOT_CONFIGURED','Longbridge 参考数据 SDK 或桥接尚未配置');
 if(asset.market!=='US'||!['STOCK','ETF'].includes(asset.assetType)||asset.exchange==='BINANCE_BSTOCKS'||!/^[A-Za-z0-9.\-]{1,32}$/.test(asset.symbol))return response(400,'UNSUPPORTED_SYMBOL','Alpaca 仅支持已授权目录中的美股股票和 ETF');
 if(kind==='calendar'&&(start<'1970-01-01'||end>'2029-12-31'))return response(400,'UNSUPPORTED','Alpaca 日历文档范围为 1970–2029');
 const {alpacaKey:key,alpacaSecret:secret}=svc.context.config;
 if(!key||!secret)return response(503,'NOT_CONFIGURED','Alpaca 服务端凭据未配置');
 const cacheKey=`md:reference:v1:${provider}:${kind}:${kind==='calendar'?'US':asset.symbol.toUpperCase()}:${start}:${end}`;
 const started=Date.now(), expires=deadline;
 if(started>=expires)return response(503,'UPSTREAM_ERROR','参考数据请求超时');
 let owner:string|undefined, acquired=false, budgetError:unknown, upstreamError:ProviderError|undefined;
 const controllers=new Set<AbortController>();
 const timeout=<T>(promise:Promise<T>,ms:number):Promise<T>=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(deadlineError()),Math.max(1,ms));promise.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});
 const fetchPage:typeof fetch=async (resource,init)=>{
  try {await timeout(svc.allowed('alpaca'),expires-Date.now());} catch(e){budgetError=e;throw e;}
  const remaining=expires-Date.now();if(remaining<=0){upstreamError=deadlineError();throw upstreamError;}
  const controller=new AbortController();controllers.add(controller);
  const timer=setTimeout(()=>controller.abort(),Math.min(8000,remaining));
  try {
   const res=await timeout((async()=>{const r=await svc.context.fetch(resource,{...init,signal:controller.signal});const bytes=await r.arrayBuffer();return new Response(bytes,{status:r.status,statusText:r.statusText,headers:r.headers});})(),Math.min(8000,remaining));
   if(!res.ok)upstreamError=new ProviderError(res.status===401||res.status===403?'AUTH_OR_ENTITLEMENT':res.status===429?'RATE_LIMIT':'UPSTREAM_ERROR',`Alpaca 返回 HTTP ${res.status}`);
   return res;
  } catch {upstreamError=deadlineError();throw upstreamError;} finally {clearTimeout(timer);controller.abort();controllers.delete(controller);}
 };
 const execute=async():Promise<Reply>=>{
  const cached=await svc.store.get<Record<string,unknown>>(cacheKey);
  const ttl=kind==='calendar'?6*3600000:3600000;
  if(Date.now()>=expires)throw deadlineError();
  if(cached&&started-cached.updated>=0&&started-cached.updated<ttl)return {status:200,body:{...cached.value,cached:true}};
  owner=crypto.randomUUID();acquired=await svc.store.lease('refresh:'+cacheKey,owner,Date.now(),25000);
  if(Date.now()>=expires){if(acquired&&owner)void svc.store.release('refresh:'+cacheKey,owner);acquired=false;throw deadlineError();}
  if(!acquired)return response(503,'BUSY','参考数据正在更新');
  const result=kind==='calendar'?await alpacaCalendar(key,secret,start,end,fetchPage,svc.context.config.alpacaTradingEnvironment??'paper'):await alpacaCorporateActions(key,secret,asset.symbol,start,end,fetchPage);
  if(budgetError){const e=budgetError instanceof ProviderError?budgetError:new ProviderError('UNAVAILABLE','参考数据预算检查失败');return response(503,e.code,e.message);}
  if(result.status!=='OK'){
   const e=upstreamError||new ProviderError('UPSTREAM_ERROR',result.status==='INVALID_RESPONSE'?'Alpaca 返回的数据格式无效':'Alpaca 参考数据不可用');
   const failure=await svc.failure('alpaca',e);return {status:503,body:{code:failure.code,error:failure.message,...(failure.retryAt?{retryAt:failure.retryAt}:{})}};
  }
  if(Date.now()>=expires)return response(503,'UPSTREAM_ERROR','参考数据请求超时');
  const body={code:'OK',provider,kind,assetId:asset.assetId,symbol:asset.symbol,start,end,data:result.data,receivedAt:new Date().toISOString(),cached:false,...(kind==='corporate-actions'?{notice:'按 process_date 查询，数据可能延迟或不完整；不自动修改账本。'}:{notice:'常规时段以外状态未知。'})};
  // Cache only public reference data. Asset identity is reconstructed per request.
  const shared={...body,assetId:undefined,symbol:undefined};
  await svc.store.put(cacheKey,shared,Date.now());await svc.success('alpaca');return {status:200,body};
 };
 try {
  const result=await timeout(execute(),expires-Date.now());
  if(result.status===200&&result.body.cached)result.body={...result.body,assetId:asset.assetId,symbol:asset.symbol};
  return result;
 } catch(e){
  for(const controller of controllers)controller.abort();
  if(e instanceof ProviderError&&e.code==='UPSTREAM_ERROR'){if(controllers.size&&!budgetError)void svc.failure('alpaca',e).catch(()=>{});return response(503,e.code,e.message);}
  return response(503,'UNAVAILABLE','参考数据服务不可用');
 } finally {if(acquired&&owner)await svc.store.release('refresh:'+cacheKey,owner).catch(()=>{});}
}



