import type {QuoteService} from './service.ts';
import {request} from './transport.ts';
import type {StandardQuote} from './types.ts';
export type ReferenceFx={rates:Record<string,number>;date:string;provider:string;receivedAt:string;quoteStatus:'SNAPSHOT'|'STALE';stale?:boolean;usdtReference?:{priceUSD:number;source:string;timestamp:string|null;receivedAt:string}};
export async function referenceFx(service:QuoteService,quotes:Record<string,StandardQuote>){
 const old=await service.store.get<ReferenceFx>('md:fx'),now=service.context.now();let fx=old?.value;
 if(old&&now-old.updated>86400000&&fx)fx={...fx,quoteStatus:'STALE',stale:true};
 if(!old||now-old.updated>86400000){const owner=crypto.randomUUID();if(await service.store.lease('refresh:fx',owner,now,15000))try{
  // v1 remains supported by Frankfurter and matches the established app conversion convention.
  await service.allowed('frankfurter');const j:any=await (await request(service.context,'https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,HKD')).json();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(j.date)||!(j.rates?.CNY>0)||!(j.rates?.HKD>0))throw Error('汇率字段缺失');
  fx={rates:{USD:1,CNY:Number(j.rates.CNY),HKD:Number(j.rates.HKD)},date:j.date,provider:'Frankfurter 日参考汇率',receivedAt:new Date(now).toISOString(),quoteStatus:'SNAPSHOT'};await service.store.put('md:fx',fx,now);await service.success('frankfurter');
 }catch(e){await service.failure('frankfurter',e);if(fx)fx={...fx,quoteStatus:'STALE',stale:true};}finally{await service.store.release('refresh:fx',owner);}}
 if(!fx)return null;fx={...fx,rates:{...fx.rates}};delete fx.rates.USDT;
 const usd=Object.values(quotes).find(q=>q.symbol==='USDT'&&q.currency==='USD'&&q.lastPrice&&q.quoteStatus!=='UNAVAILABLE'&&now-Date.parse(q.receivedAt)<300000);
 if(usd?.lastPrice){fx.rates.USDT=1/usd.lastPrice;fx.usdtReference={priceUSD:usd.lastPrice,source:usd.provider,timestamp:usd.timestamp,receivedAt:usd.receivedAt};}
 return fx;
}
