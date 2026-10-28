import type {QuoteConfig} from './types.ts';
const number=(v:unknown,fallback:number,min:number,max:number)=>{const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max?n:fallback;};
export function quoteConfig(env:Record<string,unknown>):QuoteConfig{
 const s=(k:string)=>typeof env[k]==='string'?String(env[k]).trim()||undefined:undefined;
 const delay=s('LONGBRIDGE_VERIFIED_DELAY_SECONDS'),verifiedDelay=delay!==undefined&&Number.isFinite(Number(delay))&&Number(delay)>=0?Number(delay):undefined;
 let longbridgeSymbols:Record<string,string>={};try{const m=JSON.parse(s('LONGBRIDGE_SYMBOLS_JSON')||'{}');if(m&&typeof m==='object'&&!Array.isArray(m))for(const [k,v] of Object.entries(m))if(typeof v==='string'&&/^[A-Za-z0-9.^-]{1,32}$/.test(v))longbridgeSymbols[k]=v;}catch{/* Invalid mapping disables explicit symbol overrides. */}
 const cryptoSymbols:Record<string,string>={};try{const m=JSON.parse(s('CRYPTO_SYMBOLS_JSON')||'{}');if(m&&typeof m==='object'&&!Array.isArray(m))for(const [k,v] of Object.entries(m))if(typeof v==='string'&&/^[A-Z0-9]{1,30}$/.test(v))cryptoSymbols[k]=v;}catch{/* No implicit ticker mapping. */}
 return {binanceEnabled:s('QUOTE_BINANCE_ENABLED')!=='false',okxEnabled:s('QUOTE_OKX_ENABLED')!=='false',legacyEnabled:s('QUOTE_LEGACY_ENABLED')!=='false',
 coingeckoKey:s('COINGECKO_DEMO_API_KEY'),alpacaKey:s('ALPACA_API_KEY'),alpacaSecret:s('ALPACA_API_SECRET'),alpacaFeed:s('ALPACA_FEED')==='sip'?'sip':s('ALPACA_FEED')==='delayed_sip'?'delayed_sip':'iex',alpacaTradingEnvironment:s('ALPACA_TRADING_ENV')==='live'?'live':'paper',invescoNavLicensed:s('INVESCO_NAV_LICENSE_CONFIRMED')==='true',
 longbridgeUrl:s('LONGBRIDGE_GATEWAY_URL'),longbridgeToken:s('LONGBRIDGE_GATEWAY_TOKEN'),akshareUrl:s('AKSHARE_GATEWAY_URL'),akshareToken:s('AKSHARE_GATEWAY_TOKEN'),
 longbridgeKey:s('LONGBRIDGE_APP_KEY'),longbridgeSecret:s('LONGBRIDGE_APP_SECRET'),longbridgeAccessToken:s('LONGBRIDGE_ACCESS_TOKEN'),longbridgeDelaySeconds:verifiedDelay,longbridgeSymbols,cryptoSymbols,
 pollMs:number(s('QUOTE_POLL_SECONDS'),5,5,300)*1000,cryptoTtlMs:number(s('QUOTE_CRYPTO_TTL_SECONDS'),10,5,300)*1000,equityTtlMs:number(s('QUOTE_EQUITY_TTL_SECONDS'),30,10,900)*1000,
 maxStaleMs:number(s('QUOTE_MAX_STALE_SECONDS'),86400,60,604800)*1000,coingeckoMonthlyLimit:number(s('COINGECKO_MONTHLY_LIMIT'),8000,1,10000),streamWriteMinuteLimit:number(s('QUOTE_STREAM_WRITES_PER_MINUTE'),40,6,3000)};
}
