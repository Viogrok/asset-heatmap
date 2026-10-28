import {usdtReference} from './assets';
import {quoteRuntime} from './runtime';
import {referenceFx} from './fx';
import {coingeckoProvider} from './crypto';
import {instrument} from './identity';
import type {Asset} from '../model';
import type {StandardQuote} from './types';

export async function quoteResponse(assets:Asset[]){
 const service=quoteRuntime();const needed=assets.some(a=>a.symbol==='USDT'&&a.kind==='加密')?assets:[...assets,usdtReference];
 const data=await service.get(needed);const fx=await referenceFx(service,data.standardQuotes);
 const key='md:coingecko:metadata';let metadata=(await service.store.get<Record<string,StandardQuote>>(key));
 if(service.context.config.coingeckoKey&&(!metadata||service.context.now()-metadata.updated>3600000||assets.map(instrument).some(a=>coingeckoProvider.supports(a)&&!metadata!.value[a.assetId]))){
  const owner=crypto.randomUUID();if(await service.store.lease('md:metadata-refresh',owner,service.context.now(),15000))try{await service.allowed('coingecko');const q=await coingeckoProvider.fetch(assets.map(instrument).filter(a=>coingeckoProvider.supports(a)),service.context);const combined={...(metadata?.value||{}),...q};await service.store.put(key,combined,service.context.now());metadata={value:combined,updated:service.context.now()};}catch(e){await service.failure('coingecko',e);}finally{await service.store.release('md:metadata-refresh',owner);}
 }
 if(!assets.some(a=>a.id===usdtReference.id))delete data.quotes[usdtReference.id];
 const visibleIds=new Set(assets.map(a=>instrument(a).assetId));
 const visibleMetadata=Object.fromEntries(Object.entries(metadata?.value||{}).filter(([id])=>visibleIds.has(id)));
 return {...data,fx,metadata:visibleMetadata,service};
}
