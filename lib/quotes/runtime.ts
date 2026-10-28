import {env} from 'cloudflare:workers';
import {quoteConfig} from './config.ts';
import {D1QuoteStore} from './store.ts';
import {QuoteService} from './service.ts';
import {binanceProvider,okxProvider,coingeckoProvider} from './crypto.ts';
import {longbridgeProvider,alpacaProvider,akshareProvider,legacyProvider} from './equities.ts';
import {krakenProvider,coinbaseProvider} from './fallback-crypto.ts';
export function quoteRuntime(){
 if(!env.DB)throw Error('行情共享缓存数据库未配置');
 return new QuoteService(new D1QuoteStore(env.DB),[longbridgeProvider,alpacaProvider,akshareProvider,binanceProvider,okxProvider,krakenProvider,coinbaseProvider,coingeckoProvider,legacyProvider],{fetch,now:Date.now,config:quoteConfig(env as unknown as Record<string,unknown>)});
}
