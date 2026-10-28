import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIwmIssuerNav,fetchIssuerNav,parseBridgeNav,parseStateStreetNav,parseQqqIssuerNav,supportsIssuerNav,parseTrahkIssuerNav} from '../lib/quotes/nav-providers.ts';
const fund='https://www.ishares.com/us/products/239710/ishares-russell-2000-etf#fund';
const page=(p:any)=>`<script type="application/ld+json">${JSON.stringify({'@graph':[{about:{'@id':fund},additionalProperty:p}]})}</script>`;
const property={name:'NAV as of',value:'280.14',unitText:'USD',valueReference:{name:'As of Dates',value:'Oct 27, 2026'}};
test('reads only dated issuer NAV',()=>{const nav=parseIwmIssuerNav(page([property]),'2026-10-28T00:00:00Z');assert.equal(nav.value,280.14);assert.equal(nav.date,'2026-10-27');assert.equal(nav.currency,'USD');});
test('rejects price, invalid date, currency, ambiguous NAV',()=>{for(const p of [{...property,name:'Market Price'}, {...property,unitText:'HKD'}, {...property,valueReference:{...property.valueReference,value:'Feb 30, 2026'}}])assert.throws(()=>parseIwmIssuerNav(page([p]),'2026-10-28T00:00:00Z'));assert.throws(()=>parseIwmIssuerNav(page([property,property]),'2026-10-28T00:00:00Z'));});
test('unsupported symbol never requests upstream',async()=>{let called=false;await assert.rejects(fetchIssuerNav('NOPE',async()=>{called=true;throw Error();}));assert.equal(called,false);});
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

const asOf='2026-10-28T00:00:00Z';
function stateStreet(ticker:string,isin:string,nav:unknown){const data=JSON.stringify({attrs:{'fund-ticker':{value:ticker},isin:{value:isin},nav}}).replace(/&/g,'&amp;').replace(/"/g,'&#34;');return `<input type="hidden" id="fund-quick-info" value="${data}">`;}
test('State Street NAV is bound to fund identity, USD and valuation date',()=>{
 const nav={label:'NAV',value:'$769.72',asOfDateSimple:'Oct 27 2026'};
 const html=stateStreet('SPY','US78462F1030',nav);
 assert.equal(parseStateStreetNav(html,'SPY',asOf).value,769.72);
 assert.equal(parseStateStreetNav(stateStreet('DIA','US78467X1090',nav),'DIA',asOf).date,'2026-10-27');
 for(const text of [stateStreet('DIA','US78462F1030',nav),stateStreet('SPY','wrong',nav),stateStreet('SPY','US78462F1030',{...nav,label:'Market Price'}),stateStreet('SPY','US78462F1030',{...nav,value:'€769.72'}),stateStreet('SPY','US78462F1030',{...nav,value:'$7,6,9.72'}),stateStreet('SPY','US78462F1030',{...nav,asOfDateSimple:'Feb 30 2026'}),html+html])assert.throws(()=>parseStateStreetNav(text,'SPY',asOf));
});
test('QQQ requires CUSIP, USD, valid date and NAV rather than closing price',()=>{
 const row={cusip:'46090E103',currency:'USD',effectiveDate:'2026-10-27',nav:721.231317,closingPrice:721.25};
 assert.equal(parseQqqIssuerNav(row,asOf).value,721.231317);
 for(const invalid of [{...row,cusip:'wrong'},{...row,currency:'HKD'},{...row,effectiveDate:'2026-10-29'},{...row,effectiveDate:'2026-02-30'},{...row,nav:null}])assert.throws(()=>parseQqqIssuerNav(invalid,asOf));
 assert.equal(supportsIssuerNav('QQQ','美股','USD'),true);assert.equal(supportsIssuerNav('QQQ','港股','USD'),false);assert.equal(supportsIssuerNav('QQQ','美股','HKD'),false);
});
test('issuer URL is fixed and unsupported inputs never trigger request',async()=>{
 let requested='';const fake=async(input:RequestInfo|URL)=>{requested=String(input);return Response.json({cusip:'46090E103',currency:'USD',effectiveDate:'2026-10-27',nav:721.23});};
 assert.equal((await fetchIssuerNav('QQQ',fake,()=>new Date(asOf),'美股',{invescoLicensed:true})).value,721.23);
 assert.equal(new URL(requested).hostname,'dng-api.invesco.com');
 requested='';await assert.rejects(fetchIssuerNav('QQQ',fake,()=>new Date(asOf),'港股'));assert.equal(requested,'');
});

test('QQQ repeated access requires explicit publisher permission before any request',async()=>{
 let calls=0;const fake:typeof fetch=async()=>{calls++;throw Error('not expected');};
 await assert.rejects(fetchIssuerNav('QQQ',fake),/许可/);assert.equal(calls,0);
});

test('TraHK uses HKD 2800 official NAV with matching fund and disclosure dates',()=>{
 const row={Fund_code:2800,Class_currency:'HKD',Class_ISIN_code:'HK2800008867',Dealing_date:'2026-10-28'};
 const fund={Trust_no:'H02800',ISIN_code:'HK2800008867',Base_Currency:'HKD',FundUnitClass:[row]};
 const quote={isin:'HK2800008867',PrevDate:20261028,Nav:23.7644,IOPV:99};
 assert.equal(parseTrahkIssuerNav({Fund:fund},quote,asOf).value,23.7644);
 for(const bad of [{...quote,isin:'bad'},{...quote,PrevDate:20261027},{...quote,Nav:null}])assert.throws(()=>parseTrahkIssuerNav({Fund:fund},bad,asOf));
 for(const bad of [{...fund,Base_Currency:'USD'},{...fund,FundUnitClass:[{...row,Class_currency:'RMB'}]},{...fund,FundUnitClass:[row,row]}])assert.throws(()=>parseTrahkIssuerNav({Fund:bad},quote,asOf));
 assert.equal(supportsIssuerNav('02800','港股','HKD'),true);assert.equal(supportsIssuerNav('02800','港股','CNY'),false);
});
