import type {Asset} from './model';

// Kraken AssetPairs was checked for each USD spot market. CoinGecko IDs guard
// against mistaking an unrelated token with the same ticker for this asset.
const pairs:Record<string,{coin:string;request:string;response:string}>= {
 BTC:{coin:'bitcoin',request:'XBTUSD',response:'XXBTZUSD'},
 ETH:{coin:'ethereum',request:'ETHUSD',response:'XETHZUSD'},
 SOL:{coin:'solana',request:'SOLUSD',response:'SOLUSD'},
 BNB:{coin:'binancecoin',request:'BNBUSD',response:'BNBUSD'},
 XRP:{coin:'ripple',request:'XRPUSD',response:'XXRPZUSD'},
 TRX:{coin:'tron',request:'TRXUSD',response:'TRXUSD'},
 UNI:{coin:'uniswap',request:'UNIUSD',response:'UNIUSD'},
 ZEC:{coin:'zcash',request:'ZECUSD',response:'XZECZUSD'},
 DOGE:{coin:'dogecoin',request:'DOGEUSD',response:'XDGUSD'},
 ARB:{coin:'arbitrum',request:'ARBUSD',response:'ARBUSD'},
 HYPE:{coin:'hyperliquid',request:'HYPEUSD',response:'HYPEUSD'},
 JST:{coin:'just',request:'JSTUSD',response:'JSTUSD'},
 PENGU:{coin:'pudgy-penguins',request:'PENGUUSD',response:'PENGUUSD'},
 PEPE:{coin:'pepe',request:'PEPEUSD',response:'PEPEUSD'},
 SHIB:{coin:'shiba-inu',request:'SHIBUSD',response:'SHIBUSD'},
 TURBO:{coin:'turbo',request:'TURBOUSD',response:'TURBOUSD'},
 USDT:{coin:'tether',request:'USDTUSD',response:'USDTZUSD'},
 WIF:{coin:'dogwifcoin',request:'WIFUSD',response:'WIFUSD'},
};

// Subscribe to a fixed public list, so the feed request does not reveal a user's holdings.
export const krakenPublicSymbols=Object.keys(pairs).map(symbol=>`${symbol}/USD`);

export function krakenPair(a:Asset){
 if(a.kind!=='加密')return null;
 const symbol=a.symbol.toUpperCase(),pair=pairs[symbol];
 if(!pair)return null;
 const importedBinance=a.id===`binance:${symbol}`&&a.listing==='Binance';
 if(a.coin!==pair.coin&&!importedBinance)return null;
 return {...pair,socket:`${symbol}/USD`};
}
