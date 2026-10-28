import {env} from 'cloudflare:workers';
import {assertReadOnly,hmacSignature,mergeBalances,normalizeTrades,type ExchangeSnapshot} from './exchange';
const paths=new Set(['/sapi/v1/account/apiRestrictions','/api/v3/account','/sapi/v1/simple-earn/flexible/position','/sapi/v1/simple-earn/locked/position','/api/v3/myTrades']);
export function binanceConfig(owner:string){const e=env as any;const missing=['BINANCE_API_KEY','BINANCE_API_SECRET','BINANCE_OWNER_ID'].filter(k=>!e[k]);return {configured:missing.length===0,authorized:e.BINANCE_OWNER_ID===owner,missing,ownerId:owner};}
export async function readBinance(owner:string,date:string):Promise<ExchangeSnapshot>{
 const config=binanceConfig(owner);if(!config.configured)throw Error('尚未配置专用只读密钥');if(!config.authorized)throw Error('此账户未被授权读取该交易所连接');
 const e=env as any;
 const tr=await fetch('https://api.binance.com/api/v3/time',{signal:AbortSignal.timeout(10000)});if(!tr.ok)throw Error(tr.status===451?'Binance访问受地区策略限制（HTTP 451）':'Binance连接失败（HTTP '+tr.status+'）');const tj=await tr.json() as any;if(!Number.isFinite(tj.serverTime))throw Error('无法校准交易所时间');const offset=tj.serverTime-Date.now();
 async function get(path:string,params:Record<string,string>={}){if(!paths.has(path))throw Error('不允许的只读接口');const qs=new URLSearchParams({...params,timestamp:String(Date.now()+offset),recvWindow:'5000'}).toString();const signature=await hmacSignature(e.BINANCE_API_SECRET,qs);const r=await fetch('https://api.binance.com'+path+'?'+qs+'&signature='+signature,{method:'GET',headers:{'X-MBX-APIKEY':e.BINANCE_API_KEY},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error(`Binance只读请求失败（HTTP ${r.status}，未写入账本）`);return await r.json() as any;}
 assertReadOnly(await get('/sapi/v1/account/apiRestrictions'));
 const errors:string[]=[],coverage:string[]=[];
 const account=await get('/api/v3/account',{omitZeroBalances:'true'});if(!Array.isArray(account.balances))throw Error('现货余额数据不完整');coverage.push('现货');
 async function earn(path:string,label:string){let out:any[]=[];try{for(let current=1;current<=10;current++){const j=await get(path,{current:String(current),size:'100'});if(!Array.isArray(j.rows)||!Number.isFinite(Number(j.total)))throw Error('分页格式异常');out.push(...j.rows);if(out.length>=Number(j.total)){coverage.push(label);return out;}if(current===10)throw Error('记录超过分页上限，未把不完整余额合并');}}catch(err){errors.push(label+'读取失败，未计入该来源');return [];}return out;}
 const flexible=await earn('/sapi/v1/simple-earn/flexible/position','Simple Earn活期');const locked=await earn('/sapi/v1/simple-earn/locked/position','Simple Earn定期');
 const begin=Date.parse(date+'T00:00:00+08:00'),end=Math.min(begin+86400000-1,Date.now());if(!Number.isFinite(begin)||begin>end)throw Error('请选择今天或过去的日期');
 const trades=[];for(const symbol of ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','TRXUSDT']){try{const rows=await get('/api/v3/myTrades',{symbol,startTime:String(begin),endTime:String(end),limit:'1000'});if(!Array.isArray(rows))throw Error('成交格式异常');if(rows.length===1000)errors.push(symbol+'成交达到1000条上限，当前预览可能不完整');trades.push(...normalizeTrades(symbol,rows));}catch{errors.push(symbol+'成交读取失败');}}
 return {at:new Date().toISOString(),date,balances:mergeBalances(account.balances,flexible,locked),trades,errors,coverage,complete:errors.length===0};
}
