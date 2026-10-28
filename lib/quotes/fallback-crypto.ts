import {krakenPair} from '../kraken.ts';
import {request} from './transport.ts';
import {baseQuote,positive,finite,type Provider,type StandardQuote} from './types.ts';
export const krakenProvider:Provider={id:'kraken',supports:a=>!!krakenPair(a.legacy),async fetch(assets,ctx){
 const selected=assets.filter(a=>krakenPair(a.legacy)),pairs=[...new Set(selected.map(a=>krakenPair(a.legacy)!.request))];if(!pairs.length)return {};
 const j:any=await (await request(ctx,'https://api.kraken.com/0/public/Ticker?pair='+pairs.join(','))).json();if(j.error?.length)throw Error('Kraken业务接口拒绝请求');const out:Record<string,StandardQuote>={};
 for(const a of selected){const pair=krakenPair(a.legacy)!,r=j.result?.[pair.response],price=positive(r?.c?.[0]);if(!price)continue;const q=baseQuote(a,'kraken',ctx.now());q.lastPrice=price;q.currency='USD';q.exchange='KRAKEN';q.providerSymbol=pair.socket;q.volume=finite(r.v?.[1]);q.quoteStatus='SNAPSHOT';q.marketStatus='OPEN';q.changeWindow='UTC_DAY';const open=positive(r.o);q.changePercent=open?(price/open-1)*100:null;q.warnings.push('涨跌基准为UTC零点开盘，不是滚动24小时；REST未提供成交时间。');out[a.assetId]=q;}return out;
}};
const coinbaseSymbols=new Set(['ARB','SOL','WIF','USDT','UNI','DOGE','BTC','XRP','HYPE','TURBO','ETH','SHIB','PENGU','PEPE','BNB','ZEC']);
export const coinbaseProvider:Provider={id:'coinbase',supports:a=>!!krakenPair(a.legacy)&&coinbaseSymbols.has(a.symbol),async fetch(assets,ctx){
 const out:Record<string,StandardQuote>={};for(let i=0;i<assets.length;i+=4)await Promise.all(assets.slice(i,i+4).map(async a=>{if(!coinbaseProvider.supports(a))return;try{
  const symbol=a.symbol+'-USD',r:any=await (await request(ctx,'https://api.exchange.coinbase.com/products/'+symbol+'/stats')).json();const price=positive(r.last),open=positive(r.open);if(!price)return;
  const q=baseQuote(a,'coinbase',ctx.now());q.lastPrice=price;q.currency='USD';q.exchange='COINBASE';q.providerSymbol=symbol;q.volume=finite(r.volume);q.changePercent=open?(price/open-1)*100:null;q.changeWindow='ROLLING_24H';q.quoteStatus='SNAPSHOT';q.marketStatus='OPEN';q.warnings.push('Coinbase USD市场快照；此响应未提供成交时间。');out[a.assetId]=q;
 }catch{/* Keep other valid symbols; missing products remain explicitly unavailable. */}}));return out;
}};
