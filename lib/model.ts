import {nextPlanTime} from './dca.ts';
import Decimal from 'decimal.js';
import {z} from 'zod';
import {validateAssetMapping} from './quotes/identity.ts';
export type Market='A股'|'港股'|'美股'|'加密';
export type Asset={id:string;name:string;symbol:string;market:Market;listing:string;currency:string;kind:'ETF'|'指数'|'加密'|'股票';tencent?:string;yahoo?:string;coin?:string;index?:string};
export const assets:Asset[]=[
 {id:'510500',name:'中证500ETF',symbol:'510500',market:'A股',listing:'上海',currency:'CNY',kind:'ETF',tencent:'sh510500',index:'000905'},
 {id:'513130',name:'恒生科技ETF',symbol:'513130',market:'港股',listing:'上海',currency:'CNY',kind:'ETF',tencent:'sh513130',index:'HSTECH'},
 {id:'515180',name:'100红利ETF',symbol:'515180',market:'A股',listing:'上海',currency:'CNY',kind:'ETF',tencent:'sh515180',index:'000922'},
 {id:'563220',name:'A500富国ETF',symbol:'563220',market:'A股',listing:'上海',currency:'CNY',kind:'ETF',tencent:'sh563220',index:'000510'},
 {id:'563360',name:'A500ETF',symbol:'563360',market:'A股',listing:'上海',currency:'CNY',kind:'ETF',tencent:'sh563360',index:'000510'},
 {id:'159545',name:'恒生红利低波ETF',symbol:'159545',market:'港股',listing:'深圳',currency:'CNY',kind:'ETF',tencent:'sz159545',index:'HSHKDIVLV'},
 ...[['000905','中证500'],['000922','中证红利'],['000510','中证A500']].map(([id,name])=>({id,name,symbol:id,market:'A股' as Market,listing:'指数',currency:'CNY',kind:'指数' as const,tencent:'sh'+id})),
 ...[['000001','上证指数','sh000001'],['399001','深证成指','sz399001'],['399006','创业板指','sz399006'],['000300','沪深300','sh000300']].map(([id,name,tencent])=>({id,name,symbol:id,market:'A股' as Market,listing:'指数',currency:'CNY',kind:'指数' as const,tencent})),
 {id:'HSHKDIVLV',name:'恒生港股通高股息低波动指数',symbol:'HSHKDIVLV',market:'港股',listing:'指数',currency:'HKD',kind:'指数'},
 ...[['HSI','恒生指数','^HSI','hkHSI'],['HSTECH','恒生科技','^HSTECH','hkHSTECH'],['HSCE','恒生国企','^HSCE','hkHSCEI']].map(([id,name,yahoo,tencent])=>({id,name,yahoo,tencent,symbol:id,market:'港股' as Market,listing:'指数',currency:'HKD',kind:'指数' as const})),
 ...[['SPX','标普500','^GSPC','us.INX'],['NDX','纳斯达克100','^NDX','us.NDX'],['IXIC','纳斯达克综合指数','^IXIC','us.IXIC'],['DJI','道琼斯工业平均指数','^DJI','us.DJI']].map(([id,name,yahoo,tencent])=>({id,name,yahoo,tencent,symbol:id,market:'美股' as Market,listing:'指数',currency:'USD',kind:'指数' as const})),
 ...[['SPY','标普500 ETF'],['QQQ','纳斯达克100 ETF'],['DIA','道琼斯 ETF'],['IWM','罗素2000 ETF']].map(([id,name])=>({id,name,symbol:id,market:'美股' as Market,listing:'美国',currency:'USD',kind:'ETF' as const,yahoo:id})),
 ...[['BTC','Bitcoin','bitcoin'],['ETH','Ethereum','ethereum'],['SOL','Solana','solana'],['BNB','BNB','binancecoin'],['XRP','XRP','ripple'],['TRX','TRON','tron']].map(([id,name,coin])=>({id,name,coin,symbol:id,market:'加密' as Market,listing:'参考市场',currency:'USD',kind:'加密' as const}))
 ,{id:'UNI',name:'Uniswap',coin:'uniswap',symbol:'UNI',market:'加密',listing:'Binance现货',currency:'USD',kind:'加密'},
 {id:'ZEC',name:'Zcash',coin:'zcash',symbol:'ZEC',market:'加密',listing:'Binance现货',currency:'USD',kind:'加密'},
 {id:'DOGE',name:'Dogecoin',coin:'dogecoin',symbol:'DOGE',market:'加密',listing:'Binance现货',currency:'USD',kind:'加密'}
];
export type Entry={id:string;asset:string;type:'opening'|'buy'|'sell'|'adjust';quantity:string;price:string;fee:string;date:string;note:string;plan?:string;occurrence?:string;plannedAmount?:string;plannedCurrency?:string;costKnown?:boolean};
export type Plan={id:string;asset:string;amount:string;currency:string;start:string;every:number;unit:'hour'|'day'|'week'|'month';skips:string[];paused?:boolean;resumeAt?:string;sourcePlan?:string;sourceName?:string;sourceTotal?:string;sourcePercent?:string;sourceStart?:string;sourceWallet?:string;sourceTimeVerified?:boolean;sourceNextText?:string;sourceStartText?:string;sourceIdOrigin?:'local'|'binance';sourcePaused?:boolean};
export type Settings={theme:'system'|'light'|'dark';currency:'CNY'|'USD';palette:boolean;marketPalettes:Record<string,boolean>;refresh:number};
export type State={version:1;entries:Entry[];plans:Plan[];watch:string[];settings:Settings;custom:Asset[];drafts:Entry[]};
export const initial=():State=>({version:1,entries:[],plans:[],watch:[],custom:[],drafts:[],settings:{theme:'system',currency:'CNY',palette:true,marketPalettes:{'A股':true,'港股':true,'美股':false,'加密':false},refresh:1}});
export function positions(entries:Entry[]){
 const out:Record<string,{quantity:string;cost:string|null;costKnown?:false}>={};const openings=new Set<string>();
 for(const e of [...entries].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||(a.type==="opening"?-1:b.type==="opening"?1:a.id.localeCompare(b.id)))){
  if(!e.id||!Number.isFinite(Date.parse(e.date)))throw Error('记录编号或日期无效');
  const q=new Decimal(e.quantity),p=new Decimal(e.price),f=new Decimal(e.fee||0);
  if(!q.isFinite()||!p.isFinite()||!f.isFinite()||q.isNegative()||p.isNegative()||f.isNegative())throw Error('数量、价格和手续费须为非负有限数');
  const old=out[e.asset]||{quantity:'0',cost:'0'},known=old.costKnown!==false,oq=new Decimal(old.quantity),oc=known?new Decimal(old.cost||'0'):null;
  if(e.type==='opening'){if(openings.has(e.asset)||out[e.asset])throw Error('每项资产只能有一笔期初记录，且须早于交易');openings.add(e.asset);out[e.asset]=e.costKnown===false?{quantity:q.toString(),cost:null,costKnown:false}:{quantity:q.toString(),cost:p.toString()};}
  else if(e.type==='adjust'){if(!e.note.trim())throw Error('校准必须填写原因');out[e.asset]=e.costKnown===false?{quantity:q.toString(),cost:null,costKnown:false}:{quantity:q.toString(),cost:p.toString()};}
  else if(e.type==='buy'){if(q.isZero())throw Error('成交数量须大于零');const next=oq.plus(q);out[e.asset]=oq.isZero()||known?{quantity:next.toString(),cost:oq.mul(oc||0).plus(q.mul(p)).plus(f).div(next).toString()}:{quantity:next.toString(),cost:null,costKnown:false};}
  else if(e.type==='sell'){if(q.isZero()||q.gt(oq))throw Error('卖出数量无效或超过持仓');const remainder=oq.minus(q);out[e.asset]=remainder.isZero()?{quantity:'0',cost:'0'}:known?{quantity:remainder.toString(),cost:old.cost}:{quantity:remainder.toString(),cost:null,costKnown:false};}
  else throw Error('未知记录类型');
 }return out;
}
export function validateState(s:State){
 const amount=z.string().max(80).refine(v=>{try{const n=new Decimal(v);return n.isFinite()&&n.gte(0)&&n.lt('1e24');}catch{return false;}},'金额或数量无效');
 const assetSchema=z.object({id:z.string().min(1).max(64),name:z.string().min(1).max(100),symbol:z.string().min(1).max(32),market:z.enum(['A股','港股','美股','加密']),listing:z.string().max(100),currency:z.enum(['CNY','USD','HKD']),kind:z.enum(['ETF','指数','加密','股票']),tencent:z.string().regex(/^(?:(sh|sz|bj)\d{6}|hk\d{5}|us[A-Z0-9.^-]{1,32})$/).optional(),yahoo:z.string().regex(/^[A-Za-z0-9.^-]{1,32}$/).optional(),coin:z.string().regex(/^[a-z0-9-]{1,80}$/).optional(),index:z.string().max(64).optional()});
 const entrySchema=z.object({id:z.string().min(1).max(100),asset:z.string().min(1).max(64),type:z.enum(['opening','buy','sell','adjust']),quantity:amount,price:amount,fee:amount,date:z.string().datetime({offset:true}),note:z.string().max(1000),plan:z.string().max(100).optional(),occurrence:z.string().datetime({offset:true}).optional(),plannedAmount:amount.optional(),plannedCurrency:z.enum(["CNY","USD","HKD","USDT"]).optional(),costKnown:z.boolean().optional()});
 z.object({version:z.literal(1),entries:z.array(entrySchema).max(10000),drafts:z.array(entrySchema).max(100),custom:z.array(assetSchema).max(100),watch:z.array(z.string().max(64)).max(200),plans:z.array(z.object({id:z.string().min(1).max(100),asset:z.string().max(64),amount,currency:z.enum(['CNY','USD','HKD','USDT']),start:z.string().datetime({offset:true}),every:z.number().int().min(1).max(10000),unit:z.enum(['hour','day','week','month']),skips:z.array(z.string().datetime({offset:true})).max(10000),paused:z.boolean().optional(),resumeAt:z.string().datetime({offset:true}).optional(),sourcePlan:z.string().max(100).optional(),sourceName:z.string().max(100).optional(),sourceTotal:amount.optional(),sourcePercent:amount.optional(),sourceStart:z.string().datetime({offset:true}).optional(),sourceWallet:z.string().max(100).optional(),sourceTimeVerified:z.boolean().optional(),sourceNextText:z.string().max(100).optional(),sourceStartText:z.string().max(100).optional(),sourceIdOrigin:z.enum(['local','binance']).optional(),sourcePaused:z.boolean().optional()})).max(100),settings:z.object({theme:z.enum(['system','light','dark']),currency:z.enum(['CNY','USD']),palette:z.boolean(),marketPalettes:z.record(z.boolean()),refresh:z.union([z.literal(0),z.literal(1),z.literal(5),z.literal(15)])})}).parse(s);
 if(s.version!==1||!Array.isArray(s.entries)||!Array.isArray(s.plans)||!Array.isArray(s.watch)||!Array.isArray(s.custom)||!Array.isArray(s.drafts)||!s.settings)throw Error('备份格式不兼容');
 const ids=new Set([...assets,...s.custom].map(a=>a.id)); const seen=new Set();
 for(const a of s.custom)validateAssetMapping(a);
 const providers=new Set<string>();for(const a of [...assets,...s.custom]){const k=a.tencent?'tx:'+a.tencent:a.yahoo?'yh:'+a.yahoo:a.coin?'cg:'+a.coin:a.id;if(providers.has(k))throw Error('同一行情资产已存在，请使用原有资产');providers.add(k);}
 if(ids.size!==assets.length+s.custom.length)throw Error('资产编号重复');
 for(const a of s.custom){if(a.kind==='指数')throw Error('自定义资产类型不支持');}
 for(const e of [...s.entries,...s.drafts]){if(!ids.has(e.asset)||[...assets,...s.custom].find(a=>a.id===e.asset)?.kind==='指数')throw Error('指数或未知资产不能记为持仓');}
 for(const e of s.entries){if(!ids.has(e.asset)||seen.has(e.id))throw Error('资产未知或记录编号重复');seen.add(e.id);}
 for(const e of s.entries){const p=s.plans.find(p=>p.id===e.plan);if(p&&(e.type!=='buy'||e.asset!==p.asset))throw Error('定投只能关联同一资产的买入记录');}
 if(new Set(s.plans.map(p=>p.id)).size!==s.plans.length)throw Error('定投计划编号重复');
 positions(s.entries);
 for(const p of s.plans){if(!ids.has(p.asset)||!new Decimal(p.amount).gt(0)||!Number.isInteger(p.every)||p.every<1||!['hour','day','week','month'].includes(p.unit)||!Number.isFinite(Date.parse(p.start))||!Array.isArray(p.skips))throw Error('定投计划无效');}
 if(!['system','light','dark'].includes(s.settings.theme)||!['CNY','USD'].includes(s.settings.currency)||![0,1,5,15].includes(s.settings.refresh))throw Error('设置无效');
 return s;
}
export function nextOccurrence(p:Plan,now=Date.now()){return nextPlanTime(p,now);}
export type Quote={price:number;change:number|null;at:string|null;fetched:string;source:string;window:string;currency:string;stale?:boolean;name?:string;scale?:import('./scale').MarketScale;standard?:import('./quotes/types').StandardQuote};






