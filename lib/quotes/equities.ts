import {baseQuote,epoch,finite,positive,ProviderError,type Instrument,type Provider,type ProviderContext,type StandardQuote} from './types.ts';
import {bridgeUrl,request} from './transport.ts';
import {sessionAt,tradingDay} from './sessions.ts';

const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const bytes=(s:string)=>new TextEncoder().encode(s);
/** Exact legacy HTTP signing algorithm from the official Longbridge Rust SDK. */
export async function longbridgeHeaders(key:string,secret:string,token:string,path:string,body:string,now:number){
 const ts=String(Math.floor(now/1000)),signed='authorization;x-api-key;x-timestamp';
 const digest=async(s:string)=>hex(await crypto.subtle.digest('SHA-1',bytes(s)));
 const values=`authorization:${token}\nx-api-key:${key}\nx-timestamp:${ts}\n`;
 const canonical=`POST|${path}||${values}|${signed}|${await digest(body)}`;
 const mac=await crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=hex(await crypto.subtle.sign('HMAC',mac,bytes(`HMAC-SHA256|${await digest(canonical)}`)));
 return {'Content-Type':'application/json; charset=utf-8','X-Api-Key':key,Authorization:token,'X-Timestamp':ts,'X-Api-Signature':`HMAC-SHA256 SignedHeaders=${signed}, Signature=${sig}`,'x-dc-region':[key,secret,token].some(x=>x.startsWith('us_'))?'us':'ap'};
}
function lbSymbol(a:Instrument,ctx:ProviderContext){
 const explicit=ctx.config.longbridgeSymbols[a.assetId]||ctx.config.longbridgeSymbols[a.legacyId];if(explicit)return explicit;
 if(a.assetType==='INDEX'||a.exchange==='BINANCE_BSTOCKS')return null;
 if(a.market==='US')return a.symbol+'.US';if(a.market==='HK'&&/^\d+$/.test(a.symbol))return Number(a.symbol)+'.HK';
 if(a.exchange==='XSHG')return a.symbol+'.SH';if(a.exchange==='XSHE')return a.symbol+'.SZ';return null;
}
export const longbridgeProvider:Provider={id:'longbridge',supports:a=>a.market!=='CRYPTO'&&a.exchange!=='BINANCE_BSTOCKS',async fetch(assets,ctx){
 const c=ctx.config;if(c.longbridgeUrl)return bridge('longbridge',assets,ctx);
 if(!c.longbridgeKey||!c.longbridgeSecret||!c.longbridgeAccessToken)throw new ProviderError('NOT_CONFIGURED','Longbridge服务端凭据未配置');
 const mapped=assets.map(a=>({a,s:lbSymbol(a,ctx)})).filter(x=>x.s);if(!mapped.length)throw new ProviderError('UNSUPPORTED_SYMBOL','Longbridge标识或指数权限尚未核验');
 const path='/quote/quotes',body=JSON.stringify({symbol:mapped.map(x=>x.s)});const headers=await longbridgeHeaders(c.longbridgeKey,c.longbridgeSecret,c.longbridgeAccessToken,path,body,ctx.now());
 const j:any=await (await request(ctx,'https://openapi.longbridge.com'+path,{method:'POST',headers,body})).json();
 if(Number(j.code)!==0)throw new ProviderError('AUTH_OR_ENTITLEMENT','Longbridge业务接口拒绝或行情权限不足');
 const out:Record<string,StandardQuote>={};for(const row of j.data?.secu_quote||[]){const m=mapped.find(x=>x.s===row.symbol);if(!m||!positive(row.last_done))continue;
  const q=baseQuote(m.a,'longbridge',ctx.now());q.providerSymbol=row.symbol;q.lastPrice=positive(row.last_done);q.previousClose=positive(row.prev_close);q.changePercent=q.previousClose?(q.lastPrice!/q.previousClose-1)*100:null;
  q.timestamp=epoch(row.timestamp,'s');q.volume=finite(row.volume);q.currency=row.currency||m.a.currency;q.changeWindow='TRADING_DAY';q.delaySeconds=c.longbridgeDelaySeconds??null;
  q.quoteStatus=q.delaySeconds!==null&&q.delaySeconds>0?'DELAYED':'SNAPSHOT';q.marketStatus=[1,3,7,10].includes(Number(row.trade_status))?'HALTED':'UNKNOWN';
  q.warnings.push('仅使用常规时段报价；盘前、盘后及夜盘子报价未与常规价格混合。');if(q.delaySeconds===null)q.warnings.push('未核验此账户和标的的实时/延迟权限。');out[m.a.assetId]=q;
 }return out;
}};
export const alpacaProvider:Provider={id:'alpaca',supports:a=>a.market==='US'&&['STOCK','ETF'].includes(a.assetType)&&a.exchange!=='BINANCE_BSTOCKS',async fetch(assets,ctx){
 const c=ctx.config;if(!c.alpacaKey||!c.alpacaSecret)throw new ProviderError('NOT_CONFIGURED','Alpaca服务端凭据未配置');
 const selected=assets.filter(a=>alpacaProvider.supports(a));if(!selected.length)return {};
 const url='https://data.alpaca.markets/v2/stocks/snapshots?symbols='+selected.map(x=>encodeURIComponent(x.symbol)).join(',')+'&feed='+c.alpacaFeed;
 const j:any=await (await request(ctx,url,{headers:{'APCA-API-KEY-ID':c.alpacaKey,'APCA-API-SECRET-KEY':c.alpacaSecret}})).json();const out:Record<string,StandardQuote>={};
 for(const a of selected){const row=j[a.symbol];if(!positive(row?.latestTrade?.p))continue;const q=baseQuote(a,'alpaca:'+c.alpacaFeed,ctx.now());q.lastPrice=positive(row.latestTrade.p);q.timestamp=typeof row.latestTrade.t==='string'?row.latestTrade.t:null;q.previousClose=positive(row.prevDailyBar?.c);q.volume=finite(row.dailyBar?.v);q.changePercent=q.previousClose?(q.lastPrice!/q.previousClose-1)*100:null;q.providerSymbol=a.symbol;q.currency='USD';q.exchange=c.alpacaFeed==='iex'?'IEX':'US_CONSOLIDATED';q.delaySeconds=c.alpacaFeed==='delayed_sip'?900:0;q.quoteStatus=c.alpacaFeed==='delayed_sip'?'DELAYED':'SNAPSHOT';q.changeWindow='TRADING_DAY';
  q.warnings.push(c.alpacaFeed==='iex'?'IEX单一交易所行情，不代表全美综合行情。':'SIP权限以实际API响应为准。');q.warnings.push('涨跌相对上一交易日未复权收盘；拆股等公司行为可能导致不可比，未自动跨公司行为核算收益。');out[a.assetId]=q;}return out;
}};
async function bridge(provider:'longbridge'|'akshare',assets:Instrument[],ctx:ProviderContext){
 const url=bridgeUrl(provider==='longbridge'?ctx.config.longbridgeUrl:ctx.config.akshareUrl),token=provider==='longbridge'?ctx.config.longbridgeToken:ctx.config.akshareToken;
 if(!url||!token)throw new ProviderError('NOT_CONFIGURED',`${provider}授权桥接未配置`);
 const requested=assets.filter(a=>a.market!=='CRYPTO'&&a.exchange!=='BINANCE_BSTOCKS');
 const j:any=await (await request(ctx,url+'/quotes',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({instruments:requested.map(({assetId,symbol,market,assetType,exchange,currency})=>({assetId,symbol,market,assetType,exchange,currency}))})})).json();
 const out:Record<string,StandardQuote>={};for(const row of j.quotes||[]){const a=requested.find(x=>x.assetId===row.assetId);if(!a||!positive(row.lastPrice)||typeof row.currency!=='string'||row.currency!==a.currency)continue;const q={...baseQuote(a,provider+':gateway',ctx.now()),lastPrice:positive(row.lastPrice),previousClose:positive(row.previousClose),changePercent:finite(row.changePercent),volume:finite(row.volume),marketCap:positive(row.marketCap),timestamp:typeof row.timestamp==='string'&&Number.isFinite(Date.parse(row.timestamp))?row.timestamp:null,providerSymbol:row.providerSymbol||a.symbol,delaySeconds:finite(row.delaySeconds),changeWindow:'TRADING_DAY' as const};
  q.quoteStatus=q.delaySeconds!==null&&q.delaySeconds>0?'DELAYED':'SNAPSHOT';q.marketStatus=['OPEN','PRE','POST','CLOSED','HALTED'].includes(row.marketStatus)?row.marketStatus:sessionAt(ctx.now(),tradingDay(row.tradingDay));q.warnings.push('桥接REST快照；实时权限、交易日历与数据许可由桥接方核验。');out[a.assetId]=q;}return out;
}
export const akshareProvider:Provider={id:'akshare',supports:a=>a.market!=='CRYPTO'&&a.exchange!=='BINANCE_BSTOCKS',fetch:(a,c)=>bridge('akshare',a,c)};

export function parseTencent(a:Instrument,text:string,now:number):StandardQuote|null{
 const v=text.split('"')[1]?.split('~');if(!v||!positive(v[3]))return null;const q=baseQuote(a,'tencent-public',now);q.name=v[1]||a.name;q.lastPrice=positive(v[3]);q.previousClose=positive(v[4]);q.changePercent=finite(v[32]);q.providerSymbol=a.legacy.tencent||null;q.changeWindow='TRADING_DAY';q.quoteStatus='SNAPSHOT';
 const t=(v[30]||'').replace(/[-/ :]/g,'');if(a.market!=='US'&&/^\d{14}$/.test(t))q.timestamp=new Date(`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(8,10)}:${t.slice(10,12)}:${t.slice(12,14)}+08:00`).toISOString();
 q.warnings.push('非保证公开接口，延迟和成交量单位未核验；美股无时区时间不作为成交时间。');return q;
}
export function parseYahoo(a:Instrument,j:any,now:number):StandardQuote|null{
 const result=j.chart?.result?.[0],m=result?.meta;if(!positive(m?.regularMarketPrice))return null;const q=baseQuote(a,'yahoo-public',now);q.name=m.longName||m.shortName||a.name;q.lastPrice=positive(m.regularMarketPrice);q.previousClose=positive(m.previousClose); // chartPreviousClose is a range baseline, NOT necessarily yesterday.
 q.changePercent=q.previousClose?(q.lastPrice!/q.previousClose-1)*100:null;q.timestamp=epoch(m.regularMarketTime,'s');q.currency=m.currency||a.currency;q.providerSymbol=a.legacy.yahoo||null;q.changeWindow='TRADING_DAY';q.quoteStatus='SNAPSHOT';q.warnings.push('非保证公开接口；未取得可靠上一交易日收盘时不计算涨跌。');return q;
}
export const legacyProvider:Provider={id:'legacy-public',supports:a=>!!(a.legacy.tencent||a.legacy.yahoo)&&a.exchange!=='BINANCE_BSTOCKS',async fetch(assets,ctx){
 if(!ctx.config.legacyEnabled)throw new ProviderError('DISABLED','公开网页兼容行情已关闭');const out:Record<string,StandardQuote>={};
 // Small bounded batches keep Worker subrequests and third-party pressure controlled.
 for(let i=0;i<assets.length;i+=4)await Promise.all(assets.slice(i,i+4).map(async a=>{if(a.legacy.tencent)try{const r=await request(ctx,'https://qt.gtimg.cn/q='+encodeURIComponent(a.legacy.tencent));const q=parseTencent(a,new TextDecoder('gbk').decode(await r.arrayBuffer()),ctx.now());if(q){out[a.assetId]=q;return;}}catch{/* Next source; no credential or upstream body is logged. */}
  if(a.legacy.yahoo)try{const j=await (await request(ctx,'https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(a.legacy.yahoo)+'?interval=1d&range=5d')).json();const q=parseYahoo(a,j,ctx.now());if(q)out[a.assetId]=q;}catch{/* Explicit UNAVAILABLE is generated by the service. */}}));return out;
}};
