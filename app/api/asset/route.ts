import {getChatGPTUser} from '../../chatgpt-auth';
import {quote} from '../../../lib/market';
import {aShareExchange} from '../../../lib/quotes/identity';
import type {Asset} from '../../../lib/model';
export async function POST(req:Request){
 if(!await getChatGPTUser())return Response.json({error:'请先登录'},{status:401});
 try{const {code:raw,market,kind}=await req.json() as any;const code=String(raw||'').trim().toUpperCase();
  if(!/^[A-Z0-9.^-]{1,16}$/.test(code)||!['A股','港股','美股'].includes(market))throw Error('代码或市场无效');
  const a:Asset={id:market+':'+code,name:code,symbol:code,market,listing:market,currency:market==='A股'?'CNY':market==='港股'?'HKD':'USD',kind:kind==='股票'?'股票':'ETF'};
  if(market==='A股'){const ex=aShareExchange(code);a.listing=ex;a.tencent=(ex==='XSHG'?'sh':ex==='XSHE'?'sz':'bj')+code;}
  else if(market==='港股'){if(!/^\d{1,5}(\.HK)?$/.test(code))throw Error('港股代码无效');const digits=code.replace(/\.HK$/,'');a.symbol=digits.padStart(5,'0');a.tencent='hk'+a.symbol;a.yahoo=Number(digits).toString().padStart(4,'0')+'.HK';}
  else{a.tencent='us'+code;a.yahoo=code;}
  const q=await quote(a);if(q.stale)throw Error('仅取得过期行情，暂不能验证新资产');a.name=q.name||a.name;return Response.json(a);
 }catch(e){return Response.json({error:e instanceof Error?e.message:'验证失败'},{status:400});}
}
