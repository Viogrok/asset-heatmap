import {ProviderError} from './types.ts';
export async function request(ctx:{fetch:typeof fetch;now:()=>number},url:string,init:RequestInit={}){
 const r=await ctx.fetch(url,{...init,signal:AbortSignal.timeout(8000)});
 if(!r.ok){const after=r.headers.get('retry-after');const seconds=after?Number(after):NaN;const retry=Number.isFinite(seconds)?Math.max(1000,seconds*1000):after?Math.max(1000,Date.parse(after)-ctx.now()):undefined;
  throw new ProviderError(r.status===451?'REGION_RESTRICTED':r.status===429||r.status===418?'RATE_LIMIT':r.status===401||r.status===403?'AUTH_OR_ENTITLEMENT':`HTTP_${r.status}`,`行情源返回 HTTP ${r.status}`,retry);
 }return r;
}
export function bridgeUrl(value:string|undefined){if(!value)return null;const u=new URL(value);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw new ProviderError('CONFIGURATION','行情桥接仅允许HTTPS，开发环境可用loopback');return u.origin+u.pathname.replace(/\/$/,'');}
