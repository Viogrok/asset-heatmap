import {krakenPair} from '../kraken.ts';
import {request} from './transport.ts';
import {baseQuote, epoch, finite, positive, ProviderError, type Candle, type CandleSeries, type Instrument, type Provider, type ProviderContext, type StandardQuote} from './types.ts';

const BINANCE='https://api.binance.com';
// OKX Global's documented REST origin. Region-specific origins must be configured
// as a separate, explicitly entitled adapter, not tried after a regional refusal.
const OKX='https://openapi.okx.com';
const BSTOCKS=new Set(['MSTRB','BMNRB','CRCLB','COINB','HOODB']);
type CryptoVenue='binance'|'okx';
export type VerifiedCryptoPair={symbol:string;base:string;quote:'USDT'};

/** Identity only: being known here is not proof the venue lists an active pair. */
export function cryptoSymbol(a:Instrument,ctx?:ProviderContext):string|null {
 if(a.exchange==='BINANCE_BSTOCKS'){
  const symbol=a.symbol.toUpperCase();
  return BSTOCKS.has(symbol)&&a.legacy.id===`binance:${symbol}`&&a.legacy.listing.includes('bStocks')?symbol:null;
 }
 if(a.market!=='CRYPTO'||a.assetType!=='CRYPTO')return null;
 const configured=ctx?.config.cryptoSymbols[a.assetId]||ctx?.config.cryptoSymbols[a.legacyId];
 if(configured&&a.legacy.coin)return configured;
 const pair=krakenPair(a.legacy);
 return pair?a.symbol.toUpperCase():null;
}

type Catalog={expires:number;pairs:Map<string,VerifiedCryptoPair>};
// Metadata is shared within an isolate; the service layer provides the durable
// quote cache and provider quotas. Separate injected fetches also isolate tests.
const catalogs=new WeakMap<typeof fetch,Map<CryptoVenue,Catalog>>();
const loading=new WeakMap<typeof fetch,Map<CryptoVenue,Promise<Catalog>>>();
function cacheFor<T>(cache:WeakMap<typeof fetch,Map<CryptoVenue,T>>,key:typeof fetch){
 let value=cache.get(key);if(!value){value=new Map();cache.set(key,value);}return value;
}
function requireEnabled(provider:CryptoVenue,ctx:ProviderContext){
 if(provider==='binance'?!ctx.config.binanceEnabled:!ctx.config.okxEnabled)throw new ProviderError('NOT_CONFIGURED',`${provider} 行情适配器未启用`);
}
function providerCode(j:any,provider:CryptoVenue){
 if(provider==='binance'&&typeof j?.code==='number'&&j.code<0){
  throw new ProviderError(j.code===-1003?'RATE_LIMIT':j.code===-1121?'UNSUPPORTED':'PROVIDER_REJECTED',`Binance 拒绝行情请求（${j.code}）`);
 }
 if(provider==='okx'&&String(j?.code)!=='0')throw new ProviderError(String(j?.code)==='50011'?'RATE_LIMIT':'PROVIDER_REJECTED',`OKX 拒绝行情请求（${String(j?.code||'未知代码')}）`);
}
async function catalog(provider:CryptoVenue,ctx:ProviderContext):Promise<Catalog>{
 requireEnabled(provider,ctx);
 const store=cacheFor(catalogs,ctx.fetch),cached=store.get(provider);
 if(cached&&cached.expires>ctx.now())return cached;
 const pending=cacheFor(loading,ctx.fetch),existing=pending.get(provider);if(existing)return existing;
 const promise=(async()=>{
  const path=provider==='binance'?`${BINANCE}/api/v3/exchangeInfo`:`${OKX}/api/v5/public/instruments?instType=SPOT`;
  const j:any=await (await request(ctx,path)).json();providerCode(j,provider);
  const rows=provider==='binance'?j.symbols:j.data;
  if(!Array.isArray(rows))throw new ProviderError('INVALID_RESPONSE',`${provider} 产品目录缺失`);
  const pairs=new Map<string,VerifiedCryptoPair>();
  for(const row of rows){
   if(provider==='binance'){
    if(row.status!=='TRADING'||row.isSpotTradingAllowed===false||row.quoteAsset!=='USDT')continue;
    if(typeof row.baseAsset!=='string'||typeof row.symbol!=='string')continue;
    if(row.symbol!==row.baseAsset+'USDT')continue;
    pairs.set(row.baseAsset,{symbol:row.symbol,base:row.baseAsset,quote:'USDT'});
   }else{
    if(row.instType!=='SPOT'||row.state!=='live'||row.quoteCcy!=='USDT')continue;
    if(typeof row.baseCcy!=='string'||typeof row.instId!=='string'||row.instId!==row.baseCcy+'-USDT')continue;
    pairs.set(row.baseCcy,{symbol:row.instId,base:row.baseCcy,quote:'USDT'});
   }
  }
  const result={expires:ctx.now()+15*60_000,pairs};store.set(provider,result);return result;
 })();
 pending.set(provider,promise);try{return await promise;}finally{pending.delete(provider);}
}

/** Fetch and verify SPOT state/base/quote before creating any price subscription. */
export async function verifiedCryptoPairs(provider:CryptoVenue,assets:Instrument[],ctx:ProviderContext):Promise<Record<string,VerifiedCryptoPair>>{
 const candidates=assets.map(a=>({a,base:cryptoSymbol(a,ctx)})).filter(x=>x.base&&x.base!=='USDT');
 if(!candidates.length)return {};
 const data=await catalog(provider,ctx),out:Record<string,VerifiedCryptoPair>={};
 for(const {a,base} of candidates){const pair=data.pairs.get(base!);if(pair)out[a.assetId]=pair;}
 return out;
}
const nonnegative=(value:unknown)=>{const n=finite(value);return n!==null&&n>=0?n:null;};
function snapshot(a:Instrument,provider:string,symbol:string,ctx:ProviderContext):StandardQuote{
 return {...baseQuote(a,provider,ctx.now()),exchange:provider==='binance'?'BINANCE':provider==='okx'?'OKX':'AGGREGATE',providerSymbol:symbol,currency:provider==='coingecko'?'USD':'USDT',quoteStatus:'SNAPSHOT',changeWindow:'ROLLING_24H',marketStatus:provider==='coingecko'?'UNKNOWN':'OPEN'};
}

export const binanceProvider:Provider={
 id:'binance',supports:a=>(!!cryptoSymbol(a)||a.market==='CRYPTO'&&!!a.legacy.coin)&&a.symbol!=='USDT',
 async fetch(assets,ctx){
  const pairs=await verifiedCryptoPairs('binance',assets,ctx),symbols=[...new Set(Object.values(pairs).map(p=>p.symbol))],records=new Map<string,any>();
  // Explicit batches avoid the substantially higher no-symbol request weight.
  for(let i=0;i<symbols.length;i+=20){
   const url=new URL(`${BINANCE}/api/v3/ticker/24hr`);url.searchParams.set('symbols',JSON.stringify(symbols.slice(i,i+20)));
   const j:any=await (await request(ctx,url.toString())).json();providerCode(j,'binance');
   if(!Array.isArray(j))throw new ProviderError('INVALID_RESPONSE','Binance 批量行情格式无效');
   for(const row of j)if(typeof row.symbol==='string')records.set(row.symbol,row);
  }
  const out:Record<string,StandardQuote>={};
  for(const a of assets){const pair=pairs[a.assetId],row=pair&&records.get(pair.symbol),price=positive(row?.lastPrice);if(!pair||price===null)continue;
   const q=snapshot(a,'binance',pair.symbol,ctx);q.lastPrice=price;q.changePercent=finite(row.priceChangePercent);q.volume=nonnegative(row.volume);q.quoteVolume=nonnegative(row.quoteVolume);q.timestamp=epoch(row.closeTime);
   q.warnings.push('USDT交易对报价；USDT不等于USD。源时间为24小时统计窗口结束时间，不保证是最后成交时间。');
   out[a.assetId]=q;
  }
  return out;
 }
};

export const okxProvider:Provider={
 id:'okx',supports:a=>(!!cryptoSymbol(a)||a.market==='CRYPTO'&&!!a.legacy.coin)&&a.symbol!=='USDT',
 async fetch(assets,ctx){
  const pairs=await verifiedCryptoPairs('okx',assets,ctx);if(!Object.keys(pairs).length)return {};
  const j:any=await (await request(ctx,`${OKX}/api/v5/market/tickers?instType=SPOT`)).json();providerCode(j,'okx');
  if(!Array.isArray(j.data))throw new ProviderError('INVALID_RESPONSE','OKX 现货行情格式无效');
  const records=new Map(j.data.map((row:any)=>[row.instId,row])),out:Record<string,StandardQuote>={};
  for(const a of assets){const pair=pairs[a.assetId],row:any=pair&&records.get(pair.symbol),price=positive(row?.last);if(!pair||price===null||row.instType!=='SPOT')continue;
   const q=snapshot(a,'okx',pair.symbol,ctx),open=positive(row.open24h);q.lastPrice=price;q.changePercent=open===null?null:(price/open-1)*100;q.volume=nonnegative(row.vol24h);q.quoteVolume=nonnegative(row.volCcy24h);q.timestamp=epoch(row.ts);
   q.warnings.push('USDT交易对报价；USDT不等于USD。24小时涨跌使用open24h，未使用UTC自然日开盘价。');
   out[a.assetId]=q;
  }
  return out;
 }
};

export const coingeckoProvider:Provider={
 id:'coingecko',supports:a=>(a.market==='CRYPTO'||a.exchange==='BINANCE_BSTOCKS')&&!!(a.legacy.coin||krakenPair(a.legacy)?.coin),
 async fetch(assets,ctx){
  if(!ctx.config.coingeckoKey)throw new ProviderError('NOT_CONFIGURED','CoinGecko Demo API key 未配置');
  const candidates=assets.filter(a=>coingeckoProvider.supports(a)).map(a=>({...a,legacy:{...a.legacy,coin:a.legacy.coin||krakenPair(a.legacy)?.coin}})).filter(a=>/^[a-z0-9-]{1,80}$/.test(a.legacy.coin||'')),ids=[...new Set(candidates.map(a=>a.legacy.coin!))],records=new Map<string,any>();
  for(let i=0;i<ids.length;i+=250){
   const url=new URL('https://api.coingecko.com/api/v3/coins/markets');url.searchParams.set('vs_currency','usd');url.searchParams.set('ids',ids.slice(i,i+250).join(','));url.searchParams.set('per_page','250');url.searchParams.set('page','1');
   const j:any=await (await request(ctx,url.toString(),{headers:{'x-cg-demo-api-key':ctx.config.coingeckoKey}})).json();
   if(!Array.isArray(j))throw new ProviderError('INVALID_RESPONSE','CoinGecko 市场数据格式无效');
   for(const row of j)if(typeof row.id==='string')records.set(row.id,row);
  }
  const out:Record<string,StandardQuote>={};
  for(const a of candidates){const row=records.get(a.legacy.coin!),price=positive(row?.current_price);if(price===null||String(row.symbol||'').toUpperCase()!==a.symbol.toUpperCase())continue;
   const q=snapshot(a,'coingecko',a.legacy.coin!,ctx);q.lastPrice=price;q.changePercent=finite(row.price_change_percentage_24h);q.marketCap=positive(row.market_cap);q.circulatingSupply=nonnegative(row.circulating_supply);q.quoteVolume=nonnegative(row.total_volume);q.timestamp=typeof row.last_updated==='string'&&Number.isFinite(Date.parse(row.last_updated))?new Date(row.last_updated).toISOString():null;
   q.warnings.push('CoinGecko聚合USD参考价；成交额为聚合24小时USD金额，不是单一交易所基础币成交量。');
   out[a.assetId]=q;
  }
  return out;
 }
};

const binanceIntervals=new Set(['1s','1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M']);
const okxIntervals:Record<string,string>={'1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','2h':'2H','4h':'4H','6h':'6Hutc','12h':'12Hutc','1d':'1Dutc','3d':'3Dutc','1w':'1Wutc','1M':'1Mutc'};
function candle(row:any,provider:CryptoVenue,now:number):Candle|null{
 if(!Array.isArray(row))return null;const time=epoch(row[0]),open=positive(row[1]),high=positive(row[2]),low=positive(row[3]),close=positive(row[4]),volume=nonnegative(row[5]);
 if(time===null||open===null||high===null||low===null||close===null||volume===null||high<Math.max(open,close,low)||low>Math.min(open,close,high))return null;
 const closeTime=finite(row[6]);return {time,open,high,low,close,volume,closed:provider==='binance'?(closeTime===null?null:closeTime<now):row[8]==='1'?true:row[8]==='0'?false:null};
}
export function validateCandleRequest(provider:CryptoVenue,a:Instrument,interval:string,limit:number,ctx:ProviderContext){
 if(!Number.isInteger(limit)||limit<1||limit>(provider==='binance'?1000:300))throw new ProviderError('INVALID_ARGUMENT',`K线条数须为1至${provider==='binance'?1000:300}的整数`);
 if(provider==='binance'?!binanceIntervals.has(interval):!Object.hasOwn(okxIntervals,interval))throw new ProviderError('INVALID_ARGUMENT','该行情源不支持此K线间隔');
 if(!cryptoSymbol(a,ctx)||cryptoSymbol(a,ctx)==='USDT')throw new ProviderError('UNSUPPORTED','该资产尚无已核验的现货K线映射');
}
export async function fetchCryptoCandles(provider:CryptoVenue,a:Instrument,interval:string,limit:number,ctx:ProviderContext):Promise<CandleSeries>{
 validateCandleRequest(provider,a,interval,limit,ctx);
 const pair=(await verifiedCryptoPairs(provider,[a],ctx))[a.assetId];if(!pair)throw new ProviderError('UNSUPPORTED','未核验到可用的现货交易对');
 const url=new URL(provider==='binance'?`${BINANCE}/api/v3/klines`:`${OKX}/api/v5/market/candles`);url.searchParams.set(provider==='binance'?'symbol':'instId',pair.symbol);url.searchParams.set(provider==='binance'?'interval':'bar',provider==='binance'?interval:okxIntervals[interval]);url.searchParams.set('limit',String(limit));
 const j:any=await (await request(ctx,url.toString())).json();providerCode(j,provider);const rows=provider==='binance'?j:j.data;if(!Array.isArray(rows))throw new ProviderError('INVALID_RESPONSE','K线响应格式无效');
 const unique=new Map<string,Candle>();for(const row of rows){const c=candle(row,provider,ctx.now());if(c)unique.set(c.time,c);}
 const candles=[...unique.values()].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));if(!candles.length)throw new ProviderError('UNAVAILABLE','没有有效的现货K线');
 return {assetId:a.assetId,provider,currency:'USDT',interval,adjustment:'UNADJUSTED',candles,receivedAt:new Date(ctx.now()).toISOString()};
}
