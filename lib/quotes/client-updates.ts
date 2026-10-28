import type {Quote} from '../model.ts';
export function mergeQuoteUpdate(previous:Record<string,Quote>,incoming:Record<string,Quote>,unavailable:string[]=[]):Record<string,Quote>{
 const next={...previous};for(const id of unavailable)delete next[id];
 for(const [id,q] of Object.entries(incoming||{})){if(!q||!Number.isFinite(q.price)||q.price<=0||!Number.isFinite(Date.parse(q.fetched)))continue;const old=next[id];if(!old||Date.parse(q.fetched)>=Date.parse(old.fetched))next[id]=q;}
 return next;
}
