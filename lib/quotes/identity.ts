import type {Asset} from '../model.ts';
import type {Instrument} from './types.ts';

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
