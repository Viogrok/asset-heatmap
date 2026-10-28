import type {Asset, Quote} from '../model.ts';

export type QuoteStatus='REALTIME'|'DELAYED'|'SNAPSHOT'|'STALE'|'UNAVAILABLE';
export type MarketStatus='OPEN'|'PRE'|'POST'|'CLOSED'|'HALTED'|'UNKNOWN';
export type ChangeWindow='TRADING_DAY'|'ROLLING_24H'|'UTC_DAY'|'INTERVAL'|'UNKNOWN';
export type Instrument={
 assetId:string; legacyId:string; symbol:string; name:string;
 market:'CRYPTO'|'A'|'HK'|'US'; assetType:'STOCK'|'ETF'|'CRYPTO'|'INDEX'|'FUND';
 exchange:string; currency:string; legacy:Asset;
};
export type StandardQuote={
 assetId:string;symbol:string;name:string;market:Instrument['market'];assetType:Instrument['assetType'];
 exchange:string;currency:string;lastPrice:number|null;changePercent:number|null;previousClose:number|null;
 volume:number|null;quoteVolume:number|null;marketCap:number|null;circulatingSupply:number|null;
 timestamp:string|null;receivedAt:string;provider:string;providerSymbol:string|null;
 quoteStatus:QuoteStatus;delaySeconds:number|null;marketStatus:MarketStatus;
 changeWindow:ChangeWindow;adjustment:'UNADJUSTED'|'UNKNOWN';
 sessionTimeZone:string;warnings:string[];failures:ProviderFailure[];
};
export type ProviderFailure={provider:string;code:string;message:string;retryAt?:number};
export type ProviderContext={fetch:typeof fetch;now:()=>number;config:QuoteConfig};
export type QuoteConfig={
 binanceEnabled:boolean;okxEnabled:boolean;legacyEnabled:boolean;
 coingeckoKey?:string;alpacaKey?:string;alpacaSecret?:string;alpacaFeed:'iex'|'sip'|'delayed_sip';alpacaTradingEnvironment?:'paper'|'live';invescoNavLicensed?:boolean;
 longbridgeUrl?:string;longbridgeToken?:string;akshareUrl?:string;akshareToken?:string;
 longbridgeKey?:string;longbridgeSecret?:string;longbridgeAccessToken?:string;longbridgeDelaySeconds?:number;longbridgeSymbols:Record<string,string>;
 cryptoSymbols:Record<string,string>;
 pollMs:number;cryptoTtlMs:number;equityTtlMs:number;maxStaleMs:number;
 coingeckoMonthlyLimit:number;streamWriteMinuteLimit?:number;legacyRealtimeEnabled?:boolean;
};
export type Provider={id:string;supports:(a:Instrument)=>boolean;fetch:(a:Instrument[],ctx:ProviderContext)=>Promise<Record<string,StandardQuote>>};
export type Candle={time:string;open:number;high:number;low:number;close:number;volume:number;closed:boolean|null};
export type CandleSeries={assetId:string;provider:string;currency:string;interval:string;adjustment:'UNADJUSTED';candles:Candle[];receivedAt:string};
export class ProviderError extends Error{
 code:string;retryAfterMs?:number;
 constructor(code:string,message:string,retryAfterMs?:number){super(message);this.name='ProviderError';this.code=code;this.retryAfterMs=retryAfterMs;}
}
export function baseQuote(a:Instrument,provider:string,now=Date.now()):StandardQuote{
 return {assetId:a.assetId,symbol:a.symbol,name:a.name,market:a.market,assetType:a.assetType,exchange:a.exchange,currency:a.currency,
 lastPrice:null,changePercent:null,previousClose:null,volume:null,quoteVolume:null,marketCap:null,circulatingSupply:null,timestamp:null,receivedAt:new Date(now).toISOString(),provider,providerSymbol:null,
 quoteStatus:'UNAVAILABLE',delaySeconds:null,marketStatus:'UNKNOWN',changeWindow:'UNKNOWN',adjustment:'UNADJUSTED',sessionTimeZone:a.market==='US'?'America/New_York':a.market==='CRYPTO'?'UTC':a.market==='HK'?'Asia/Hong_Kong':'Asia/Shanghai',warnings:[],failures:[]};
}
export const finite=(v:unknown):number|null=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
export const positive=(v:unknown):number|null=>{const n=finite(v);return n!==null&&n>0?n:null;};
export const epoch=(v:unknown,unit:'ms'|'s'='ms'):string|null=>{const n=positive(v);if(n===null)return null;const d=new Date(n*(unit==='s'?1000:1));return Number.isFinite(d.getTime())?d.toISOString():null;};
export function validQuote(q:StandardQuote){return q.lastPrice!==null&&Number.isFinite(q.lastPrice)&&q.lastPrice>0&&q.currency.length>0;}
export function legacyQuote(q:StandardQuote):Quote|null{
 if(!validQuote(q))return null;
 const windows:Record<ChangeWindow,string>={TRADING_DAY:'证券交易日',ROLLING_24H:'滚动24小时',UTC_DAY:'UTC自然日',INTERVAL:'指定区间',UNKNOWN:'供应商未说明'};
 const status:Record<QuoteStatus,string>={REALTIME:'推送',DELAYED:'延迟',SNAPSHOT:'快照',STALE:'过期',UNAVAILABLE:'不可用'};
 return {name:q.name,price:q.lastPrice!,change:q.changePercent,at:q.timestamp,fetched:q.receivedAt,source:q.provider+' · '+status[q.quoteStatus]+(q.delaySeconds!==null?' · 已知延迟 '+q.delaySeconds+'秒':' · 延迟未核验'),window:windows[q.changeWindow]+' · '+q.currency+'报价 · 市场状态 '+q.marketStatus,currency:q.currency,stale:q.quoteStatus==='STALE',standard:q};
}
