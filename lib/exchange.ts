import Decimal from 'decimal.js';
export type Balance={asset:string;spot:string;flexible:string;locked:string;total:string};
export type ExchangeTrade={id:string;symbol:string;side:'buy'|'sell';quantity:string;price:string;quoteAmount:string;quoteCurrency:string;commission:string;commissionAsset:string;time:string};
export type ExchangeSnapshot={at:string;date:string;balances:Balance[];trades:ExchangeTrade[];errors:string[];coverage:string[];complete:boolean};
export async function hmacSignature(secret:string,payload:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload));return Array.from(new Uint8Array(bytes)).map(v=>v.toString(16).padStart(2,'0')).join('');}
export function assertReadOnly(p:any){if(p.enableReading!==true)throw Error('API未启用读取权限');const forbidden=['enableWithdrawals','enableInternalTransfer','permitsUniversalTransfer','enableMargin','enableFutures','enableVanillaOptions','enableFixApiTrade','enableSpotAndMarginTrading','enablePortfolioMarginTrading'];if(forbidden.some(k=>p[k]===true))throw Error('该API密钥包含交易、划转或提现权限，请改用仅启用读取的专用密钥');}
function quantity(v:unknown){const n=new Decimal(String(v));if(!n.isFinite()||n.isNegative())throw Error('账户数量格式异常');return n;}
export function mergeBalances(spot:any[],flexible:any[],locked:any[]):Balance[]{
 const totals=new Map<string,{spot:Decimal;flexible:Decimal;locked:Decimal}>();const seen=new Set<string>();
 function add(asset:string,source:'spot'|'flexible'|'locked',id:string,value:Decimal){if(!/^[A-Z0-9]{1,30}$/.test(asset)||!id)throw Error('账户资产或产品编号无效');const key=source+':'+id;if(seen.has(key))return;seen.add(key);const row=totals.get(asset)||{spot:new Decimal(0),flexible:new Decimal(0),locked:new Decimal(0)};row[source]=row[source].plus(value);totals.set(asset,row);}
 for(const r of spot)add(r.asset,'spot',r.asset,quantity(r.free).plus(quantity(r.locked)));
 for(const r of flexible)add(r.asset,'flexible',String(r.productId||''),quantity(r.totalAmount));
 for(const r of locked)add(r.asset,'locked',String(r.positionId||''),quantity(r.amount));
 return [...totals.entries()].map(([asset,r])=>({asset,spot:r.spot.toString(),flexible:r.flexible.toString(),locked:r.locked.toString(),total:r.spot.plus(r.flexible).plus(r.locked).toString()})).filter(r=>Number(r.total)>0).sort((a,b)=>a.asset.localeCompare(b.asset));
}
export function normalizeTrades(symbol:string,rows:any[]):ExchangeTrade[]{
 if(!/^[A-Z0-9]+USDT$/.test(symbol))throw Error('当前成交预览只支持选定USDT现货交易对');
 const out=new Map<string,ExchangeTrade>();for(const t of rows){if(t.id==null||!Number.isFinite(t.time)||typeof t.isBuyer!=='boolean')throw Error('成交记录不完整');const id=symbol+':'+String(t.id);out.set(id,{id,symbol,side:t.isBuyer?'buy':'sell',quantity:quantity(t.qty).toString(),price:quantity(t.price).toString(),quoteAmount:quantity(t.quoteQty).toString(),quoteCurrency:'USDT',commission:quantity(t.commission).toString(),commissionAsset:String(t.commissionAsset),time:new Date(t.time).toISOString()});}return [...out.values()].sort((a,b)=>Date.parse(b.time)-Date.parse(a.time));
}
export function makeBalanceDrafts(snapshot:ExchangeSnapshot,availableAssetIds:string[]){
 const supported=new Set(availableAssetIds),supportedBalances=snapshot.balances.filter(b=>supported.has(b.asset));
 const drafts=supportedBalances.map((b,i)=>({id:`binance-balance:${snapshot.at}:${b.asset}`,asset:b.asset,type:'opening' as const,quantity:b.total,price:'0',fee:'0',date:snapshot.at,note:`Binance账户只读快照（${snapshot.coverage.join('、')}）；来源时间 ${snapshot.at}。成本未知，核实后再登记。`,costKnown:false}));
 return {drafts,unsupported:snapshot.balances.filter(b=>!supported.has(b.asset)).map(b=>b.asset),source:'Binance只读余额快照',asOf:snapshot.at,complete:snapshot.complete,coverage:snapshot.coverage,errors:snapshot.errors};
}
