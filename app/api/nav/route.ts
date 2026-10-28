import {authorizedAssets} from '../../../lib/quotes/assets';
import {quoteRuntime} from '../../../lib/quotes/runtime';
import {instrument,validateAssetMapping} from '../../../lib/quotes/identity';
import {fetchFundNav} from '../../../lib/nav-provider';
import {fetchIssuerNav,parseBridgeNav,supportsIssuerNav,issuerNavReferenceAssets} from '../../../lib/quotes/nav-providers';
import {bridgeUrl,request} from '../../../lib/quotes/transport';
import type {FundNav} from '../../../lib/nav';

export async function GET(req:Request){
 const all=await authorizedAssets();if(!all)return Response.json({error:'请先登录'},{status:401});
 const id=new URL(req.url).searchParams.get('asset');
 const a=all.find(a=>a.id===id)||issuerNavReferenceAssets.find(a=>a.id===id);
 const domestic=!!a?.tencent&&/^(sh|sz)\d{6}$/.test(a.tencent),issuer=!!a&&supportsIssuerNav(a.symbol,a.market,a.currency);
 if(!a||a.kind!=='ETF'||(!domestic&&!issuer))return Response.json({error:'此基金尚无已接入的可靠披露净值源'},{status:404});
 try{validateAssetMapping(a);}catch{return Response.json({error:'资产代码与净值映射不一致'},{status:400});}
 const service=quoteRuntime(),i=instrument(a),key='nav-v3:'+i.assetId,now=service.context.now(),headers={'Cache-Control':'private, no-store'};
 if(issuer&&a.symbol==='QQQ'&&!service.context.config.invescoNavLicensed)return Response.json({code:'AUTHORIZATION_REQUIRED',error:'QQQ 发行人限制自动访问，取得相应数据许可后才能启用此净值源'},{status:503,headers});
 const old=await service.store.get<FundNav>(key);
 if(old&&now-old.updated<(old.value.stale?600000:21600000))return Response.json(old.value,{headers});
 const owner=crypto.randomUUID();if(!await service.store.lease('refresh:'+key,owner,now,30000))return old?Response.json({...old.value,stale:true},{headers}):Response.json({error:'净值正在更新，请稍后重试'},{status:503,headers});
 try{
  let nav:FundNav|undefined;
  if(issuer)nav=await fetchIssuerNav(a.symbol,service.context.fetch,()=>new Date(service.context.now()),a.market,{invescoLicensed:service.context.config.invescoNavLicensed});
  else{
   try{nav=await fetchFundNav(a);}catch{}
   const cfg=service.context.config;
   if((!nav||nav.stale)&&cfg.akshareUrl&&cfg.akshareToken)try{
    await service.allowed('akshare');const response=await request(service.context,bridgeUrl(cfg.akshareUrl)!+'/nav',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+cfg.akshareToken},body:JSON.stringify({instruments:[{assetId:i.assetId,symbol:i.symbol,market:i.market,assetType:i.assetType,exchange:i.exchange,currency:i.currency}]})});
    nav=parseBridgeNav(await response.json(),i.assetId,i.currency,now);await service.success('akshare');
   }catch(e){await service.failure('akshare',e);}
   if(!nav)throw Error('未取得有效披露净值');
  }
  await service.store.put(key,nav,now);return Response.json(nav,{headers});
 }catch{if(old)return Response.json({...old.value,stale:true,warning:'在线更新失败，显示上次披露净值'},{headers});return Response.json({error:'披露净值源暂不可用'},{status:502,headers});}
 finally{await service.store.release('refresh:'+key,owner);}
}
