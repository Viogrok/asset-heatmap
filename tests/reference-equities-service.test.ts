import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runReference} from '../lib/quotes/reference-equities-service.ts';
import {ProviderError} from '../lib/quotes/types.ts';
const asset={assetId:'US:US:STOCK:AAPL',legacyId:'AAPL',symbol:'AAPL',name:'Apple',market:'US',assetType:'STOCK',exchange:'US',currency:'USD'} as any;
const input={provider:'alpaca',kind:'corporate-actions',start:'2025-01-01',end:'2025-01-31'};
function service(){
 const data=new Map<string,any>(),locks=new Set<string>();const counts={allowed:0,success:0,failure:0,fetch:0};
 const svc:any={context:{config:{alpacaKey:'k',alpacaSecret:'s'},fetch:async()=>{counts.fetch++;return new Response(JSON.stringify({corporate_actions:{cash_dividends:[{symbol:'AAPL'}]},next_page_token:counts.fetch===1?'next':null}));}},store:{get:async(k:string)=>data.get(k)||null,put:async(k:string,v:any,t:number)=>data.set(k,{value:v,updated:t}),lease:async(k:string)=>{if(locks.has(k))return false;locks.add(k);return true;},release:async(k:string)=>locks.delete(k)},allowed:async()=>{counts.allowed++;},success:async()=>{counts.success++;},failure:async(_p:string,e:ProviderError)=>{counts.failure++;return {code:e.code,message:e.message};}};
 return {svc,counts,data};
}
test('reference service paginates, counts requests and reuses shared cache',async()=>{
 const {svc,counts}=service();const r=await runReference(svc,asset,input);
 assert.equal(r.status,200);assert.equal((r.body.data as any[]).length,2);assert.equal(counts.allowed,2);assert.equal(counts.success,1);
 const cached=await runReference(svc,asset,input);assert.equal(cached.body.cached,true);assert.equal(cached.body.assetId,asset.assetId);assert.equal(counts.fetch,2);
});
test('invalid, unconfigured, quota and foreign records cannot contaminate success',async()=>{
 const {svc,counts}=service();
 assert.equal((await runReference(svc,asset,{...input,end:'2025-02-01'})).status,400);
 assert.equal((await runReference(svc,asset,{...input,start:'2025-02-30'})).status,400);
 assert.equal((await runReference(svc,asset,{...input,provider:'longbridge'})).body.code,'NOT_CONFIGURED');
 svc.allowed=async()=>{throw new ProviderError('RATE_LIMIT','budget');};
 assert.equal((await runReference(svc,asset,input)).body.code,'RATE_LIMIT');assert.equal(counts.failure,0);
 svc.allowed=async()=>{};svc.context.fetch=async()=>new Response(JSON.stringify({corporate_actions:{cash_dividends:[{symbol:'MSFT'}]},next_page_token:null}));
 assert.equal((await runReference(svc,asset,input)).status,503);assert.equal(counts.failure,1);
});
test('lease contention and provider errors do not return empty success',async()=>{
 const {svc,counts}=service();svc.store.lease=async()=>false;
 assert.equal((await runReference(svc,asset,input)).body.code,'BUSY');assert.equal(counts.fetch,0);
 svc.store.lease=async()=>true;svc.context.fetch=async()=>new Response('',{status:401});
 assert.equal((await runReference(svc,asset,input)).body.code,'AUTH_OR_ENTITLEMENT');assert.equal(counts.failure,1);
});
test('overall deadline bounds a stalled upstream',async()=>{
 const {svc}=service();svc.context.fetch=async()=>new Promise(()=>{});
 const started=Date.now(),r=await runReference(svc,asset,input,started+50);
 assert.equal(r.status,503);assert.ok(Date.now()-started<1000);
});
