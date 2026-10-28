import {instrument} from './identity.ts';
import {baseQuote,legacyQuote,ProviderError,validQuote,type Instrument,type Provider,type ProviderContext,type ProviderFailure,type StandardQuote} from './types.ts';
import type {Asset,Quote} from '../model.ts';
import type {QuoteStore} from './store.ts';

export const quoteKey=(id:string)=>'md:v1:quote:'+id;
export const instrumentKey=(id:string)=>'md:v1:instrument:'+id;
type Circuit={until:number;code:string;failures:number};
export class QuoteService{
 store:QuoteStore;providers:Provider[];context:ProviderContext;
 constructor(store:QuoteStore,providers:Provider[],context:ProviderContext){this.store=store;this.providers=providers;this.context=context;}
 async checkAvailable(provider:string){
  const stamp=this.context.now(),circuit=await this.store.get<Circuit>('md:circuit:'+provider);
  if(circuit&&circuit.value.until>stamp)throw new ProviderError('COOLDOWN:'+circuit.value.code,'行情源处于故障冷却期',circuit.value.until-stamp);
 }
 async success(provider:string){await this.store.put('md:circuit:'+provider,{until:0,code:'OK',failures:0},this.context.now());}
 async allowed(provider:string){
  await this.checkAvailable(provider);
  const {config:c,now}=this.context,stamp=now();
  const limit=provider==='coingecko'?30:provider==='alpaca'?100:provider==='longbridge'?120:provider==='legacy-public'?6:24;
  if(!await this.store.budget('md:minute:'+provider,limit,60000,stamp))throw new ProviderError('RATE_LIMIT','本应用的行情请求预算已用尽',60000-stamp%60000);
  if(provider==='coingecko'){
   const month=new Date(stamp).toISOString().slice(0,7);
   if(!await this.store.budget('md:month:coingecko:'+month,c.coingeckoMonthlyLimit,Number.MAX_SAFE_INTEGER,stamp))throw new ProviderError('MONTHLY_LIMIT','CoinGecko本月安全预算已用尽',86400000);
  }
 }
 async failure(provider:string,e:unknown){
  const error=e instanceof ProviderError?e:new ProviderError('UPSTREAM_ERROR','行情源请求失败');
  if(error.code.startsWith('COOLDOWN:'))return {provider,code:error.code.slice(9),message:error.message,retryAt:this.context.now()+(error.retryAfterMs||0)} satisfies ProviderFailure;
  if(['NOT_CONFIGURED','DISABLED','INVALID_ARGUMENT','UNSUPPORTED','UNSUPPORTED_SYMBOL'].includes(error.code))return {provider,code:error.code,message:error.message} satisfies ProviderFailure;
  const old=await this.store.get<Circuit>('md:circuit:'+provider);const count=(old?.value.failures||0)+1;
  const cooldown=error.code==='REGION_RESTRICTED'?86400000:error.code==='AUTH_OR_ENTITLEMENT'?300000:error.code==='NOT_CONFIGURED'||error.code==='DISABLED'?0:Math.max(error.retryAfterMs||0,Math.min(300000,5000*2**Math.min(count,6)));
  if(cooldown)await this.store.put('md:circuit:'+provider,{until:this.context.now()+cooldown,code:error.code,failures:count},this.context.now());
  return {provider,code:error.code,message:error.message,...(cooldown?{retryAt:this.context.now()+cooldown}:{})} satisfies ProviderFailure;
 }
 async get(assets:Asset[]){
  const ctx=this.context,now=ctx.now(),owner=crypto.randomUUID(),all=assets.map(instrument),unique=[...new Map(all.map(a=>[a.assetId,a])).values()];
  const standard:Record<string,StandardQuote>={},previous=new Map<string,StandardQuote>(),pending:Instrument[]=[],owned:string[]=[],failures=new Map<string,ProviderFailure[]>();
  const stored=await this.store.getMany<unknown>(unique.flatMap(a=>[instrumentKey(a.assetId),quoteKey(a.assetId),'quote-v2:'+a.legacyId]));
  const registration:{key:string;value:unknown}[]=[],acquire:Instrument[]=[];
  for(const a of unique){
   // Registered instruments are public asset metadata, never balances or cost basis.
   const registry=stored.get(instrumentKey(a.assetId));if(!registry||JSON.stringify(registry.value)!==JSON.stringify(a))registration.push({key:instrumentKey(a.assetId),value:a});
   const old=stored.get(quoteKey(a.assetId)) as {value:StandardQuote;updated:number}|undefined;if(old&&validQuote(old.value))previous.set(a.assetId,old.value);
   if(!old){const v=stored.get('quote-v2:'+a.legacyId)?.value as Quote|undefined;if(v&&v.price>0&&Number.isFinite(Date.parse(v.fetched))){previous.set(a.assetId,{...baseQuote(a,'legacy-cache:'+v.source,now),lastPrice:v.price,changePercent:v.change,timestamp:v.at,receivedAt:v.fetched,currency:v.currency,quoteStatus:'STALE',warnings:['来自升级前的最近有效缓存，尚未由新数据层核验。']});}}
   const ttl=a.market==='CRYPTO'?ctx.config.cryptoTtlMs:ctx.config.equityTtlMs;
   if(old&&validQuote(old.value)&&now-Date.parse(old.value.receivedAt)<(old.value.quoteStatus==='REALTIME'?30000:ttl)&&old.value.quoteStatus!=='STALE'){const age=now-Date.parse(old.value.receivedAt);standard[a.assetId]=old.value.quoteStatus==='REALTIME'&&age>3000?{...old.value,quoteStatus:'DELAYED',delaySeconds:Math.ceil(age/1000)}:old.value;continue;}
   acquire.push(a);
  }
  await this.store.putMany(registration,now);
  const locks=await this.store.leaseMany(acquire.map(a=>'refresh:'+a.assetId),owner,now,90000);
  for(const a of acquire){if(locks.has('refresh:'+a.assetId)){pending.push(a);owned.push(a.assetId);}else{const old=previous.get(a.assetId);if(old)standard[a.assetId]={...old,quoteStatus:'STALE',warnings:[...old.warnings,'其他请求正在更新共享缓存。']};}}
  try{
   for(const provider of this.providers){
    const want=pending.filter(a=>!standard[a.assetId]&&provider.supports(a));if(!want.length)continue;
    try{
     // Missing optional credentials consume no provider quota and make no HTTP request.
     const c=ctx.config;
     if(provider.id==='coingecko'&&!c.coingeckoKey)throw new ProviderError('NOT_CONFIGURED','CoinGecko Demo key未配置');
     if(provider.id==='longbridge'&&!c.longbridgeUrl&&!(c.longbridgeKey&&c.longbridgeSecret&&c.longbridgeAccessToken))throw new ProviderError('NOT_CONFIGURED','Longbridge凭据未配置');
     if(provider.id==='alpaca'&&!(c.alpacaKey&&c.alpacaSecret))throw new ProviderError('NOT_CONFIGURED','Alpaca凭据未配置');
     if(provider.id==='akshare'&&!c.akshareUrl)throw new ProviderError('NOT_CONFIGURED','AKShare桥接未配置');
     await this.allowed(provider.id);const result=await provider.fetch(want,ctx);
     const writes:{key:string;value:unknown}[]=[];
     for(const a of want){const q=result[a.assetId];if(!q||!validQuote(q)){const fs=failures.get(a.assetId)||[];fs.push({provider:provider.id,code:'NO_QUOTE',message:'未取得此标的的有效行情或映射未支持'});failures.set(a.assetId,fs);continue;}
      q.failures=failures.get(a.assetId)||[];const prev=previous.get(a.assetId);if(prev&&(prev.provider!==q.provider||prev.currency!==q.currency))q.warnings.push(`信源切换：${prev.provider}/${prev.currency} → ${q.provider}/${q.currency}；价格、涨跌口径与时间按新来源整体替换。`);
      standard[a.assetId]=q;writes.push({key:quoteKey(a.assetId),value:q});
     }
     await this.store.putMany(writes,now);
     await this.success(provider.id);
    }catch(e){const f=await this.failure(provider.id,e);for(const a of want)failures.set(a.assetId,[...(failures.get(a.assetId)||[]),f]);}
   }
  }finally{await this.store.releaseMany(owned.map(id=>'refresh:'+id),owner);}
  for(const a of unique){if(standard[a.assetId])continue;const old=previous.get(a.assetId);standard[a.assetId]=old&&now-Date.parse(old.receivedAt)<=ctx.config.maxStaleMs?{...old,quoteStatus:'STALE',failures:failures.get(a.assetId)||[],warnings:[...old.warnings,'在线更新失败，显示最近有效行情；接收时间保持原值。']}:{...baseQuote(a,'none',now),failures:failures.get(a.assetId)||[{provider:'registry',code:'UNSUPPORTED',message:'尚无已核验的数据源或资产映射'}]};}
  const quotes:Record<string,Quote>={},errors:Record<string,string>={};for(const a of all){const q=standard[a.assetId],legacy=legacyQuote(q);if(legacy)quotes[a.legacyId]=legacy;if(q.quoteStatus==='UNAVAILABLE'||q.quoteStatus==='STALE')errors[a.legacyId]=q.failures.map(f=>f.provider+': '+f.message).join('；')||q.quoteStatus;}
  return {quotes,standardQuotes:standard,errors};
 }
}
