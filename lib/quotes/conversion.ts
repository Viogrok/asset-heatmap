import type {Asset,Quote} from '../model.ts';
import Decimal from 'decimal.js';
export function convertAmount(value:string,from:string,to:string,rates:Record<string,number>):string|null{
 try{const amount=new Decimal(value);if(!amount.isFinite())return null;if(from===to)return amount.toString();if(!(rates[from]>0)||!(rates[to]>0))return null;return amount.div(rates[from]).mul(rates[to]).toString();}catch{return null;}
}
/** Convert a market quote to the cost-basis currency; never silently assume USDT=USD. */
export function priceForCost(a:Asset,q:Quote|undefined,fx:{rates?:Record<string,number>}|null|undefined):number|null{
 if(!q)return null;const result=convertAmount(String(q.price),q.currency,a.currency,fx?.rates||{});return result===null?null:Number(result);
}
