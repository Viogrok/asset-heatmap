import {instrument} from './identity.ts';
import {instrumentKey,quoteKey,type QuoteService} from './service.ts';
import {verifiedCryptoPairs} from './crypto.ts';
import {krakenPair} from '../kraken.ts';
import {baseQuote,epoch,finite,positive,legacyQuote,ProviderError,type Instrument,type StandardQuote} from './types.ts';
import type {Asset} from '../model.ts';
import {referenceFx} from './fx.ts';
import {NonOverlappingTask,CloseBarrier} from './realtime-tasks.ts';

type Venue='binance'|'okx'|'kraken'|'coinbase';
// An isolate-local acceleration, never the sole owner/lock: D1 coordinates all isolates.
const liveMemory=new Map<string,StandardQuote>();
const cb=new Set(['ARB','SOL','WIF','USDT','UNI','DOGE','BTC','XRP','HYPE','TURBO','ETH','SHIB','PENGU','PEPE','BNB','ZEC']);
const endpoints:Record<Venue,string>={binance:'https://stream.binance.com:9443/ws',okx:'https://ws.okx.com:8443/ws/v5/public',kraken:'https://ws.kraken.com/v2',coinbase:'https://ws-feed.exchange.coinbase.com'};
type StreamState={status:'connecting'|'live'|'fallback';provider:Venue|null;message:string};

/** One D1 lease owns the public upstream feed. Other browsers only read our cache. */
class Collector implements CollectorPort{
 socket?:WebSocket;provider:Venue|null=null;stopped=false;lastMessage=0;opened=0;
 state:StreamState={status:'connecting',provider:null,message:'服务端正在连接公共行情'};
 dirty=new Map<string,StandardQuote>();cursor=0;failures=0;nextConnect=0;
 private pendingAbort?:AbortController;
 private service:QuoteService;private assets:Instrument[];persistenceLimited=false;
 constructor(service:QuoteService,assets:Instrument[]){this.service=service;this.assets=assets;}
 async connect(){
  if(this.stopped||this.socket||Date.now()<this.nextConnect)return;
  for(let k=0;k<4;k++){
   const venue=(['binance','okx','kraken','coinbase'] as Venue[])[this.cursor++%4];const ctx=this.service.context;
   if((venue==='binance'&&!ctx.config.binanceEnabled)||(venue==='okx'&&!ctx.config.okxEnabled))continue;
   try{
    await this.service.allowed(venue);
    const mapping:Record<string,Instrument[]>={};
    if(venue==='binance'||venue==='okx'){
     const pairs=await verifiedCryptoPairs(venue,this.assets,ctx);for(const a of this.assets){const pair=pairs[a.assetId];if(pair)(mapping[pair.symbol]||=[]).push(a);}
    }else for(const a of this.assets){const pair=krakenPair(a.legacy);if(pair&&(venue!=='coinbase'||cb.has(a.symbol)))(mapping[venue==='kraken'?pair.socket:a.symbol+'-USD']||=[]).push(a);}
    const symbols=Object.keys(mapping);if(!symbols.length)continue;
    if(this.stopped)return;const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),8000);this.pendingAbort=abort;let r:Response;
    try{r=await ctx.fetch(endpoints[venue],{headers:{Upgrade:'websocket'},signal:abort.signal});}finally{clearTimeout(timeout);if(this.pendingAbort===abort)this.pendingAbort=undefined;}
    if(r.status!==101||!r.webSocket)throw new ProviderError(r.status===451?'REGION_RESTRICTED':'STREAM_CONNECTION','服务端无法连接'+venue+'公共推送');
    const ws=r.webSocket;ws.accept();if(this.stopped){ws.close(1000,'request ended');return;}this.socket=ws;this.provider=venue;this.lastMessage=Date.now();this.opened=Date.now();
    this.state={status:'connecting',provider:venue,message:'已连接，等待有效行情'};
    ws.addEventListener('message',e=>{
     if(this.stopped||this.socket!==ws)return;this.lastMessage=Date.now();if(e.data==='pong')return;
     try{const j=JSON.parse(String(e.data));const rows=venue==='binance'?[j]:venue==='okx'?(j.arg?.channel==='tickers'?j.data||[]:[]):venue==='kraken'?(j.channel==='ticker'?j.data||[]:[]):j.type==='ticker'?[j]:[];
      for(const row of rows){const symbol=venue==='binance'?row.s:venue==='okx'?row.instId:venue==='kraken'?row.symbol:row.product_id;
       for(const a of mapping[symbol]||[]){const q=baseQuote(a,venue,Date.now());q.lastPrice=positive(venue==='binance'?row.c:venue==='okx'?row.last:venue==='kraken'?row.last:row.price);if(!q.lastPrice)continue;
        q.currency=venue==='binance'||venue==='okx'?'USDT':'USD';q.exchange=venue.toUpperCase();q.providerSymbol=symbol;q.changeWindow='ROLLING_24H';q.marketStatus='OPEN';q.quoteStatus='REALTIME';q.delaySeconds=null;
        const open=positive(venue==='okx'?row.open24h:row.open_24h);q.changePercent=venue==='binance'?finite(row.P):venue==='kraken'?finite(row.change_pct):open?(q.lastPrice/open-1)*100:null;
        q.timestamp=venue==='binance'?epoch(row.E):venue==='okx'?epoch(row.ts):typeof(venue==='kraken'?row.timestamp:row.time)==='string'?(venue==='kraken'?row.timestamp:row.time):null;
        if(q.timestamp&&!Number.isFinite(Date.parse(q.timestamp)))q.timestamp=null;
        q.volume=finite(venue==='binance'?row.v:venue==='okx'?row.vol24h:venue==='kraken'?row.volume:row.volume_24h);q.quoteVolume=finite(venue==='binance'?row.q:venue==='okx'?row.volCcy24h:null);
        if(q.currency==='USDT')q.warnings.push('原始USDT报价，未将USDT等同美元。');
        const prev=liveMemory.get(q.assetId);if(prev&&prev.provider===q.provider&&prev.timestamp&&q.timestamp&&Date.parse(q.timestamp)<Date.parse(prev.timestamp))continue;
        if(prev&&(prev.provider!==q.provider||prev.currency!==q.currency))q.warnings.push(`推送源切换：${prev.provider}/${prev.currency} → ${q.provider}/${q.currency}`);
        liveMemory.set(q.assetId,q);this.dirty.set(q.assetId,q);this.failures=0;this.state={status:'live',provider:venue,message:'服务端已收到真实行情，逐资产状态以报价为准'};
       }
      }
     }catch{/* Heartbeats and unsupported protocol events are not quotes. */}
    });
    const closed=()=>{if(this.socket!==ws)return;this.socket=undefined;this.state={status:'fallback',provider:venue,message:'推送中断，保留源时间并读取服务端备用快照'};this.nextConnect=Date.now()+Math.min(60000,1000*2**Math.min(this.failures++,6));};
    ws.addEventListener('close',closed);ws.addEventListener('error',()=>{try{ws.close();}catch{}closed();});
    ws.send(JSON.stringify(venue==='binance'?{method:'SUBSCRIBE',params:symbols.map(s=>s.toLowerCase()+'@ticker'),id:1}:venue==='okx'?{op:'subscribe',args:symbols.map(instId=>({channel:'tickers',instId}))}:venue==='kraken'?{method:'subscribe',params:{channel:'ticker',symbol:symbols,event_trigger:'trades'}}:{type:'subscribe',product_ids:symbols,channels:['ticker','heartbeat']}));return;
   }catch(e){if(this.stopped)return;await this.service.failure(venue,e);}
  }
  this.state={status:'fallback',provider:null,message:'公共推送不可用，使用带源时间的服务端快照'};this.nextConnect=Date.now()+Math.min(60000,5000*2**Math.min(this.failures++,4));
 }
 async tick(){
  if(this.stopped)return;
  const now=Date.now();if(this.socket){
   if(now-this.lastMessage>25000||now-this.opened>23*3600000||(this.state.status==='connecting'&&now-this.opened>15000)){try{this.socket.close();}catch{}this.socket=undefined;this.state={status:'fallback',provider:this.provider,message:'推送超时，准备切换备用源'};}
   else if(this.provider==='okx'&&now-this.lastMessage>15000)this.socket.send('ping');
  }else await this.connect();
 }
 async persist(){
  // 10-second durable batches reduce D1 writes. Same-isolate clients use the live memory copy.
  const batch=[...this.dirty.values()];if(!batch.length)return;
  const now=Date.now();if(!await this.service.store.budget('md:stream-write-day',60000,86400000,now,batch.length)){this.persistenceLimited=true;return;}
  await this.service.store.putMany(batch.map(q=>({key:quoteKey(q.assetId),value:q})),now);this.persistenceLimited=false;
  for(const q of batch)if(this.dirty.get(q.assetId)===q)this.dirty.delete(q.assetId);
 }
 stop(){this.stopped=true;this.pendingAbort?.abort();this.pendingAbort=undefined;if(this.socket){try{this.socket.close(1000,'lease released');}catch{}this.socket=undefined;}}
}


export type CollectorPort={state:StreamState;persistenceLimited?:boolean;tick:()=>Promise<void>;persist:()=>Promise<void>;stop:()=>void};
export type StreamOptions={
 now?:()=>number;schedule?:(work:()=>void,ms:number)=>unknown;clear?:(handle:unknown)=>void;
 heartbeatMs?:number;lifetimeMs?:number;waitUntil?:(work:Promise<unknown>)=>void;
 createCollector?:(service:QuoteService,assets:Instrument[])=>CollectorPort;
 readLive?:(assetId:string)=>StandardQuote|undefined;
 loadFx?:typeof referenceFx;
};

export function streamResponse(req:Request,service:QuoteService,assets:Asset[],options:StreamOptions={}){
 const owner=crypto.randomUUID(),requested=[...new Map(assets.map(instrument).map(a=>[a.assetId,a])).values()],encoder=new TextEncoder();
 const now=options.now||service.context.now,schedule=options.schedule||((fn:()=>void,ms:number)=>setTimeout(fn,ms));
 const clear=options.clear||((handle:unknown)=>clearTimeout(handle as ReturnType<typeof setTimeout>));
 let stop:()=>Promise<void>=async()=>{};
 const body=new ReadableStream<Uint8Array>({start(controller){
  let active=true,leader=false,collector:CollectorPort|undefined,timer:unknown,lastRenew=-Infinity,lastRead=-Infinity,lastPersist=-Infinity,lastFx=-Infinity;
  const started=now(),cached=new Map<string,StandardQuote>(),closing=new CloseBarrier();let fx:unknown;
  const backgroundError=()=>{};
  const control=new NonOverlappingTask(backgroundError),connection=new NonOverlappingTask(backgroundError),reading=new NonOverlappingTask(backgroundError),persisting=new NonOverlappingTask(backgroundError),fxTask=new NonOverlappingTask(backgroundError);
  const send=(event:string,value:unknown)=>{if(active)controller.enqueue(encoder.encode('event: '+event+'\ndata: '+JSON.stringify(value)+'\n\n'));};
  stop=()=>{
   if(!active)return closing.close(async()=>{},()=>{});active=false;req.signal.removeEventListener('abort',abort);
   if(timer!==undefined)clear(timer);collector?.stop();
   const cleanup=closing.close(async()=>{await control.wait();collector?.stop();await persisting.wait();await service.store.release('md:stream-leader',owner);},()=>{try{controller.close();}catch{}});
   options.waitUntil?.(cleanup.catch(()=>{}));return cleanup;
  };
  const abort=()=>{void stop().catch(()=>{});};req.signal.addEventListener('abort',abort,{once:true});
  const frame=()=>{
   if(!active)return;const stamp=now();if(stamp-started>=(options.lifetimeMs??55000)){void stop().catch(()=>{});return;}
   // Ownership and cache IO are independent of delivery. Slow upstream calls cannot stop heartbeats.
   if(stamp-lastRenew>=8000&&control.run(async()=>{
    const owns=await service.store.lease('md:stream-leader',owner,now(),24000);
    if(!active){if(owns)await service.store.release('md:stream-leader',owner);return;}
    if(!owns&&leader){collector?.stop();collector=undefined;}leader=owns;
    if(leader&&!collector){
     const saved=await service.store.getMany<Instrument>(requested.map(a=>instrumentKey(a.assetId)));
     const changed=requested.filter(a=>JSON.stringify(saved.get(instrumentKey(a.assetId))?.value)!==JSON.stringify(a));
     await service.store.putMany(changed.map(a=>({key:instrumentKey(a.assetId),value:a})),now());
     const publicAssets=(await service.store.list<Instrument>('md:v1:instrument:')).map(x=>x.value);
     if(active&&leader)collector=(options.createCollector||((s,a)=>new Collector(s,a)))(service,publicAssets);
    }
   }))lastRenew=stamp;
   if(leader&&collector){connection.run(()=>collector!.tick());if(stamp-lastPersist>=10000&&persisting.run(()=>collector!.persist()))lastPersist=stamp;}
   if(stamp-lastRead>=10000&&reading.run(async()=>{const values=await service.store.getMany<StandardQuote>(requested.map(a=>quoteKey(a.assetId)));if(active)for(const a of requested){const q=values.get(quoteKey(a.assetId))?.value;if(q)cached.set(a.assetId,q);}}))lastRead=stamp;
   const standard:Record<string,StandardQuote>={},quotes:Record<string,unknown>={},unavailable:string[]=[];
   let fresh=0,provider:string|null=null;
   for(const a of requested){const memory=(options.readLive||((id:string)=>liveMemory.get(id)))(a.assetId),stored=cached.get(a.assetId);
    let q=memory&&(!stored||Date.parse(memory.receivedAt)>=Date.parse(stored.receivedAt))?memory:stored;if(!q)continue;
    const age=stamp-Date.parse(q.receivedAt);if(age>service.context.config.maxStaleMs){unavailable.push(a.legacyId);continue;}
    if(q.quoteStatus==='REALTIME'&&age>30000)q={...q,quoteStatus:'STALE'};else if(q.quoteStatus==='REALTIME'&&age>3000)q={...q,quoteStatus:'DELAYED',delaySeconds:Math.ceil(age/1000)};
    else if(q.quoteStatus==='SNAPSHOT'&&age>Math.max(60000,(a.market==='CRYPTO'?service.context.config.cryptoTtlMs:service.context.config.equityTtlMs)*3))q={...q,quoteStatus:'STALE'};
    standard[a.assetId]=q;const legacy=legacyQuote(q);if(legacy)quotes[a.legacyId]=legacy;if(q.quoteStatus==='REALTIME'){fresh++;provider=q.provider;}
   }
   if(stamp-lastFx>=30000&&fxTask.run(async()=>{const next=await(options.loadFx||referenceFx)(service,standard);if(active&&next)fx=next;}))lastFx=stamp;
   if(Object.keys(quotes).length||unavailable.length)send('quotes',{quotes,standardQuotes:standard,unavailable,...(fx?{fx}:{})});
   const state=collector?.state;
   send('status',{status:fresh>0?'live':state?.status==='connecting'?'connecting':'fallback',provider:provider||state?.provider||null,
    message:fresh>0?'服务端已收到新行情':state?.message||'从服务端共享缓存读取行情',freshQuoteCount:fresh,persistenceLimited:collector?.persistenceLimited||false});
   send('heartbeat',{receivedAt:new Date(stamp).toISOString()});
   if(active)timer=schedule(frame,options.heartbeatMs??1000);
  };
  send('status',{status:'connecting',provider:null,message:'正在读取共享行情'});frame();
 },cancel(){return stop().catch(()=>{});}});
 return new Response(body,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','Connection':'keep-alive'}});
}
