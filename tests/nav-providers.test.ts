import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIwmIssuerNav,fetchIssuerNav,parseBridgeNav} from '../lib/quotes/nav-providers.ts';
const fund='https://www.ishares.com/us/products/239710/ishares-russell-2000-etf#fund';
const page=(p:any)=>`<script type="application/ld+json">${JSON.stringify({'@graph':[{about:{'@id':fund},additionalProperty:p}]})}</script>`;
const property={name:'NAV as of',value:'280.14',unitText:'USD',valueReference:{name:'As of Dates',value:'Oct 27, 2026'}};
test('reads only dated issuer NAV',()=>{const nav=parseIwmIssuerNav(page([property]),'2026-10-28T00:00:00Z');assert.equal(nav.value,280.14);assert.equal(nav.date,'2026-10-27');assert.equal(nav.currency,'USD');});
test('rejects price, invalid date, currency, ambiguous NAV',()=>{for(const p of [{...property,name:'Market Price'}, {...property,unitText:'HKD'}, {...property,valueReference:{...property.valueReference,value:'Feb 30, 2026'}}])assert.throws(()=>parseIwmIssuerNav(page([p]),'2026-10-28T00:00:00Z'));assert.throws(()=>parseIwmIssuerNav(page([property,property]),'2026-10-28T00:00:00Z'));});
test('unsupported symbol never requests upstream',async()=>{let called=false;await assert.rejects(fetchIssuerNav('SPY',async()=>{called=true;throw Error();}));assert.equal(called,false);});
test('桥接净值必须匹配标的身份、币种及不晚于今天的披露日期',()=>{
 const assetId='A:XSHG:ETF:510500',now=Date.parse('2026-10-28T00:00:00Z');
 const nav={assetId,value:6.75,date:'2026-10-27',currency:'CNY',source:'AKShare披露净值',fetched:'2026-10-28T00:00:00Z'};
 assert.deepEqual(parseBridgeNav({nav},assetId,'CNY',now),{value:6.75,date:'2026-10-27',currency:'CNY',source:nav.source,fetched:nav.fetched});
 for(const invalid of [
  {...nav,assetId:'A:XSHE:ETF:510500'},
  {...nav,currency:'USD'},
  {...nav,date:'2026-10-29'},
  {...nav,date:'2026-02-30'},
  {...nav,value:-1}
 ])assert.throws(()=>parseBridgeNav({nav:invalid},assetId,'CNY',now));
});
