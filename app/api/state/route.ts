import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {portfolios} from '../../../db/schema';
import {eq,and} from 'drizzle-orm';
import {initial,validateState} from '../../../lib/model';
export async function GET(){const u=await getChatGPTUser();if(!u)return Response.json({error:'请先登录'},{status:401});const db=getDb();let row=await db.select().from(portfolios).where(eq(portfolios.owner,u.userId)).get();if(!row){await db.insert(portfolios).values({owner:u.userId,payload:JSON.stringify(initial())}).onConflictDoNothing();row=await db.select().from(portfolios).where(eq(portfolios.owner,u.userId)).get();}return Response.json({state:JSON.parse(row!.payload),revision:row!.revision});}
export async function PUT(req:Request){const u=await getChatGPTUser();if(!u)return Response.json({error:'请先登录'},{status:401});try{if(Number(req.headers.get('content-length'))>2000000)throw Error('文件过大');const body:any=await req.json();const s=validateState(body.state);if(JSON.stringify(s).length>2000000)throw Error('数据超过2MB限制');const db=getDb();const result=await db.update(portfolios).set({payload:JSON.stringify(s),revision:body.revision+1}).where(and(eq(portfolios.owner,u.userId),eq(portfolios.revision,body.revision))).returning();if(!result.length)return Response.json({error:'其他设备已更新数据，请重新载入后编辑'},{status:409});return Response.json({revision:body.revision+1});}catch(e){return Response.json({error:e instanceof Error?e.message:'保存失败'},{status:400});}}

