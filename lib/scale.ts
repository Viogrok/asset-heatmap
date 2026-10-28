export type ScaleBasis='aum'|'market-cap'|'crypto-cap';
export type MarketScale={value:number;currency:string;kind:ScaleBasis;asOf:string|null;fetched:string;source:string;stale?:boolean};
export const scaleLabels:Record<ScaleBasis,string>={'aum':'ETF净资产规模','market-cap':'股票总市值','crypto-cap':'加密流通市值'};
export function matchesScaleBasis(kind:string,basis:ScaleBasis){return kind===(basis==='aum'?'ETF':basis==='market-cap'?'股票':'加密');}
function positive(v:number){if(!Number.isFinite(v)||v<=0)throw Error('未取得有效的市场规模');return v;}
export function parseFundScale(html:string,fetched:string):MarketScale{
 const plain=html.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
 const m=plain.match(/净资产规模\s*[：:]?\s*([\d,.]+)\s*(亿|万)?元\s*[（(]\s*截止至[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
 if(!m)throw Error('未取得ETF净资产规模及报告日期');
 return {value:positive(Number(m[1].replaceAll(',',''))*(m[2]==='亿'?1e8:m[2]==='万'?1e4:1)),currency:'CNY',kind:'aum',asOf:`${m[3]}-${m[4].padStart(2,'0')}-${m[5].padStart(2,'0')}`,fetched,source:'东方财富基金档案（报告期净资产）'};
}
export function parseNasdaqScale(body:any,fetched:string):MarketScale{
 const field=body.data?.summaryData?.AUM;
 if(!field||!/,\s*000|thousand/i.test(field.label||''))throw Error('AUM缺失或单位尚未确认');
 return {value:positive(Number(String(field.value).replace(/[$,\s]/g,''))*1000),currency:'USD',kind:'aum',asOf:null,fetched,source:'Nasdaq ETF Summary（AUM，千美元转美元）'};
}
export function parseStockScale(raw:string,currency:string,fetched:string):MarketScale{
 const v=raw.split('"')[1]?.split('~');
 return {value:positive(Number(v?.[45])*1e8),currency,kind:'market-cap',asOf:null,fetched,source:'腾讯公开行情（总市值，亿元单位转原币）'};
}
