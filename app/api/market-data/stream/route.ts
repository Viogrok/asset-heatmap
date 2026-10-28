import {authorizedAssets,usdtReference} from '../../../../lib/quotes/assets';
import {quoteRuntime} from '../../../../lib/quotes/runtime';
import {streamResponse} from '../../../../lib/quotes/stream';
import {workerWaitUntil} from '../../../../lib/execution-context';
export async function GET(req:Request){const all=await authorizedAssets();if(!all)return Response.json({error:'请先登录'},{status:401});try{return streamResponse(req,quoteRuntime(),all.some(a=>a.symbol==='USDT')?all:[...all,usdtReference],{waitUntil:workerWaitUntil()});}catch{return Response.json({error:'推送服务暂不可用'},{status:503});}}
