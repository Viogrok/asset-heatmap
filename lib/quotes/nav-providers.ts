import type {FundNav} from '../nav.ts';
import type {Asset} from '../model.ts';

export const issuerNavReferenceAssets:Asset[]=[{id:'HK:02800',name:'盈富基金',symbol:'02800',market:'港股',listing:'香港',currency:'HKD',kind:'ETF',tencent:'hk02800',yahoo:'2800.HK',index:'HSI'}];

const IWM_URL='https://www.ishares.com/us/products/239710/ishares-russell-2000-etf';
const IWM_FUND=IWM_URL+'#fund';
const months:Record<string,string>={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
/** Read only the issuer's explicitly labelled, dated NAV property, never market price or index. */
export function parseIwmIssuerNav(html:string, fetched:string):FundNav {
 const scripts=[...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
 for(const script of scripts){
  let root:any;try{root=JSON.parse(script[1]);}catch{continue;}
  const nodes=Array.isArray(root)?root:Array.isArray(root?.['@graph'])?root['@graph']:[root];
  for(const node of nodes){
   if(node?.about?.['@id']!==IWM_FUND||!Array.isArray(node.additionalProperty))continue;
   const properties=node.additionalProperty.filter((p:any)=>p?.name==='NAV as of'&&p.unitText==='USD'&&p.valueReference?.name==='As of Dates');
   if(properties.length===0)continue;
   if(properties.length!==1)throw Error('IWM 净值字段不唯一');
   const p=properties[0], m=typeof p.valueReference.value==='string'?/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})$/.exec(p.valueReference.value):null;
   const value=typeof p.value==='string'&&/^\d+(?:\.\d+)?$/.test(p.value)?Number(p.value):NaN;
   if(!m||!Number.isFinite(value)||value<=0)throw Error('IWM 净值字段无效');
   const date=`${m[3]}-${months[m[1]]}-${m[2].padStart(2,'0')}`;
   const parsed=new Date(date+'T00:00:00Z');
   if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date||date>fetched.slice(0,10))throw Error('IWM 净值日期无效');
   return {value,date,currency:'USD',source:'iShares IWM 发行人披露 NAV',fetched};
  }
 }
 throw Error('未找到 iShares IWM 披露净值');
}
const US_ISSUERS={
 SPY:{url:'https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-sp-500-etf-trust-spy',isin:'US78462F1030'},
 DIA:{url:'https://www.ssga.com/us/en/individual/etfs/state-street-spdr-dow-jones-industrial-average-etf-trust-dia',isin:'US78467X1090'},
} as const;
const QQQ_URL='https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/46090E103/prices?idType=cusip&variationType=priceListing&productType=ETF&productSubType=ETF';
export function supportsIssuerNav(symbol:string,market:string,currency:string):boolean{
 return market==='美股'&&currency==='USD'&&['IWM','SPY','DIA','QQQ'].includes(symbol)||market==='港股'&&currency==='HKD'&&['2800','02800'].includes(symbol);
}
function validIssuerDate(date:unknown,fetched:string):date is string{
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
 const d=new Date(date+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===date&&date<=fetched.slice(0,10);
}
// Decode only character references in the single official input value, before parsing its JSON.
function decodeHtml(s:string){return s.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|lt|gt|apos);/gi,(all,entity:string)=>{
 if(entity[0]==='#'){const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):all;}
 return ({quot:'"',amp:'&',lt:'<',gt:'>',apos:"'"} as Record<string,string>)[entity.toLowerCase()]??all;
 });}
export function parseStateStreetNav(html:string,symbol:'SPY'|'DIA',fetched:string):FundNav{
 const inputs=[...html.matchAll(/<input\s+type="hidden"\s+id="fund-quick-info"\s+value="([^"]*)"/gi)];
 if(inputs.length!==1)throw Error('State Street 基金信息不唯一');
 const encoded=inputs[0];
 let attrs:any;try{attrs=JSON.parse(decodeHtml(encoded[1])).attrs;}catch{throw Error('State Street 基金信息格式无效');}
 const nav=attrs?.nav;
 if(attrs?.['fund-ticker']?.value!==symbol||attrs?.isin?.value!==US_ISSUERS[symbol].isin||nav?.label!=='NAV'||typeof nav.value!=='string'||!/^\$(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(nav.value))throw Error('State Street 基金身份或净值无效');
 const m=typeof nav.asOfDateSimple==='string'?/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}) (\d{4})$/.exec(nav.asOfDateSimple):null;
 const value=Number(nav.value.slice(1).replace(/,/g,''));const date=m?`${m[3]}-${months[m[1]]}-${m[2].padStart(2,'0')}`:'';
 if(!Number.isFinite(value)||value<=0||!validIssuerDate(date,fetched))throw Error('State Street 净值日期或数值无效');
 return {value,date,currency:'USD',source:`State Street ${symbol} 发行人披露 NAV`,fetched};
}
export function parseQqqIssuerNav(body:unknown,fetched:string):FundNav{
 const row=body as Record<string,unknown>|null;
 if(!row||row.cusip!=='46090E103'||row.currency!=='USD'||typeof row.nav!=='number'||!Number.isFinite(row.nav)||row.nav<=0||!validIssuerDate(row.effectiveDate,fetched))throw Error('Invesco QQQ 净值身份、币种或日期无效');
 return {value:row.nav,date:row.effectiveDate,currency:'USD',source:'Invesco QQQ 发行人披露 NAV',fetched};
}
const TRAHK_DETAIL='https://rbwm-api.hsbc.com.hk/pws-hk-hase-hsvm2-papi-prod-proxy/v1/hsvm/aem/trahkEtffunddetail?trustNo=H02800';
const TRAHK_NAV='https://rbwm-api.hsbc.com.hk/pws-hk-hase-hsvm2-papi-prod-proxy/v1/hsvm/fund/trahkEtfinfo?isinCode=HK2800008867';
export function parseTrahkIssuerNav(detail:unknown,quote:unknown,fetched:string):FundNav{
 const fund=(detail as any)?.Fund, row=quote as Record<string,unknown>|null;
 if(fund?.Trust_no!=='H02800'||fund?.ISIN_code!=='HK2800008867'||fund?.Base_Currency!=='HKD'||!Array.isArray(fund.FundUnitClass)||row?.isin!=='HK2800008867')throw Error('盈富基金身份不符');
 const matches=fund.FundUnitClass.filter((c:any)=>c?.Fund_code===2800&&c.Class_currency==='HKD'&&c.Class_ISIN_code==='HK2800008867');
 if(matches.length!==1||typeof row.Nav!=='number'||!Number.isFinite(row.Nav)||row.Nav<=0||!validIssuerDate(matches[0].Dealing_date,fetched))throw Error('盈富基金净值或日期无效');
 const date=matches[0].Dealing_date as string;
 if(!Number.isInteger(row.PrevDate)||String(row.PrevDate)!==date.replace(/-/g,''))throw Error('盈富基金净值日期不一致');
 return {value:row.Nav,date,currency:'HKD',source:'盈富基金发行人披露 NAV（港元柜台）',fetched};
}
export async function fetchIssuerNav(symbol:string,fetcher:typeof fetch=fetch,now:()=>Date=()=>new Date(),market='美股',authorization:{invescoLicensed?:boolean}={}):Promise<FundNav>{
 const currency=market==='港股'?'HKD':'USD';
 if(!supportsIssuerNav(symbol,market,currency))throw Error('该基金发行人净值尚未接入');
 if(symbol==='QQQ'&&!authorization.invescoLicensed)throw Error('Invesco 自动访问许可尚未配置');
 if(market==='港股'){
  const [detail,nav]=await Promise.all([fetcher(TRAHK_DETAIL,{signal:AbortSignal.timeout(12000)}),fetcher(TRAHK_NAV,{signal:AbortSignal.timeout(12000)})]);
  if(!detail.ok||!nav.ok)throw Error('盈富基金净值源暂不可用');
  return parseTrahkIssuerNav(await detail.json(),await nav.json(),now().toISOString());
 }
 const url=symbol==='IWM'?IWM_URL:symbol==='QQQ'?QQQ_URL:US_ISSUERS[symbol as 'SPY'|'DIA'].url;
 const response=await fetcher(url,{signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('发行人净值源 HTTP '+response.status);
 const fetched=now().toISOString();
 if(symbol==='QQQ')return parseQqqIssuerNav(await response.json(),fetched);
 const html=await response.text();
 return symbol==='IWM'?parseIwmIssuerNav(html,fetched):parseStateStreetNav(html,symbol as 'SPY'|'DIA',fetched);
}

export function parseBridgeNav(body:unknown,assetId:string,currency:string,now=Date.now()):FundNav{
 const row=(body as {nav?:Record<string,unknown>})?.nav;
 const validDate=(date:unknown)=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date&&date<=new Date(now).toISOString().slice(0,10);
 if(!row||row.assetId!==assetId||row.currency!==currency||typeof row.value!=='number'||!Number.isFinite(row.value)||row.value<=0||!validDate(row.date)||typeof row.source!=='string'||!row.source.trim()||row.source.length>512||typeof row.fetched!=='string'||!Number.isFinite(Date.parse(row.fetched))||Date.parse(row.fetched)>now+60000)throw Error('桥接净值身份、币种或日期无效');
 return {value:row.value,date:row.date as string,currency,source:row.source,fetched:row.fetched};
}
