import type {Asset} from './model';import {disclosedNav,compareNavClose,verifiedCloseFallback,type FundNav} from './nav';import navSnapshot from './nav-snapshot.json';
export async function fetchFundNav(a:Asset):Promise<FundNav>{
 if(a.kind!=='ETF'||!a.tencent||!/^(sh|sz)\d{6}$/.test(a.tencent))throw Error('当前披露净值接口仅覆盖境内上市ETF');
 try{const r=await fetch('https://api.fund.eastmoney.com/f10/lsjz?fundCode='+a.symbol+'&pageIndex=1&pageSize=5',{headers:{Referer:'https://fundf10.eastmoney.com/'},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('净值源HTTP '+r.status);let nav=disclosedNav(await r.json(),a.currency,new Date().toISOString());try{const h=await fetch('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='+a.tencent+',day,,,20,',{signal:AbortSignal.timeout(10000)});if(h.ok)nav=compareNavClose(nav,await h.json(),a.tencent);}catch{}return verifiedCloseFallback(nav,(navSnapshot as Record<string,FundNav>)[a.id]);}catch(e){const previous=(navSnapshot as Record<string,FundNav>)[a.id];if(!previous)throw e;return {...previous,stale:true,source:previous.source+'（已核验备用披露快照，在线更新失败）'};}
}

