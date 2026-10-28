import Decimal from 'decimal.js';
import type {Plan,Entry} from './model';
const scheduleKey=(s:string)=>Math.floor(Date.parse(s)/60000);
export const unitLabels={hour:'小时',day:'天',week:'周',month:'月'};
export function occurrenceAt(p:Plan,n:number){
 const start=Date.parse(p.start);
 if(p.unit!=='month')return new Date(start+n*p.every*({hour:3600000,day:86400000,week:604800000}[p.unit])).toISOString();
 const anchor=new Date(start+8*3600000),month=anchor.getUTCMonth()+n*p.every;
 const d=new Date(Date.UTC(anchor.getUTCFullYear(),month,1,anchor.getUTCHours(),anchor.getUTCMinutes(),anchor.getUTCSeconds()));
 d.setUTCDate(Math.min(anchor.getUTCDate(),new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));
 return new Date(d.getTime()-8*3600000).toISOString();
}
export function occurrenceIndex(p:Plan,time:number){
 const start=Date.parse(p.start);if(time<start)return -1;
 if(p.unit!=='month')return Math.floor((time-start)/(p.every*({hour:3600000,day:86400000,week:604800000}[p.unit])));
 const a=new Date(start+8*3600000),b=new Date(time+8*3600000);let n=Math.max(0,Math.floor(((b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth())/p.every));
 if(Date.parse(occurrenceAt(p,n))>time)n--;return n;
}
export function nextPlanTime(p:Plan,time=Date.now()):string|null{
 if(p.paused)return null;let i=Math.max(0,occurrenceIndex(p,time));
 if(Date.parse(occurrenceAt(p,i))<time)i++;
 const skips=new Set(p.skips.map(scheduleKey));
 for(let n=0;n<=p.skips.length;n++,i++){const value=occurrenceAt(p,i);if(!skips.has(scheduleKey(value)))return value;}return null;
}
export function planSummary(p:Plan,entries:Entry[],currency:string,time=Date.now()){
 const fills=entries.filter(e=>e.type==='buy'&&e.asset===p.asset&&e.plan===p.id).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
 const amount=(e:Entry)=>new Decimal(e.quantity).mul(e.price).plus(e.fee||0);
 const total=fills.reduce((n,e)=>n.plus(amount(e)),new Decimal(0));
 const latest=fills[0];const period=latest?.occurrence?fills.filter(e=>e.occurrence&&scheduleKey(e.occurrence)===scheduleKey(latest.occurrence!)):latest?[latest]:[];
 const actual=period.reduce((n,e)=>n.plus(amount(e)),new Decimal(0));
 const target=latest?.plannedAmount;const targetCurrency=latest?.plannedCurrency;
 const consistent=period.every(e=>e.plannedAmount===target&&e.plannedCurrency===targetCurrency);
 const delta=target&&targetCurrency===currency&&consistent?actual.minus(target).toString():null;
 const index=occurrenceIndex(p,time);let due=index>=0?occurrenceAt(p,index):null;
 if(p.paused||due&&p.resumeAt&&Date.parse(due)<Date.parse(p.resumeAt)||due&&p.skips.some(s=>scheduleKey(s)===scheduleKey(due!))||due&&fills.some(e=>e.occurrence&&scheduleKey(e.occurrence)===scheduleKey(due!)))due=null;
 return {count:fills.length,linkedPeriods:new Set(fills.filter(e=>e.occurrence).map(e=>scheduleKey(e.occurrence!))).size,total:total.toString(),currency,latest,actual:actual.toString(),target,targetCurrency,delta,due};
}

