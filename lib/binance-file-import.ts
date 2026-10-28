import Decimal from 'decimal.js';
import {z} from 'zod';
import {assets as builtins, validateState, type Asset, type Entry, type Plan, type State} from './model.ts';

const decimal = z.string().max(80).refine(s => { try { const n = new Decimal(s); return n.isFinite() && n.gte(0) && n.lt('1e24'); } catch { return false; } }, '数量或金额无效');
const symbol = z.string().regex(/^[A-Z0-9]{1,30}$/);
const timestamp = z.string().datetime({offset:true});
const instrument = z.enum(['crypto','stablecoin','tokenized_stock']);
const allocation = z.object({symbol, percent:decimal, instrument:instrument.optional()});
const fileSchema = z.object({
  format:z.literal('binance-account-import-v1'), capturedAt:timestamp,
  coverage:z.array(z.string().min(1).max(80)).max(20), complete:z.boolean(), precisionNote:z.string().max(300).optional(), notes:z.array(z.string().max(300)).max(20).optional(),
  balances:z.array(z.object({source:z.enum(['spot','simple_earn_flexible','simple_earn_locked']), positionId:z.string().min(1).max(100), symbol, quantity:decimal, instrument:instrument.optional()})).max(1000),
  overviewComplete:z.boolean().optional(), overviewVerified:z.boolean().optional(),
  overviewTotals:z.array(z.object({symbol,quantity:decimal,instrument:instrument.optional()})).max(1000).optional(),
  assetCosts:z.array(z.object({symbol,price:decimal,currency:z.literal('USD')})).max(1000).optional(),
  plans:z.array(z.object({sourceId:z.string().regex(/^[A-Za-z0-9_:-]{1,45}$/),sourceIdOrigin:z.enum(['local','binance']),name:z.string().max(100).optional(),amount:decimal,currency:z.enum(['CNY','USD','HKD','USDT']),every:z.number().int().min(1).max(10000),unit:z.enum(['hour','day','week','month']),timeZoneVerified:z.boolean(),nextAt:timestamp.optional(),startAt:timestamp.optional(),nextText:z.string().max(100).optional(),startText:z.string().max(100).optional(),paused:z.boolean(),targetWallet:z.string().max(100).optional(),allocations:z.array(allocation).min(1).max(100)})).max(100).optional()
});
type ImportFile = z.infer<typeof fileSchema>;
export type BinanceImportPreview = {state:State; messages:string[]; balanceCount:number; planCount:number};

const binanceRecord = (e:Entry) => /^(binance-snapshot:|binance-adjust:|binance-balance:)/.test(e.id);
const stockTokens = new Set(['MSTRB','BMNRB','CRCLB','COINB','HOODB']);
const stableIds:Record<string,string> = {USDT:'tether',USDC:'usd-coin'};

/** Preview only: no IO and no write. Quantities are a single snapshot, never trades. */
export function prepareBinanceImport(state:State, input:unknown):BinanceImportPreview {
 const file:ImportFile=fileSchema.parse(input);
 const all=[...builtins,...state.custom]; const custom=[...state.custom];
 function resolve(s:string, kind?:z.infer<typeof instrument>) {
  const isStock=kind==='tokenized_stock'||stockTokens.has(s);
  const existing=all.find(a=>isStock?a.id===`binance:${s}`:a.symbol===s&&a.kind==='加密');
  if(existing)return existing;
  const a:Asset=isStock?{id:`binance:${s}`,symbol:s,name:`${s}（bStocks）`,market:'美股',listing:'Binance bStocks 代币化证券',currency:'USD',kind:'股票'}:{id:`binance:${s}`,symbol:s,name:s,market:'加密',listing:'Binance',currency:'USD',kind:'加密',...(stableIds[s]?{coin:stableIds[s]}:{})};
  all.push(a);custom.push(a);return a;
 }
 const messages:string[]=[]; const details=new Map<string,Decimal>();const seen=new Map<string,string>();
 for(const r of file.balances){
  const key=`${r.source}:${r.positionId}:${r.symbol}`;const value=new Decimal(r.quantity).toString();
  if(seen.has(key)){if(seen.get(key)!==value)throw Error(`来源 ${r.source} 中 ${r.symbol} 存在冲突的重复记录`);continue;}
  seen.set(key,value);details.set(r.symbol,(details.get(r.symbol)||new Decimal(0)).plus(value));
 }
 let totals:{symbol:string;quantity:string;instrument?:z.infer<typeof instrument>}[]=[]; let partial=false;
 if((file.overviewComplete||file.overviewVerified) && file.overviewTotals){
  const names=new Set<string>();for(const r of file.overviewTotals){if(names.has(r.symbol))throw Error(`总览重复资产 ${r.symbol}`);names.add(r.symbol);}
  for(const s of details.keys())if(!names.has(s))throw Error(`总览未包含明细资产 ${s}，请重新核对`);
  totals=file.overviewTotals;
  const differences=totals.filter(r=>details.has(r.symbol)&&!details.get(r.symbol)!.eq(r.quantity)).map(r=>r.symbol);
  if(differences.length)messages.push(`总览与已采集的现货/理财明细有差异：${differences.join('、')}；以总览数量为准，差异可能来自其他账户、更新时点或未覆盖范围。`);
  messages.push('使用逐币核验的钱包总览数量；现货与理财明细不再叠加。未列币种不会自动清零。');
 } else if(file.complete && ['spot','simple_earn_flexible','simple_earn_locked'].every(x=>file.coverage.includes(x))){
  totals=[...details].map(([s,n])=>({symbol:s,quantity:n.toString(),instrument:file.balances.find(r=>r.symbol===s)?.instrument}));
  messages.push('按现货、活期与定期明细合并；重复产品记录不会重复计数。');
 } else if(file.balances.length){
  partial=true;totals=[...details].map(([s,n])=>({symbol:s,quantity:n.toString(),instrument:file.balances.find(r=>r.symbol===s)?.instrument}));
  messages.push('余额范围不完整：仅新增账本中尚无记录的币种，现有持仓保留，不将已采集明细当成完整账户余额。');
 }
 if(!file.complete)messages.push(`已采集范围：${file.coverage.join('、')||'未说明'}；其他账户或产品范围未核验。`);
 if(file.precisionNote)messages.push(file.precisionNote);
 if(file.notes)messages.push(...file.notes);
 const entries=[...state.entries];let balanceCount=0;const oldSymbols=new Set(state.entries.filter(binanceRecord).map(e=>e.asset));
 const costs=new Map((file.assetCosts||[]).map(c=>[c.symbol,c]));
 for(const r of totals){
  const a=resolve(r.symbol,r.instrument||file.balances.find(x=>x.symbol===r.symbol)?.instrument);
  const previous=entries.filter(e=>e.asset===a.id);if(partial&&previous.length)continue;oldSymbols.delete(a.id);
  if(previous.some(e=>!binanceRecord(e)))throw Error(`${r.symbol} 已有非 Binance 快照的账本记录，无法安全分离账户，请人工核对后导入`);
  const id=`binance-adjust:${file.capturedAt}:${r.symbol}`;
  const cost=costs.get(r.symbol);const next:Entry={id,asset:a.id,type:previous.length?'adjust':'opening',quantity:new Decimal(r.quantity).toString(),price:cost?new Decimal(cost.price).toString():'0',fee:'0',date:file.capturedAt,note:`Binance ${partial?'部分范围':'余额'}快照；范围：${file.coverage.join('、')}；${partial?'其他来源未核验，数量不保证完整；':''}${cost?'成本为来源披露的合并平均成本':'成本未知，不计算浮盈亏'}。`,costKnown:!!cost};
  const same=previous.find(e=>e.id===id);if(same){if(same.quantity!==next.quantity||same.price!==next.price)throw Error(`${r.symbol} 同一快照时间的数据发生冲突`);continue;}
  if(previous.some(e=>Date.parse(e.date)>=Date.parse(file.capturedAt)))throw Error(`${r.symbol} 已有同一时间或之后的账本记录，请重新采集快照`);
  entries.push(next);balanceCount++;
 }
 if(oldSymbols.size)messages.push(`原有 ${oldSymbols.size} 项 Binance 持仓未出现在本次可核验快照，保留原记录，不自动清零。`);
 const plans=[...state.plans];let planCount=0;
 if(new Set((file.plans||[]).map(p=>p.sourceId)).size!==(file.plans||[]).length)throw Error('组合计划导入标识重复，请先核对');
 for(const p of file.plans||[]){
  if(p.timeZoneVerified&&!p.nextAt)throw Error(`计划 ${p.sourceId} 已确认时区但缺少下次时间`);
  if(!p.timeZoneVerified&&!p.nextText)throw Error(`计划 ${p.sourceId} 的时区待核对，请提供页面原始下次时间`);
  const sum=p.allocations.reduce((n,a)=>n.plus(a.percent),new Decimal(0));if(!sum.eq(100))throw Error(`计划 ${p.sourceId} 的比例合计不是 100%`);
  if(new Decimal(p.amount).lte(0))throw Error(`计划 ${p.sourceId} 金额须大于零`);
  const planAssets=new Set<string>();
  for(const leg of p.allocations){
   if(planAssets.has(leg.symbol)||new Decimal(leg.percent).lte(0))throw Error(`计划 ${p.sourceId} 的币种或比例无效`);planAssets.add(leg.symbol);
   const a=resolve(leg.symbol,leg.instrument);const id=`binance-plan:${p.sourceId}:${leg.symbol}`;const old=plans.find(x=>x.id===id);
   const plan:Plan={id,asset:a.id,amount:new Decimal(p.amount).mul(leg.percent).div(100).toString(),currency:p.currency,start:p.nextAt||file.capturedAt,every:p.every,unit:p.unit,skips:old?.skips||[],paused:p.paused||!p.timeZoneVerified,sourcePlan:p.sourceId,sourceName:p.name,sourceTotal:p.amount,sourcePercent:leg.percent,sourceStart:p.startAt,sourceWallet:p.targetWallet,sourceTimeVerified:p.timeZoneVerified,sourceNextText:p.nextText,sourceStartText:p.startText,sourceIdOrigin:p.sourceIdOrigin,sourcePaused:p.paused};
   if(old?.resumeAt)plan.resumeAt=old.resumeAt;
   const idx=plans.findIndex(x=>x.id===id);if(idx<0)plans.push(plan);else plans[idx]=plan;planCount++;
  }
  for(let i=0;i<plans.length;i++){const x=plans[i];if(x.sourcePlan===p.sourceId&&!planAssets.has(all.find(a=>a.id===x.asset)?.symbol||''))plans[i]={...x,paused:true};}
 }
 if(file.plans?.length)messages.push('组合比例按计划金额拆成关联分项；计划不会增加持仓，成交需另行登记。');
 if(file.plans?.some(p=>!p.timeZoneVerified))messages.push('部分计划的来源时区待核对：保留页面原始时间，本地暂不推算执行时间。');
 if(file.plans?.some(p=>p.sourceIdOrigin==='local'))messages.push('部分组合使用本地生成的导入标识，修改计划后可能需要人工核对重复项。');
 const next=validateState({...state,entries,plans,custom});
 return {state:next,messages,balanceCount,planCount};
}
