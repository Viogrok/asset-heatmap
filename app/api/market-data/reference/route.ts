import {authorizedAssets} from '../../../../lib/quotes/assets';
import {quoteRuntime} from '../../../../lib/quotes/runtime';
import {instrument,validateAssetMapping} from '../../../../lib/quotes/identity';
import {runReference} from '../../../../lib/quotes/reference-equities-service';
import {workerWaitUntil} from '../../../../lib/execution-context';

export async function GET(req: Request) {
 const deadline=Date.now()+20000;
 const headers={'Cache-Control':'private, no-store'};
 let timer:ReturnType<typeof setTimeout> | undefined;
 const execute=async()=>{
  const all=await authorizedAssets();
  if(!all)return Response.json({code:'UNAUTHORIZED',error:'请先登录'},{status:401,headers});
  if(Date.now()>=deadline)return Response.json({code:'UNAVAILABLE',error:'参考数据请求超时'},{status:503,headers});
  const p=new URL(req.url).searchParams,asset=all.find(a=>a.id===p.get('asset'));
  if(!asset)return Response.json({code:'INVALID_ARGUMENT',error:'资产不在当前用户目录中'},{status:400,headers});
  try{validateAssetMapping(asset);}catch{return Response.json({code:'INVALID_ARGUMENT',error:'资产代码与行情映射不一致'},{status:400,headers});}
  const result=await runReference(quoteRuntime(),instrument(asset),{provider:p.get('provider')||'',kind:p.get('kind')||'',start:p.get('start')||'',end:p.get('end')||''},deadline);
  return Response.json(result.body,{status:result.status,headers});
 };
 try{const pending=execute();workerWaitUntil()?.(pending.then(()=>{},()=>{}));return await Promise.race([pending,new Promise<Response>(resolve=>{timer=setTimeout(()=>resolve(Response.json({code:'UNAVAILABLE',error:'参考数据请求超时'},{status:503,headers})),Math.max(1,deadline-Date.now()));})]);}
 catch{return Response.json({code:'UNAVAILABLE',error:'参考数据服务不可用'},{status:503,headers});}
 finally{if(timer)clearTimeout(timer);}
}
