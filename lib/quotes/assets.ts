import {getChatGPTUser} from '../../app/chatgpt-auth';
import {getDb} from '../../db';
import {portfolios} from '../../db/schema';
import {eq} from 'drizzle-orm';
import {assets,type Asset} from '../model.ts';
export const usdtReference:Asset={id:'md:USDT',name:'Tether USD参考报价',symbol:'USDT',market:'加密',listing:'参考市场',currency:'USD',kind:'加密',coin:'tether'};
export async function authorizedAssets(){const user=await getChatGPTUser();if(!user)return null;const row=await getDb().select().from(portfolios).where(eq(portfolios.owner,user.userId)).get();const custom:Asset[]=row?JSON.parse(row.payload).custom||[]:[];return [...assets,...custom];}
