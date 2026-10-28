import {authorizedAssets} from '../../../lib/quotes/assets';
import {quoteResponse} from '../../../lib/quotes/response';
export async function GET(req:Request){const all=await authorizedAssets();if(!all)return Response.json({error:'请先登录'},{status:401});const ids=new URL(req.url).searchParams.get('ids')?.split(',');if(ids&&ids.length>128)return Response.json({error:'单次最多128个资产标识'},{status:400});
 const selected=ids?all.filter(a=>ids.includes(a.id)):all;if(ids&&selected.length!==new Set(ids).size)return Response.json({error:'存在未知资产；请先在目录添加并核验'},{status:400});
 try{const {standardQuotes,fx,metadata}=await quoteResponse(selected);return Response.json({schemaVersion:1,quotes:standardQuotes,fx,metadata,receivedAt:new Date().toISOString()},{headers:{'Cache-Control':'private, no-store'}});}catch{return Response.json({error:'行情服务不可用'},{status:503});}}
