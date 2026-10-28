import type {Asset} from '../model.ts';
import {krakenPair} from '../kraken.ts';
import type {Instrument} from './types.ts';

const A_STOCK_TICKER=/^(sh|sz|bj)(\d{6})$/i;
const HK_STOCK_TICKER=/^hk(\d{5})$/i;
const US_TICKER=/^us([A-Za-z0-9.^-]{1,32})$/i;
const A_EXCHANGES:Record<string,'XSHG'|'XSHE'|'XBSE'>={sh:'XSHG',sz:'XSHE',bj:'XBSE'};
const HK_INDEX_TENCENT:Record<string,string>={HSI:'hkHSI',HSTECH:'hkHSTECH',HSCE:'hkHSCEI'};
const HK_INDEX_YAHOO:Record<string,string>={HSI:'^HSI',HSTECH:'^HSTECH',HSCE:'^HSCE'};
const US_INDEX_TENCENT:Record<string,string>={SPX:'us.INX',NDX:'us.NDX',IXIC:'us.IXIC',DJI:'us.DJI'};
const US_INDEX_YAHOO:Record<string,string>={SPX:'^GSPC',NDX:'^NDX',IXIC:'^IXIC',DJI:'^DJI'};
const BSTOCKS=new Set(['MSTRB','BMNRB','CRCLB','COINB','HOODB']);

export class AssetMappingError extends Error {
 readonly code='ASSET_MAPPING_INVALID';
 constructor(){super('资产代码、市场、币种或行情源标识不匹配');this.name='AssetMappingError';}
}

export function tencentResponseMatches(a:Instrument,code:unknown):boolean{
 if(typeof code!=='string'||!code||!a.legacy.tencent)return true;
 const aShare=A_STOCK_TICKER.exec(a.legacy.tencent);
 if(aShare)return code===aShare[2];
 const hk=HK_STOCK_TICKER.exec(a.legacy.tencent);
 if(hk)return numericEqual(code,hk[1]);
 const us=US_TICKER.exec(a.legacy.tencent);
 if(us&&a.assetType!=='INDEX')return code.toUpperCase()===us[1].toUpperCase();
 return true;
}

const reject=():never=>{throw new AssetMappingError();};
const equal=(a:string|undefined,b:string|undefined)=>a!==undefined&&b!==undefined&&a.toUpperCase()===b.toUpperCase();
const numericEqual=(a:string,b:string)=>/^\d+$/.test(a)&&/^\d+$/.test(b)&&Number(a)===Number(b);

/**
 * Validate identity-bearing source fields before a user asset can reach a shared
 * quote cache. Display IDs remain unchanged; provider tickers must identify the
 * same listing as the canonical symbol.
 */
export function validateAssetMapping(a:Asset):void{
 if(!a||typeof a.id!=='string'||typeof a.symbol!=='string'||!a.symbol.trim()||typeof a.name!=='string'||typeof a.listing!=='string'||typeof a.currency!=='string'||!['A股','港股','美股','加密'].includes(a.market)||!['ETF','指数','加密','股票'].includes(a.kind))reject();
 if((a.market==='加密')!==(a.kind==='加密'))reject();

 const symbol=a.symbol.trim(),upper=symbol.toUpperCase();
 const tokenized=a.id.startsWith('binance:')&&a.listing.includes('bStocks');
 if(tokenized){
  if(a.market!=='美股'||a.kind!=='股票'||a.currency!=='USD'||a.id!==`binance:${upper}`||!BSTOCKS.has(upper)||a.tencent||a.yahoo||a.coin)reject();
  return;
 }
 if(a.listing.includes('bStocks'))reject();

 if(a.market==='加密'){
  if(a.currency!=='USD'||a.tencent||a.yahoo||!/^[A-Za-z0-9]{1,30}$/.test(symbol))reject();
  const imported=a.id===`binance:${upper}`&&a.listing==='Binance';
  if(a.id.startsWith('binance:')&&!imported)reject();
  const pair=krakenPair(a);
  if(pair&&a.coin&&a.coin!==pair.coin)reject();
  if(a.coin&&upper==='USDC'&&a.coin!=='usd-coin')reject();
  if(a.coin&&!pair&&upper!=='USDC'&&imported)reject();
  if(a.coin&&!pair&&upper==='USDC'&&a.coin!=='usd-coin')reject();
  return;
 }

 if(a.market==='A股'){
  if(a.currency!=='CNY'||!/^[0-9]{6}$/.test(symbol))reject();
  let expectedExchange:'XSHG'|'XSHE'|'XBSE';
  try{expectedExchange=aShareExchange(symbol);}catch{return reject();}
  if(a.tencent){
   const match=A_STOCK_TICKER.exec(a.tencent);if(!match)return reject();if(match[2]!==symbol)reject();
   if(a.kind!=='指数'&&A_EXCHANGES[match[1].toLowerCase()]!==expectedExchange)reject();
  }
  if(a.yahoo&&!new RegExp(`^${symbol}\\.(SS|SZ|BJ)$`,'i').test(a.yahoo))reject();
  if(a.yahoo){const suffix=a.yahoo.slice(-2).toUpperCase(),exchange=suffix==='SS'?'XSHG':suffix==='SZ'?'XSHE':'XBSE';if(a.kind!=='指数'&&exchange!==expectedExchange)reject();}
  return;
 }

 if(a.market==='港股'){
  const aShare=A_STOCK_TICKER.exec(a.tencent||'');
  if(aShare){
   // These are HK-theme ETFs listed in Shanghai/Shenzhen; their traded price is CNY.
   if(a.kind!=='ETF'||a.currency!=='CNY'||aShare[2]!==symbol)reject();
   if(A_EXCHANGES[aShare[1].toLowerCase()]!==aShareExchange(symbol))reject();
   if(a.yahoo&&!new RegExp(`^${symbol}\\.(SS|SZ|BJ)$`,'i').test(a.yahoo))reject();
   if(a.yahoo){const suffix=a.yahoo.slice(-2).toUpperCase(),exchange=suffix==='SS'?'XSHG':suffix==='SZ'?'XSHE':'XBSE';if(exchange!==A_EXCHANGES[aShare[1].toLowerCase()])reject();}
   return;
  }
  if(a.currency!=='HKD')reject();
  const hk=HK_STOCK_TICKER.exec(a.tencent||'');
  if(hk){
   if(!/^[0-9]{1,5}(?:\.HK)?$/i.test(symbol)||!numericEqual(hk[1],symbol.replace(/\.HK$/i,'')))reject();
   if(a.yahoo){const y=/^(\d{1,5})\.HK$/i.exec(a.yahoo);if(!y||!numericEqual(y[1],symbol.replace(/\.HK$/i,'')))reject();}
   return;
  }
  if(a.kind==='指数'){
   const t=HK_INDEX_TENCENT[upper],y=HK_INDEX_YAHOO[upper];
   if(a.tencent&&!equal(a.tencent,t))reject();if(a.yahoo&&!equal(a.yahoo,y))reject();
   if(a.tencent||a.yahoo||upper==='HSHKDIVLV')return;
  }
  reject();
 }

 if(a.market==='美股'){
  if(a.currency!=='USD')reject();
  if(a.kind==='指数'){
   const t=US_INDEX_TENCENT[upper],y=US_INDEX_YAHOO[upper];
   if(a.tencent&&!equal(a.tencent,t))reject();if(a.yahoo&&!equal(a.yahoo,y))reject();
   if(t||y)return;
   reject();
  }
  if(!/^[A-Za-z0-9.^-]{1,32}$/.test(symbol))reject();
  if(a.tencent){const match=US_TICKER.exec(a.tencent);if(!match||!equal(match[1],symbol))reject();}
  if(a.yahoo){
   // Yahoo uses a hyphen for several US share classes displayed with a dot.
   const alternate=upper.replace(/\./g,'-');if(!equal(a.yahoo,upper)&&!equal(a.yahoo,alternate))reject();
  }
  return;
 }
 reject();
}

export function aShareExchange(code:string):'XSHG'|'XSHE'|'XBSE'{
 if(!/^\d{6}$/.test(code))throw Error('A股代码须为6位数字');
 if(/^(4|8|92)/.test(code))return 'XBSE';
 if(/^[0356]/.test(code))return /^[56]/.test(code)?'XSHG':'XSHE';
 if(/^1/.test(code))return 'XSHE';
 throw Error('未知A股交易所，请提供明确的市场映射');
}
export function instrument(a:Asset):Instrument{
 const market=({'A股':'A','港股':'HK','美股':'US','加密':'CRYPTO'} as const)[a.market];
 const assetType=({'股票':'STOCK','ETF':'ETF','指数':'INDEX','加密':'CRYPTO'} as const)[a.kind];
 const tokenized=a.id.startsWith('binance:')&&a.listing.includes('bStocks');
 let exchange=market==='CRYPTO'?'REFERENCE':market==='HK'?'XHKG':market==='US'?'US':a.tencent?.startsWith('sz')?'XSHE':a.tencent?.startsWith('bj')?'XBSE':a.tencent?.startsWith('sh')?'XSHG':aShareExchange(a.symbol);
 if(tokenized)exchange='BINANCE_BSTOCKS';
 // Investment direction (a.market) is distinct from the actual listing venue.
 if(a.tencent?.match(/^(sh|sz|bj)\d{6}$/))exchange=a.tencent.startsWith('sh')?'XSHG':a.tencent.startsWith('sz')?'XSHE':'XBSE';
 const actualMarket=exchange==='XSHG'||exchange==='XSHE'||exchange==='XBSE'?'A':market;
 const symbol=market==='HK'&&/^\d+(\.HK)?$/.test(a.symbol)?a.symbol.replace(/\.HK$/,'').padStart(5,'0'):a.symbol;
 const identity=tokenized?a.id:market==='CRYPTO'?(a.coin?`coingecko:${a.coin}`:a.id):symbol;
 return {assetId:`${actualMarket}:${exchange}:${assetType}:${identity}`,legacyId:a.id,symbol,name:a.name,market:actualMarket,assetType,exchange,currency:a.currency,legacy:a};
}
