import test from 'node:test';
import assert from 'node:assert/strict';
import {assets,initial,type Asset,validateState} from '../lib/model.ts';
import {AssetMappingError,instrument,validateAssetMapping} from '../lib/quotes/identity.ts';
import {legacyProvider,parseTencent,parseYahoo} from '../lib/quotes/equities.ts';

const spyAlias:Asset={id:'my-spy',name:'SPY',symbol:'SPY',market:'美股',listing:'美国',currency:'USD',kind:'ETF',yahoo:'QQQ'};
const fundAlias:Asset={id:'my-510500',name:'中证500ETF',symbol:'510500',market:'A股',listing:'上海',currency:'CNY',kind:'ETF',tencent:'sh159919'};

test('built-in listing mappings, HK-themed A-share ETFs, indices and Binance bStocks remain valid',()=>{
 for(const a of assets)assert.doesNotThrow(()=>validateAssetMapping(a),a.id);
 const bstock:Asset={id:'binance:MSTRB',name:'MSTRB（bStocks）',symbol:'MSTRB',market:'美股',listing:'Binance bStocks 代币化证券',currency:'USD',kind:'股票'};
 const imported:Asset={id:'binance:FOO',name:'FOO',symbol:'FOO',market:'加密',listing:'Binance',currency:'USD',kind:'加密'};
 assert.doesNotThrow(()=>validateAssetMapping(bstock));assert.doesNotThrow(()=>validateAssetMapping(imported));
 assert.equal(instrument(assets.find(a=>a.id==='513130')!).assetId,'A:XSHG:ETF:513130');
 assert.equal(instrument(assets.find(a=>a.id==='159545')!).assetId,'A:XSHE:ETF:159545');
});

test('custom assets cannot bind a canonical ticker to another Yahoo or Tencent ticker',()=>{
 assert.throws(()=>validateAssetMapping(spyAlias),AssetMappingError);
 assert.throws(()=>validateAssetMapping(fundAlias),AssetMappingError);
 assert.throws(()=>validateState({...initial(),custom:[spyAlias]}),AssetMappingError);
 assert.throws(()=>validateState({...initial(),custom:[fundAlias]}),AssetMappingError);
});

test('valid common imports keep their source formats and native currency',()=>{
 const aapl:Asset={id:'US:AAPL',name:'Apple',symbol:'AAPL',market:'美股',listing:'NASDAQ',currency:'USD',kind:'股票',tencent:'usAAPL',yahoo:'AAPL'};
 const hk:Asset={id:'HK:700',name:'Tencent',symbol:'00700',market:'港股',listing:'香港',currency:'HKD',kind:'股票',tencent:'hk00700',yahoo:'0700.HK'};
 const bj:Asset={id:'BJ:920002',name:'北交所标的',symbol:'920002',market:'A股',listing:'XBSE',currency:'CNY',kind:'股票',tencent:'bj920002'};
 assert.doesNotThrow(()=>validateState({...initial(),custom:[aapl,hk,bj]}));
 assert.equal(instrument(assets.find(a=>a.id==='SPY')!).assetId,instrument({...assets.find(a=>a.id==='SPY')!,name:'Imported display name'}).assetId);
});

test('legacy provider rejects a mis-mapped asset before making an upstream request',async()=>{
 let calls=0;const a=instrument(spyAlias);
 const result=await legacyProvider.fetch([a],{config:{legacyEnabled:true} as any,now:()=>1000,fetch:(async()=>{calls++;return new Response();}) as typeof fetch});
 assert.equal(calls,0);assert.deepEqual(result,{});
});

test('legacy response parsers reject a provider ticker or currency mismatch',()=>{
 const aapl:Asset={id:'US:AAPL',name:'Apple',symbol:'AAPL',market:'美股',listing:'NASDAQ',currency:'USD',kind:'股票',yahoo:'AAPL'};
 const a=instrument(aapl);
 assert.equal(parseYahoo(a,{chart:{result:[{meta:{symbol:'QQQ',currency:'USD',regularMarketPrice:100,previousClose:90}}]}},1000),null);
 assert.equal(parseYahoo(a,{chart:{result:[{meta:{symbol:'AAPL',currency:'HKD',regularMarketPrice:100,previousClose:90}}]}},1000),null);
 const fund=instrument({id:'510500',name:'中证500ETF',symbol:'510500',market:'A股',listing:'上海',currency:'CNY',kind:'ETF',tencent:'sh510500'});
 const fields=Array(33).fill('');fields[1]='Wrong ETF';fields[2]='159919';fields[3]='6.5';fields[4]='6.4';
 assert.equal(parseTencent(fund,`v="${fields.join('~')}";`,1000),null);
});
