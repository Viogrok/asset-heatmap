import type {MarketStatus} from './types.ts';
export type TradingDay={date:string;timeZone:string;trading:boolean;regular:[string,string][];pre?:[string,string];post?:[string,string]};
export function tradingDay(value:unknown):TradingDay|undefined{
 const d=value as TradingDay;const pair=(v:unknown)=>Array.isArray(v)&&v.length===2&&v.every(x=>typeof x==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(x))&&v[0]<v[1];
 if(!d||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||typeof d.trading!=='boolean'||!Array.isArray(d.regular)||!d.regular.every(pair)||(d.pre&&!pair(d.pre))||(d.post&&!pair(d.post)))return;
 try{new Intl.DateTimeFormat('en',{timeZone:d.timeZone});return d;}catch{return;}
}
/** Calendar dates/early closes must come from an entitled provider, never a weekday guess. */
export function sessionAt(now:number,day:TradingDay|undefined,halted=false):MarketStatus{
 if(halted)return 'HALTED';if(!day)return 'UNKNOWN';
 const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:day.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now)).split(' ');
 if(parts[0]!==day.date)return 'UNKNOWN';if(!day.trading)return 'CLOSED';const t=parts[1];
 const inRange=(p:[string,string])=>t>=p[0]&&t<p[1];if(day.regular.some(inRange))return 'OPEN';if(day.pre&&inRange(day.pre))return 'PRE';if(day.post&&inRange(day.post))return 'POST';return 'CLOSED';
}
