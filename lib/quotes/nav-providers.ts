import type {FundNav} from '../nav.ts';

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
export async function fetchIssuerNav(symbol:string,fetcher:typeof fetch=fetch,now:()=>Date=()=>new Date()):Promise<FundNav>{
 if(symbol!=='IWM')throw Error('该基金发行人净值尚未接入');
 const response=await fetcher(IWM_URL,{signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('发行人净值源 HTTP '+response.status);
 const html=await response.text();
 return parseIwmIssuerNav(html,now().toISOString());
}

export function parseBridgeNav(body:unknown,assetId:string,currency:string,now=Date.now()):FundNav{
 const row=(body as {nav?:Record<string,unknown>})?.nav;
 const validDate=(date:unknown)=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date&&date<=new Date(now).toISOString().slice(0,10);
 if(!row||row.assetId!==assetId||row.currency!==currency||typeof row.value!=='number'||!Number.isFinite(row.value)||row.value<=0||!validDate(row.date)||typeof row.source!=='string'||!row.source.trim()||row.source.length>512||typeof row.fetched!=='string'||!Number.isFinite(Date.parse(row.fetched))||Date.parse(row.fetched)>now+60000)throw Error('桥接净值身份、币种或日期无效');
 return {value:row.value,date:row.date as string,currency,source:row.source,fetched:row.fetched};
}

