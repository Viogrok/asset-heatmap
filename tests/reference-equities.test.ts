import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alpacaCalendar, alpacaCorporateActions, longbridgeCalendar, referenceSessionAt, longbridgeCorporateActions} from '../lib/quotes/reference-equities.ts';
import {quoteConfig} from '../lib/quotes/config.ts';
const reply = (body: unknown) => async () => new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
test('Alpaca交易日历默认为paper，仅显式live配置切到live端点',async()=>{
 assert.equal(quoteConfig({}).alpacaTradingEnvironment,'paper');
 assert.equal(quoteConfig({ALPACA_TRADING_ENV:'live'}).alpacaTradingEnvironment,'live');
 assert.equal(quoteConfig({ALPACA_TRADING_ENV:'unexpected'}).alpacaTradingEnvironment,'paper');
 const origins:string[]=[],request:typeof fetch=async(input)=>{origins.push(new URL(String(input)).origin);return new Response('[]');};
 assert.equal((await alpacaCalendar('k','s','2025-11-28','2025-11-28',request)).status,'OK');
 assert.equal((await alpacaCalendar('k','s','2025-11-28','2025-11-28',request,'live')).status,'OK');
 assert.deepEqual(origins,['https://paper-api.alpaca.markets','https://api.alpaca.markets']);
});
test('calendar validates dates and uses New York DST and actual early close', async()=>{
 const r=await alpacaCalendar('k','s','2025-11-27','2025-11-28',reply([{date:'2025-11-28',open:'09:30',close:'13:00'}]) as typeof fetch);
 assert.equal(r.status,'OK'); if(r.status!=='OK')return;
 assert.equal(r.data[0].trading,false); assert.equal(r.data[1].halfDay,null);
 assert.equal(referenceSessionAt(Date.parse('2025-11-28T17:59:00Z'),r.data[1]),'OPEN');
 assert.equal(referenceSessionAt(Date.parse('2025-11-28T18:00:00Z'),r.data[1]),'UNKNOWN');
 assert.equal(referenceSessionAt(Date.parse('2025-11-27T16:00:00Z'),r.data[0]),'CLOSED');
 await assert.rejects(()=>alpacaCalendar('k','s','2025-02-30','2025-03-01'));
 assert.equal((await alpacaCalendar('k','s','2030-01-01','2030-01-02')).status,'UNAVAILABLE');
});
test('Longbridge splits monthly and does not invent half-day hours',async()=>{
 const calls:string[]=[];
 const r=await longbridgeCalendar(async(_m,s,e)=>{calls.push(`${s}:${e}`);return s==='2025-01-31'?{trade_day:['20250131'],half_trade_day:[]}:{trade_day:[],half_trade_day:['20250203']};},'HK','2025-01-31','2025-02-03');
 assert.equal(r.status,'OK'); assert.equal(calls.length,2); if(r.status!=='OK')return;
 assert.equal(r.data[3].halfDay,true); assert.equal(referenceSessionAt(Date.parse('2025-02-03T02:00:00Z'),r.data[3]),'UNKNOWN');
});
test('corporate action pages preserved and never partially succeed',async()=>{
 let n=0; const req=async()=>new Response(JSON.stringify(++n===1?{corporate_actions:{cash_dividends:[{symbol:'AAPL'}]},next_page_token:'next'}:{corporate_actions:{forward_splits:[{symbol:'AAPL'}]},next_page_token:null}));
 const r=await alpacaCorporateActions('k','s','AAPL','2025-01-01','2025-01-31',req as typeof fetch);
 assert.equal(r.status,'OK'); if(r.status==='OK')assert.equal(r.data.length,2);
 assert.equal((await longbridgeCorporateActions(undefined,'AAPL.US','2025-01-01','2025-01-31')).status,'NOT_CONFIGURED');
});

