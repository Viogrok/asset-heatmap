import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {instrument,aShareExchange} from '../lib/quotes/identity.ts';
import {quoteConfig} from '../lib/quotes/config.ts';
import {baseQuote,ProviderError,type Provider,type StandardQuote} from '../lib/quotes/types.ts';
import {QuoteService,quoteKey} from '../lib/quotes/service.ts';
import {D1QuoteStore} from '../lib/quotes/store.ts';
import {parseYahoo,parseTencent,longbridgeHeaders,alpacaProvider} from '../lib/quotes/equities.ts';
import {binanceProvider,coingeckoProvider,fetchCryptoCandles} from '../lib/quotes/crypto.ts';
import {priceForCost} from '../lib/quotes/conversion.ts';
import {formatMoney} from '../lib/quotes/format.ts';
import {sessionAt} from '../lib/quotes/sessions.ts';
import {assets,initial,validateState,type Asset} from '../lib/model.ts';

function store(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE quote_cache(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated INTEGER NOT NULL)');db.exec(readFileSync(new URL('../drizzle/0001_market_data.sql',import.meta.url),'utf8'));
 const wrap={prepare(sql:string){let values:unknown[]=[];return {bind(...args:unknown[]){values=args;return this;},async first(){return db.prepare(sql).get(...values as any[])||null;},async run(){return db.prepare(sql).run(...values as any[]);},async all<T>(){return {results:db.prepare(sql).all(...values as any[]) as T[]};}};},async batch<T>(statements:D1PreparedStatement[]){return Promise.all(statements.map(s=>s.all<T>()));}};
 return new D1QuoteStore(wrap as unknown as D1Database);
}
const btc=assets.find(a=>a.id==='BTC')!,aapl:Asset={id:'US:AAPL',symbol:'AAPL',name:'Apple',market:'美股',listing:'NASDAQ',currency:'USD',kind:'股票',yahoo:'AAPL'};
test('跨市场、交易所、资产类型唯一标识不会把同名代码合并',()=>{
 assert.notEqual(instrument({id:'stock',symbol:'000001',name:'平安银行',market:'A股',listing:'深圳',currency:'CNY',kind:'股票'}).assetId,instrument(assets.find(a=>a.id==='000001')!).assetId);
 assert.equal(instrument(assets.find(a=>a.id==='513130')!).market,'A');assert.equal(aShareExchange('300750'),'XSHE');assert.equal(aShareExchange('920001'),'XBSE');assert.equal(aShareExchange('510500'),'XSHG');assert.throws(()=>aShareExchange('ABC'));
});
test('已核验的港、美、北交所映射可保存，不能注入任意行情URL',()=>{const custom:Asset[]=[{id:'HK:700',symbol:'00700',name:'腾讯',market:'港股',listing:'香港',currency:'HKD',kind:'股票',tencent:'hk00700'},{...aapl,tencent:'usAAPL'},{id:'BJ:920002',symbol:'920002',name:'北交所标的',market:'A股',listing:'XBSE',currency:'CNY',kind:'股票',tencent:'bj920002'}];assert.doesNotThrow(()=>validateState({...initial(),custom}));assert.throws(()=>validateState({...initial(),custom:[{...aapl,tencent:'https://invalid'}]}));});
test('D1共享租约互斥、到期接管与配额具有真实SQLite语义',async()=>{const s=store();assert.equal(await s.lease('q','a',1000,100),true);assert.equal(await s.lease('q','b',1001,100),false);await s.release('q','b');assert.equal(await s.lease('q','b',1100,100),true);assert.equal(await s.budget('p',2,60000,0),true);assert.equal(await s.budget('p',2,60000,1),true);assert.equal(await s.budget('p',2,60000,2),false);assert.equal(await s.budget('p',2,60000,60000),true);});
test('D1批量写入保留最新接收报价，批量读取跨分块且去重',async()=>{
 const s=store(),keys=Array.from({length:161},(_,i)=>`batch:${i}`),asset=instrument(btc),key=quoteKey(asset.assetId);
 await s.putMany(keys.map((entry,i)=>({key:entry,value:{index:i}})),5000);
 const newer={...baseQuote(asset,'new',20000),lastPrice:9},older={...baseQuote(asset,'old',10000),lastPrice:1};
 await s.putMany([{key,value:newer}],30000);await s.putMany([{key,value:older}],40000);
 const result=await s.getMany<{index:number}|StandardQuote>([...keys,key,key]);
 assert.equal(result.size,162,'161条普通记录加一条报价，重复key只返回一次');
 assert.equal((result.get(key)?.value as StandardQuote|undefined)?.lastPrice,9,'较旧receivedAt不得覆盖已持久化的新报价');
 assert.equal((result.get('batch:160')?.value as {index:number}|undefined)?.index,160);
});
test('451冷却不重试受限源，切换币种时整体替换并标记来源',async()=>{
 const s=store();let now=100000,blocked=0;const old={...baseQuote(instrument(btc),'old',now-100000),lastPrice:5,currency:'USDT'};await s.put(quoteKey(old.assetId),old,now-100000);
 const providers:Provider[]=[{id:'binance',supports:()=>true,fetch:async()=>{blocked++;throw new ProviderError('REGION_RESTRICTED','地区限制');}},{id:'other',supports:()=>true,fetch:async([a])=>({[a.assetId]:{...baseQuote(a,'other',now),lastPrice:10,currency:'USD'}})}];
 const svc=new QuoteService(s,providers,{fetch,now:()=>now,config:quoteConfig({})});const q=(await svc.get([btc])).standardQuotes[old.assetId];assert.equal(q.currency,'USD');assert.equal(q.previousClose,null);assert.ok(q.warnings.some(x=>x.includes('USDT')));assert.ok(q.failures.some(x=>x.code==='REGION_RESTRICTED'));
 now+=100000;await svc.get([btc]);assert.equal(blocked,1);now=100000+86400000+1;await svc.get([btc]);assert.equal(blocked,2,'读取冷却状态不能把到期时间无限向后推');
});
test('失败保留真实接收时间，过期价格不会补零或假装更新',async()=>{const s=store();let now=100000;const a=instrument(btc),old={...baseQuote(a,'source',1000),lastPrice:7};await s.put(quoteKey(a.assetId),old,1000);const svc=new QuoteService(s,[],{fetch,now:()=>now,config:quoteConfig({QUOTE_MAX_STALE_SECONDS:'60'})});const q=(await svc.get([btc])).standardQuotes[a.assetId];assert.equal(q.quoteStatus,'UNAVAILABLE');assert.equal(q.lastPrice,null);now=2000;const result=await svc.get([btc]);assert.equal(result.standardQuotes[a.assetId].receivedAt,old.receivedAt);});
test('较旧推送不能覆盖已收到的新行情',async()=>{const s=store(),a=instrument(btc);await s.put(quoteKey(a.assetId),{...baseQuote(a,'new',2000),lastPrice:9},9000);await s.put(quoteKey(a.assetId),{...baseQuote(a,'old',1000),lastPrice:1},10000);assert.equal((await s.get<StandardQuote>(quoteKey(a.assetId)))!.value.lastPrice,9);});
test('缺少可选密钥时不发请求、不消耗CoinGecko月预算',async()=>{const s=store();let calls=0;const ctx={fetch:(async()=>{calls++;throw Error('不应调用');}) as typeof fetch,now:()=>100000,config:quoteConfig({})};await assert.rejects(()=>coingeckoProvider.fetch([instrument(btc)],ctx),/未配置/);assert.equal(calls,0);});
test('Yahoo区间基准不是昨收，美股腾讯无时区时间不能冒充UTC+8',()=>{const a=instrument(aapl);const q=parseYahoo(a,{chart:{result:[{meta:{regularMarketPrice:100,chartPreviousClose:50,regularMarketTime:1}}]}},1000)!;assert.equal(q.previousClose,null);assert.equal(q.changePercent,null);const parts=Array(33).fill('');parts[1]='Apple';parts[3]='100';parts[4]='90';parts[30]='20261027160000';parts[32]='11.11';assert.equal(parseTencent(a,'v="'+parts.join('~')+'";',0)!.timestamp,null);});
test('USDT/USD缺失时成本换算失败，不产生虚假的浮盈亏',()=>{const q={price:10,change:0,at:null,fetched:'',source:'',window:'',currency:'USDT'};assert.equal(priceForCost(btc,q,{rates:{USD:1,CNY:7}}),null);assert.equal(priceForCost(btc,q,{rates:{USD:1,USDT:2}}),5);});
test('真实USDT及其他代币报价可以渲染，不能触发Intl货币异常或改标USD',()=>{assert.match(formatMoney(123.45,'USDT',8),/USDT$/);assert.doesNotMatch(formatMoney(123.45,'USDT',8),/USD\s|US\$/);assert.match(formatMoney(123,'USD',8),/US\$/);assert.doesNotThrow(()=>formatMoney(0.000001,'USDC',8));});
test('交易日历明确处理早收市、非交易日、盘前和DST，不按工作日猜市场状态',()=>{const day={date:'2026-11-27',timeZone:'America/New_York',trading:true,regular:[['09:30','13:00']] as [string,string][],pre:['04:00','09:30'] as [string,string],post:['13:00','17:00'] as [string,string]};assert.equal(sessionAt(Date.parse('2026-11-27T18:30Z'),day),'POST');assert.equal(sessionAt(Date.parse('2026-11-27T12:00Z'),day),'PRE');assert.equal(sessionAt(Date.parse('2026-11-28T12:00Z'),day),'UNKNOWN');assert.equal(sessionAt(Date.now(),undefined),'UNKNOWN');});
test('Longbridge签名不在返回quote中泄露凭据，AlpacaIEX明确非综合行情',async()=>{
 const h=await longbridgeHeaders('us_example','private','us_token','/quote/quotes','{"symbol":["AAPL.US"]}',1000);assert.equal(h['x-dc-region'],'us');assert.equal(h['X-Api-Signature'],'HMAC-SHA256 SignedHeaders=authorization;x-api-key;x-timestamp, Signature=29c002c06de1ad5d0f6e1cf7d5ae43dd907605f216aba1aac05b5e3ce661cdbc');assert.equal(h['X-Timestamp'],'1');
 const ctx={config:quoteConfig({ALPACA_API_KEY:'test',ALPACA_API_SECRET:'test'}),now:()=>100000,fetch:(async()=>new Response(JSON.stringify({AAPL:{latestTrade:{p:100,t:'2026-10-27T15:00Z'},prevDailyBar:{c:80},dailyBar:{v:10}}}))) as typeof fetch};const q=(await alpacaProvider.fetch([instrument(aapl)],ctx))[instrument(aapl).assetId];assert.equal(q.exchange,'IEX');assert.equal(q.changePercent,25);assert.ok(q.warnings.some(x=>x.includes('不代表全美')));
});
test('Binance只接受已验证现货，保留USDT与滚动24h，K线参数拒绝注入',async()=>{
 const mock=(async(url:any)=>new Response(JSON.stringify(String(url).includes('exchangeInfo')?{symbols:[{baseAsset:'BTC',quoteAsset:'USDT',symbol:'BTCUSDT',status:'TRADING',isSpotTradingAllowed:true}]}:[{symbol:'BTCUSDT',lastPrice:'100',priceChangePercent:'2',volume:'5',quoteVolume:'500',closeTime:100000}]))) as typeof fetch;
 const ctx={fetch:mock,now:()=>100000,config:quoteConfig({})},a=instrument(btc),q=(await binanceProvider.fetch([a],ctx))[a.assetId];assert.equal(q.currency,'USDT');assert.equal(q.previousClose,null);assert.equal(q.changeWindow,'ROLLING_24H');assert.equal(q.volume,5);await assert.rejects(()=>fetchCryptoCandles('binance',a,'1m&symbol=OTHER',100,ctx),/不支持/);
});
