import type { MarketStatus } from './types.ts';

export type ReferenceResult<T> = { status: 'OK'; data: T } | { status: 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'INVALID_RESPONSE'; data: null };
export type CalendarDay = { date: string; timeZone: string; trading: boolean; halfDay: boolean | null; regular: [string, string][] | null };
export type LongbridgeMarket = 'US' | 'HK' | 'CN' | 'SG';
const zones: Record<LongbridgeMarket, string> = { US: 'America/New_York', HK: 'Asia/Hong_Kong', CN: 'Asia/Shanghai', SG: 'Asia/Singapore' };
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const validTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function dates(start: string, end: string): string[] {
 if (!validDate(start) || !validDate(end) || start > end) throw new Error('Invalid date range');
 const a = Date.parse(`${start}T00:00:00Z`), b = Date.parse(`${end}T00:00:00Z`);
 if ((b-a)/86400000 > 3660) throw new Error('Date range too large');
 return Array.from({ length: (b-a)/86400000+1 }, (_, i) => new Date(a+i*86400000).toISOString().slice(0,10));
}
const record = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const headers = (key: string, secret: string) => ({ 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret });

/** Only full, successfully returned ranges can establish a closed day. */
export async function alpacaCalendar(key: string, secret: string, start: string, end: string, request: typeof fetch = fetch, environment:'paper'|'live'='paper'): Promise<ReferenceResult<CalendarDay[]>> {
 const all = dates(start,end);
 if (!key || !secret) return {status:'NOT_CONFIGURED',data:null};
 if (start < '1970-01-01' || end > '2029-12-31') return {status:'UNAVAILABLE',data:null};
 try {
  const url = new URL(environment==='live'?'https://api.alpaca.markets/v2/calendar':'https://paper-api.alpaca.markets/v2/calendar');
  url.search = new URLSearchParams({start,end,date_type:'TRADING'}).toString();
  const res = await request(url, {headers: headers(key,secret)});
  if (!res.ok) return {status:'UNAVAILABLE',data:null};
  const body: unknown = await res.json();
  if (!Array.isArray(body)) return {status:'INVALID_RESPONSE',data:null};
  const map = new Map<string, CalendarDay>();
  for (const row of body) {
   if (!record(row) || typeof row.date !== 'string' || !validDate(row.date) || row.date < start || row.date > end || !validTime(row.open) || !validTime(row.close) || row.open >= row.close || map.has(row.date)) return {status:'INVALID_RESPONSE',data:null};
   map.set(row.date, {date:row.date,timeZone:zones.US,trading:true,halfDay:null,regular:[[row.open,row.close]]});
  }
  return {status:'OK',data:all.map(date => map.get(date) ?? {date,timeZone:zones.US,trading:false,halfDay:null,regular:[]})};
 } catch { return {status:'UNAVAILABLE',data:null}; }
}

/** A successful Longbridge SDK bridge returns the documented full and half-day lists. */
export type LongbridgeCalendarClient = (market: LongbridgeMarket, start: string, end: string) => Promise<{trade_day: string[]; half_trade_day: string[]}>;
export async function longbridgeCalendar(client: LongbridgeCalendarClient | undefined, market: LongbridgeMarket, start: string, end: string): Promise<ReferenceResult<CalendarDay[]>> {
 const all = dates(start,end);
 if (!client) return {status:'NOT_CONFIGURED',data:null};
 if (!zones[market]) throw new Error('Invalid market');
 try {
  const full = new Set<string>(), half = new Set<string>();
  // Split at calendar month boundaries, which is within the provider's one-month limit.
  for (let i=0; i<all.length;) {
   const first=all[i], month=first.slice(0,7); let j=i;
   while (j+1<all.length && all[j+1].startsWith(month)) j++;
   const result = await client(market,first,all[j]);
   if (!record(result) || !Array.isArray(result.trade_day) || !Array.isArray(result.half_trade_day)) return {status:'INVALID_RESPONSE',data:null};
   for (const [items,target] of [[result.trade_day,full],[result.half_trade_day,half]] as const) for (const value of items) {
    if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return {status:'INVALID_RESPONSE',data:null};
    const date = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
    if (!validDate(date) || date<first || date>all[j] || target.has(date)) return {status:'INVALID_RESPONSE',data:null};
    target.add(date);
   }
   i=j+1;
  }
  if ([...half].some(date=>full.has(date))) return {status:'INVALID_RESPONSE',data:null};
  return {status:'OK',data:all.map(date=>({date,timeZone:zones[market],trading:full.has(date)||half.has(date),halfDay:half.has(date),regular:full.has(date)||half.has(date)?null:[]}))};
 } catch {return {status:'UNAVAILABLE',data:null};}
}

/** Outside an explicitly supplied regular session, extended-hours state is unknown. */
export function referenceSessionAt(now: number, day: CalendarDay | undefined): MarketStatus {
 if (!day || !Number.isFinite(now) || !validDate(day.date)) return 'UNKNOWN';
 try {
  const fmt = new Intl.DateTimeFormat('en-CA',{timeZone:day.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const parts=Object.fromEntries(fmt.formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  if (`${parts.year}-${parts.month}-${parts.day}` !== day.date) return 'UNKNOWN';
  if (!day.trading) return 'CLOSED';
  if (!day.regular || !day.regular.length || !day.regular.every(p=>Array.isArray(p)&&p.length===2&&validTime(p[0])&&validTime(p[1])&&p[0]<p[1])) return 'UNKNOWN';
  const time=`${parts.hour}:${parts.minute}`;
  return day.regular.some(([open,close])=>time>=open&&time<close) ? 'OPEN' : 'UNKNOWN';
 } catch {return 'UNKNOWN';}
}

export type CorporateAction = { provider: 'Alpaca' | 'Longbridge'; type: string; raw: Record<string, unknown> };
/** Process-date range, not ex-date; return all pages or no partial result. */
export async function alpacaCorporateActions(key: string, secret: string, symbol: string, start: string, end: string, request: typeof fetch = fetch): Promise<ReferenceResult<CorporateAction[]>> {
 dates(start,end);
 if (!/^[A-Za-z0-9.\-]{1,32}$/.test(symbol)) throw new Error('Invalid symbol');
 if (!key || !secret) return {status:'NOT_CONFIGURED',data:null};
 try {
  const actions: CorporateAction[]=[]; const seen=new Set<string>(); let token: string | null=null;
  for (let page=0;page<100;page++) {
   const url=new URL('https://data.alpaca.markets/v1/corporate-actions');
   url.search=new URLSearchParams({symbols:symbol,start,end,region:'us',data_quality:'all',limit:'1000',...(token?{page_token:token}:{})}).toString();
   const res=await request(url,{headers:headers(key,secret)}); if(!res.ok)return {status:'UNAVAILABLE',data:null};
   const body:unknown=await res.json(); if(!record(body) || !record(body.corporate_actions))return {status:'INVALID_RESPONSE',data:null};
   for(const [type,items] of Object.entries(body.corporate_actions)) {
    if(!Array.isArray(items) || !items.every(record))return {status:'INVALID_RESPONSE',data:null};
    for(const raw of items) { const symbols=['symbol','old_symbol','new_symbol','source_symbol','acquirer_symbol','acquiree_symbol','alternate_symbol'].map(k=>raw[k]); if (!symbols.some(v=>typeof v==='string' && v.toUpperCase()===symbol.toUpperCase())) return {status:'INVALID_RESPONSE',data:null}; actions.push({provider:'Alpaca',type,raw}); }
   }
   const next=body.next_page_token;
   if(next==null || next==='')return {status:'OK',data:actions};
   if(typeof next!=='string' || seen.has(next))return {status:'INVALID_RESPONSE',data:null};
   seen.add(next); token=next;
  }
  return {status:'UNAVAILABLE',data:null};
 } catch {return {status:'UNAVAILABLE',data:null};}
}
export type LongbridgeActionsClient = (symbol: string, start: string, end: string) => Promise<{items: Record<string, unknown>[]}>;
export async function longbridgeCorporateActions(client: LongbridgeActionsClient | undefined, symbol: string, start: string, end: string): Promise<ReferenceResult<CorporateAction[]>> {
 dates(start,end); if (!/^[A-Za-z0-9.\-]{1,40}$/.test(symbol)) throw new Error('Invalid symbol');
 if(!client)return {status:'NOT_CONFIGURED',data:null};
 try { const result=await client(symbol,start,end); if(!record(result)||!Array.isArray(result.items)||!result.items.every(record))return {status:'INVALID_RESPONSE',data:null};
  return {status:'OK',data:result.items.map(raw=>({provider:'Longbridge',type:typeof raw.action==='string'?raw.action:'UNKNOWN',raw}))};
 } catch {return {status:'UNAVAILABLE',data:null};}
}


