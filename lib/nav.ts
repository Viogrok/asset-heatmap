import Decimal from 'decimal.js';
export type FundNav={value:number;date:string;currency:string;source:string;fetched:string;stale?:boolean;close?:number;closeSource?:string;closeFetched?:string;premium?:number};
export function disclosedNav(body:any,currency:string,fetched:string):FundNav{
 if(body.ErrCode!==0||!Array.isArray(body.Data?.LSJZList))throw Error('净值数据格式不兼容');
 const row=body.Data.LSJZList.find((r:any)=>/^\d{4}-\d{2}-\d{2}$/.test(r.FSRQ)&&Number.isFinite(Number(r.DWJZ))&&Number(r.DWJZ)>0);
 if(!row)throw Error('未取得有效披露净值');
 return {value:Number(row.DWJZ),date:row.FSRQ,currency,fetched,source:'东方财富历史净值（基金披露值转引）'};
}
export function compareNavClose(nav:FundNav,body:any,symbol:string,now=Date.now()):FundNav{
 // Never substitute qfqday/hfqday. Only unadjusted closing prices are comparable.
 const rows=body.data?.[symbol]?.day;if(!Array.isArray(rows))return nav;
 const china=new Date(now+8*3600000);const today=china.toISOString().slice(0,10);
 if(nav.date===today&&china.getUTCHours()<15||nav.date>today)return nav;
 const match=rows.find((r:any)=>r[0]===nav.date&&Number(r[2])>0);
 if(!match)return nav;
 return {...nav,close:Number(match[2]),closeSource:'腾讯日线（未复权收盘价）',premium:new Decimal(match[2]).div(nav.value).minus(1).mul(100).toNumber()};
}
export function verifiedCloseFallback(nav:FundNav,previous?:FundNav):FundNav{
 if(nav.close!=null||!previous||previous.date!==nav.date||previous.currency!==nav.currency||!Number.isFinite(previous.close)||!previous.close||previous.close<=0||!previous.closeSource?.includes('未复权'))return nav;
 return {...nav,close:previous.close,closeSource:previous.closeSource+'（同日已核验快照）',closeFetched:previous.fetched,premium:new Decimal(previous.close).div(nav.value).minus(1).mul(100).toNumber()};
}
