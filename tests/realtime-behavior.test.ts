import test from 'node:test';
import assert from 'node:assert/strict';
import type {Asset,Quote} from '../lib/model.ts';
import {assets} from '../lib/model.ts';
import {quoteConfig} from '../lib/quotes/config.ts';
import {instrument} from '../lib/quotes/identity.ts';
import {QuoteService} from '../lib/quotes/service.ts';
import {baseQuote,type StandardQuote} from '../lib/quotes/types.ts';
import type {CollectorPort,StreamOptions} from '../lib/quotes/stream.ts';
import {streamResponse} from '../lib/quotes/stream.ts';
import {NonOverlappingTask,CloseBarrier} from '../lib/quotes/realtime-tasks.ts';
import {mergeQuoteUpdate} from '../lib/quotes/client-updates.ts';
import type {QuoteStore,Stored} from '../lib/quotes/store.ts';

type EventFrame={event:string;data:Record<string,unknown>};
type Scheduled={work:()=>void;delay:number};
type StoreOverrides={
 lease?:QuoteStore['lease'];
 release?:QuoteStore['release'];
 getMany?:<T>(keys:string[])=>Promise<Map<string,Stored<T>>>;
 putMany?:QuoteStore['putMany'];
};
type ServiceOverrides={real?:boolean;fetch?:typeof fetch;config?:ReturnType<typeof quoteConfig>};

function deferred<T=void>(){
 let resolve!:(value:T|PromiseLike<T>)=>void;
 const promise=new Promise<T>(r=>{resolve=r;});
 return {promise,resolve};
}
async function settle(){await new Promise<void>(resolve=>setImmediate(resolve));}
async function until(predicate:()=>boolean,label:string){
 for(let i=0;i<100;i++){if(predicate())return;await settle();}
 assert.fail('等待超时：'+label);
}
function streamReader(response:Response){
 const reader=response.body!.getReader(),events:EventFrame[]=[];let ended=false;
 const done=(async()=>{
  const decoder=new TextDecoder();let buffer='';
  while(true){const part=await reader.read();if(part.done){ended=true;buffer+=decoder.decode();break;}buffer+=decoder.decode(part.value,{stream:true});
   let split=buffer.indexOf('\n\n');while(split>=0){const block=buffer.slice(0,split);buffer=buffer.slice(split+2);const lines=block.split(/\r?\n/),event=lines.find(x=>x.startsWith('event: '))?.slice(7),data=lines.filter(x=>x.startsWith('data: ')).map(x=>x.slice(6)).join('\n');if(event&&data)events.push({event,data:JSON.parse(data) as Record<string,unknown>});split=buffer.indexOf('\n\n');}
  }
 })();
 return {reader,events,done,isEnded:()=>ended};
}

function harness(assetsForStream:Asset[],options:StreamOptions={},storeOverrides:StoreOverrides={},serviceOverrides:ServiceOverrides={}){
 let time=Date.parse('2026-10-28T00:00:00.000Z'),getCalls=0,releases=0,leaseCalls=0;
 const scheduled:Scheduled[]=[],values=new Map<string,Stored<unknown>>();
 const store:QuoteStore={
  async get<T>(key:string){return (values.get(key) as Stored<T>|undefined)||null;},
  async put(key:string,value:unknown,updated:number){values.set(key,{value,updated});},
  async lease(key:string,owner:string,now:number,ttl:number){leaseCalls++;return storeOverrides.lease?storeOverrides.lease(key,owner,now,ttl):false;},
  async release(key:string,owner:string){releases++;await storeOverrides.release?.(key,owner);},
  async budget(){return true;},
  async list<T>(prefix:string){return [...values.entries()].filter(([key])=>key.startsWith(prefix)).map(([,value])=>value as Stored<T>);},
  async getMany<T>(keys:string[]){if(storeOverrides.getMany)return storeOverrides.getMany<T>(keys);const out=new Map<string,Stored<T>>();for(const key of keys){const value=values.get(key);if(value)out.set(key,value as Stored<T>);}return out;},
  async putMany(entries,updated){if(storeOverrides.putMany){await storeOverrides.putMany(entries,updated);return;}for(const {key,value} of entries)values.set(key,{value,updated});},
  async leaseMany(){return new Set<string>();},
  async releaseMany(){}
 };
 const context={fetch:serviceOverrides.fetch||fetch,now:()=>time,config:serviceOverrides.config||quoteConfig({})};
 const service=serviceOverrides.real?new QuoteService(store,[],context):{store,context,async get(){getCalls++;return new Promise<never>(()=>{});}} as unknown as QuoteService;
 const signal=new AbortController(),merged:StreamOptions={
  now:()=>time,
  heartbeatMs:1000,
  schedule:(work,delay)=>{const item={work,delay};scheduled.push(item);return item;},
  clear:(handle)=>{const i=scheduled.indexOf(handle as Scheduled);if(i>=0)scheduled.splice(i,1);},
  loadFx:async()=>null,
  ...options
 };
 const response=streamResponse(new Request('http://local/api/market-data/stream',{signal:signal.signal}),service,assetsForStream,merged);
 const client=streamReader(response);
 return {time:()=>time,setTime:(n:number)=>{time=n;},scheduled,fire:async()=>{const item=scheduled.shift();assert.ok(item,'预期存在下一次SSE调度');item.work();await settle();},client,signal,service,getCalls:()=>getCalls,releases:()=>releases,leaseCalls:()=>leaseCalls,values,store};
}

const btc=assets.find(a=>a.id==='BTC')!;
const aapl:Asset={id:'US:AAPL',symbol:'AAPL',name:'Apple',market:'美股',listing:'NASDAQ',currency:'USD',kind:'股票',yahoo:'AAPL'};
function realtime(asset:Asset,provider:string,received:number,price:number,currency:string,timestamp:string|null){
 const q=baseQuote(instrument(asset),provider,received);q.lastPrice=price;q.currency=currency;q.quoteStatus='REALTIME';q.changePercent=1;q.timestamp=timestamp;return q;
}

test('慢DB读取、Collector和持久化不阻塞SSE心跳，后台任务不重叠且SSE不调用QuoteService.get',async()=>{
 const quoteRead=deferred<Map<string,Stored<StandardQuote>>>(),tick=deferred<void>(),persist=deferred<void>();let quoteReads=0,ticks=0,persists=0,collectorStops=0,collectorCreated=false;
 const h=harness([btc],{createCollector:()=>{collectorCreated=true;return {state:{status:'connecting',provider:'okx',message:'测试连接'},tick:()=>{ticks++;return tick.promise;},persist:()=>{persists++;return persist.promise;},stop:()=>{collectorStops++;}} as CollectorPort;}}, {
  lease:async()=>true,
  getMany:async<T>(keys:string[])=>{if(keys.every(key=>key.startsWith('md:v1:quote:'))){quoteReads++;return await quoteRead.promise as Map<string,Stored<T>>;}return new Map<string,Stored<T>>();}
 });
 try{
  await until(()=>h.scheduled.length===1,'首帧调度');
  await until(()=>h.leaseCalls()>0&&collectorCreated&&quoteReads===1,'共享租约、Collector与慢缓存读取启动');
  await h.fire();
  await until(()=>ticks===1&&persists===1&&quoteReads===1,'慢后台任务开始');
  const heartbeats=()=>h.client.events.filter(e=>e.event==='heartbeat').length;
  const before=heartbeats();await h.fire();
  await until(()=>heartbeats()>before,'慢后台操作期间收到后续heartbeat');
  assert.equal(ticks,1,'tick未完成时不得重复启动');assert.equal(persists,1,'persist未完成时不得重复启动');assert.equal(quoteReads,1,'getMany未完成时不得重复启动');
  assert.equal(h.getCalls(),0,'SSE循环不得同步调用慢REST QuoteService.get');
 }finally{
  quoteRead.resolve(new Map());tick.resolve();persist.resolve();await settle();h.signal.abort();await h.client.done;
 }
 assert.equal(h.releases(),1);assert.ok(collectorStops>=1);
});

test('55秒到期后停止帧发送，等租约释放完成才关闭响应',async()=>{
 const release=deferred<void>();let stopped=0,releaseStarted=false;
 const h=harness([btc],{lifetimeMs:55000,createCollector:()=>({state:{status:'live',provider:'okx',message:'live'},tick:async()=>{},persist:async()=>{},stop:()=>{stopped++;}} as CollectorPort)}, {
  lease:async()=>true,
  release:async()=>{releaseStarted=true;await release.promise;}
 });
 await until(()=>h.leaseCalls()>0&&h.scheduled.length===1,'租约与首帧');
 const start=h.time();h.setTime(start+54999);await h.fire();
 assert.equal(releaseStarted,false,'55秒之前不能释放连接');
 h.setTime(start+55000);await h.fire();
 await until(()=>releaseStarted,'55秒触发租约释放');await settle();
 assert.equal(h.client.isEnded(),false,'释放未完成前不能关闭响应');assert.ok(stopped>=1);
 release.resolve();await h.client.done;
 assert.equal(h.client.isEnded(),true);assert.equal(h.releases(),1);assert.equal(h.scheduled.length,0);
});

test('EventSource报价保留USDT、供应商源时间和美股未核实时区，并按接收年龄降级',async()=>{
 const start=Date.parse('2026-10-28T00:00:00.000Z');
 const crypto=realtime(btc,'okx',start-4000,100,'USDT',new Date(start-4500).toISOString());
 const us=realtime(aapl,'alpaca:iex',start-4000,250,'USD',null);us.quoteStatus='SNAPSHOT';
 const byId=new Map([[crypto.assetId,crypto],[us.assetId,us]]);
 const h=harness([btc,aapl],{readLive:id=>byId.get(id)});
 try{
  await until(()=>h.client.events.some(e=>e.event==='quotes'),'首个行情帧');
  const getQuoteFrame=()=>h.client.events.filter(e=>e.event==='quotes').at(-1)!.data;
  const first=getQuoteFrame(),standard=first.standardQuotes as Record<string,StandardQuote>;
  const cryptoId=instrument(btc).assetId,usId=instrument(aapl).assetId;
  assert.equal(standard[cryptoId].currency,'USDT');assert.equal(standard[cryptoId].quoteStatus,'DELAYED');assert.equal(standard[cryptoId].delaySeconds,4);
  assert.equal(standard[cryptoId].timestamp,new Date(start-4500).toISOString());assert.equal(standard[cryptoId].receivedAt,new Date(start-4000).toISOString());
  assert.equal(standard[usId].timestamp,null,'供应商未提供可靠时区时不合成美股timestamp');assert.equal(standard[usId].sessionTimeZone,'America/New_York');
  assert.equal((first.quotes as Record<string,{currency:string}>).BTC.currency,'USDT');
  const previous=h.client.events.filter(e=>e.event==='quotes').length;h.setTime(start+27000);await h.fire();
  await until(()=>h.client.events.filter(e=>e.event==='quotes').length>previous,'过期行情帧');
  const older=(h.client.events.filter(e=>e.event==='quotes').at(-1)!.data.standardQuotes as Record<string,StandardQuote>);
  assert.equal(older[cryptoId].quoteStatus,'STALE','接收年龄超过30秒后降为STALE');assert.equal(older[cryptoId].currency,'USDT');
 }finally{h.signal.abort();await h.client.done;}
});

test('客户端取消会中止真实Collector的pending上游fetch并释放租约',async()=>{
 let upstreamStarted=false,upstreamAborted=false;
 const fetcher:typeof fetch=(_input,init)=>{
  upstreamStarted=true;const signal=init?.signal as AbortSignal|undefined;
  return new Promise<Response>((_resolve,reject)=>{
   const abort=()=>{upstreamAborted=true;reject(new Error('aborted by client'));};
   if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  });
 };
 const h=harness([btc],{}, {lease:async()=>true},{real:true,fetch:fetcher,config:quoteConfig({QUOTE_BINANCE_ENABLED:'false',QUOTE_OKX_ENABLED:'false'})});
 await until(()=>h.values.size>0&&h.scheduled.length===1,'真实Collector准备完成');
 await h.fire();await until(()=>upstreamStarted,'已开始真实Collector的WS fetch');
 h.signal.abort();await h.client.done;await settle();
 assert.equal(upstreamAborted,true);assert.equal(h.releases(),1);assert.equal(h.scheduled.length,0);
 assert.equal(h.values.has('md:circuit:kraken'),false,'正常取消不能写入供应商故障熔断');
});

test('NonOverlappingTask拒绝并行运行，完成后可再次运行',async()=>{
 const work=deferred<void>(),task=new NonOverlappingTask();
 assert.equal(task.run(()=>work.promise),true);await settle();
 assert.equal(task.running,true);assert.equal(task.run(async()=>{}),false);
 work.resolve();await task.wait();assert.equal(task.running,false);assert.equal(task.run(async()=>{}),true);await task.wait();
});

test('CloseBarrier共享同一次释放，并等释放结束后关闭响应',async()=>{
 const barrier=new CloseBarrier(),release=deferred<void>();let releases=0,finishes=0;
 const first=barrier.close(async()=>{releases++;await release.promise;},()=>{finishes++;});
 const second=barrier.close(async()=>{releases++;},()=>{finishes++;});
 assert.equal(second,first,'并发close调用应等待同一清理任务');await settle();
 assert.equal(releases,1);assert.equal(finishes,0,'租约释放完成前不得关闭响应');
 release.resolve();await Promise.all([first,second]);
 assert.equal(finishes,1);
});

const uiQuote=(price:number,fetched:string):Quote=>({price,change:1,at:null,fetched,source:'test',window:'test',currency:'USDT'});
test('不可用行情显式删除UI中保留的旧价格',()=>{
 const old={BTC:uiQuote(10,'2026-10-28T00:00:00.000Z'),ETH:uiQuote(20,'2026-10-28T00:00:00.000Z')};
 const next=mergeQuoteUpdate(old,{},['BTC']);
 assert.equal(Object.hasOwn(next,'BTC'),false);assert.equal(next.ETH.price,20);
});

test('较旧SSE帧不能覆盖新报价，更新报价可以替换旧值',()=>{
 const old={BTC:uiQuote(10,'2026-10-28T00:00:10.000Z')};
 const skipped=mergeQuoteUpdate(old,{BTC:uiQuote(9,'2026-10-28T00:00:09.000Z')});
 assert.equal(skipped.BTC.price,10);
 const fresh=mergeQuoteUpdate(skipped,{BTC:uiQuote(11,'2026-10-28T00:00:11.000Z')});
 assert.equal(fresh.BTC.price,11);
});
