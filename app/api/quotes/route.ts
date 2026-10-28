import scaleSnapshot from '../../../lib/scale-snapshot.json';
import {authorizedAssets} from '../../../lib/quotes/assets';
import {quoteResponse} from '../../../lib/quotes/response';
import {marketScale} from '../../../lib/market';
import {instrument,validateAssetMapping} from '../../../lib/quotes/identity';

/** Existing dashboard contract is preserved. Standard objects are additive. */
export async function GET(){
 const all=await authorizedAssets();if(!all)return Response.json({error:'请先登录'},{status:401});
 try{
  const {service,metadata,...data}=await quoteResponse(all);const scales:Record<string,unknown>={};const now=Date.now();
  const sized=all.filter(a=>{try{validateAssetMapping(a);return a.kind!=='指数';}catch{return false;}}),cached=await service.store.getMany<any>(sized.map(a=>'size-v3:'+instrument(a).assetId));
  const needed=sized.filter(a=>a.kind!=='加密'&&(!cached.has('size-v3:'+instrument(a).assetId)||now-cached.get('size-v3:'+instrument(a).assetId)!.updated>=(a.kind==='ETF'?86400000:300000)));
  const owner=crypto.randomUUID(),locks=await service.store.leaseMany(needed.map(a=>'refresh:size-v3:'+instrument(a).assetId),owner,now,60000),writes:{key:string;value:unknown}[]=[];
  try{for(let i=0;i<sized.length;i+=4)await Promise.all(sized.slice(i,i+4).map(async a=>{
   const key='size-v3:'+instrument(a).assetId,old=cached.get(key),ttl=a.kind==='ETF'?86400000:300000;
   const m=metadata[instrument(a).assetId];
   if(a.kind==='加密'){if(m?.marketCap&&m.currency==='USD')scales[a.id]={value:m.marketCap,currency:'USD',kind:'crypto-cap',asOf:m.timestamp,fetched:m.receivedAt,source:'CoinGecko流通市值',stale:now-Date.parse(m.receivedAt)>7200000};else if(old)scales[a.id]={...old.value,stale:true};else data.errors['size-v3:'+instrument(a).assetId]='CoinGecko市值未配置或暂不可用';return;}
   if(old&&now-old.updated<ttl){scales[a.id]=old.value;return;}if(!locks.has('refresh:'+key)){if(old)scales[a.id]={...old.value,stale:true};return;}
   try{const s=await marketScale(a);scales[a.id]=s;writes.push({key,value:s});}catch{if(old)scales[a.id]={...old.value,stale:true};else if((scaleSnapshot as any)[a.id])scales[a.id]={...(scaleSnapshot as any)[a.id],stale:true};else data.errors['size-v3:'+instrument(a).assetId]='未取得可核验的资产规模';}
  }));await service.store.putMany(writes,now);}finally{await service.store.releaseMany([...locks],owner);}
  return Response.json({...data,scales},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'行情共享服务暂不可用，请稍后重试'},{status:503});}
}
