import type {Asset,Quote} from './model';
import {quoteRuntime} from './quotes/runtime';
async function request(url:string){const r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'AssetMap/1.0'}});if(!r.ok)throw Error('HTTP '+r.status);return r;}
export async function quote(a:Asset):Promise<Quote>{const result=await quoteRuntime().get([a]);const q=result.quotes[a.id];if(!q)throw Error(result.errors[a.id]||'无有效行情');return q;}
export async function cryptoQuotes(a:Asset[]):Promise<Record<string,Quote>>{return (await quoteRuntime().get(a)).quotes;}

import {parseFundScale,parseNasdaqScale,parseStockScale} from './scale';
async function liveMarketScale(a:Asset){
 const fetched=new Date().toISOString();
 if(a.listing.includes('bStocks'))throw Error('代币化证券不能使用普通美股的股票规模数据');
 if(a.kind==='指数'||a.kind==='加密')throw Error('该资产无独立规模源');
 if(a.kind==='ETF'){
  if(a.tencent&&/^(sh|sz)\d{6}$/.test(a.tencent)){
   const r=await request('https://fundf10.eastmoney.com/jbgk_'+a.symbol+'.html');return parseFundScale(await r.text(),fetched);
  }
  if(a.market==='美股'&&/^[A-Za-z0-9.-]+$/.test(a.symbol)){
   const r=await fetch('https://api.nasdaq.com/api/quote/'+encodeURIComponent(a.symbol)+'/summary?assetclass=etf',{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'Mozilla/5.0'}});if(!r.ok)throw Error('Nasdaq HTTP '+r.status);return parseNasdaqScale(await r.json(),fetched);
  }
  throw Error('该ETF尚无基金规模来源');
 }
 const symbol=a.tencent||(a.market==='美股'?'us'+a.symbol:a.market==='港股'?'hk'+a.symbol.replace(/\.HK$/,'').padStart(5,'0'):null);
 if(!symbol)throw Error('尚无股票总市值来源');
 const r=await request('https://qt.gtimg.cn/q='+encodeURIComponent(symbol));return parseStockScale(new TextDecoder('gbk').decode(await r.arrayBuffer()),a.currency,fetched);
}
import scaleSnapshot from './scale-snapshot.json';
import type {MarketScale} from './scale';
export async function marketScale(a:Asset):Promise<MarketScale>{
 try{return await liveMarketScale(a);}catch(e){
  const fallback=(scaleSnapshot as Record<string,MarketScale>)[a.id];
  if(!fallback)throw e;
  return {...fallback,stale:true,source:fallback.source+'（已核验快照，在线更新失败）'};
 }
}

