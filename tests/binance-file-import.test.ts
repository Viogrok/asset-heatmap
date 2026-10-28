import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareBinanceImport} from '../lib/binance-file-import.ts';
import {initial, positions, type Entry} from '../lib/model.ts';

const stamp='2026-10-27T10:00:00Z';
const old:Entry={id:'binance-snapshot:old:BTC',asset:'BTC',type:'opening',quantity:'1',price:'10',fee:'0',date:'2026-10-26T10:00:00Z',note:'快照'};
const file={format:'binance-account-import-v1',capturedAt:stamp,coverage:['spot','simple_earn_flexible'],complete:false,balances:[{source:'spot',positionId:'BTC',symbol:'BTC',quantity:'0.5'},{source:'simple_earn_flexible',positionId:'BTC001',symbol:'BTC',quantity:'0.7'},{source:'simple_earn_flexible',positionId:'BTC001',symbol:'BTC',quantity:'0.7'}],overviewVerified:true,overviewComplete:false,overviewTotals:[{symbol:'BTC',quantity:'1.2'}]};

test('总览用于逐币校准，不重复叠加明细，重复导入不增仓',()=>{
 const s={...initial(),entries:[old]};const first=prepareBinanceImport(s,file);
 assert.equal(first.balanceCount,1);assert.equal(first.state.entries.length,2);assert.equal(positions(first.state.entries).BTC.quantity,'1.2');
 assert.equal(positions(first.state.entries).BTC.costKnown,false);assert.ok(first.state.entries.some(e=>e.id===old.id));
 const second=prepareBinanceImport(first.state,file);assert.equal(second.balanceCount,0);assert.equal(second.state.entries.length,2);assert.equal(positions(second.state.entries).BTC.quantity,'1.2');
});
test('未核验总览的部分范围不会覆盖原持仓，也不会删除缺失资产',()=>{
 const s={...initial(),entries:[old]};const result=prepareBinanceImport(s,{...file,overviewVerified:false,overviewTotals:undefined,balances:[{source:'simple_earn_flexible',positionId:'eth',symbol:'ETH',quantity:'3'}]});
 assert.equal(positions(result.state.entries).BTC.quantity,'1');assert.equal(positions(result.state.entries).ETH.quantity,'3');assert.equal(result.state.entries.length,2);
});
test('合并快照遇到其他来源的同币种记录时拒绝覆盖',()=>{
 const s={...initial(),entries:[{...old,id:'manual'}]};assert.throws(()=>prepareBinanceImport(s,file),/无法安全分离账户/);
});
test('组合计划保留比例和来源时间，时区未核实时不推算、不创造成交',()=>{
 const p={sourceId:'local:abc',sourceIdOrigin:'local',name:'组合',amount:'100',currency:'USDT',every:12,unit:'hour',timeZoneVerified:false,nextText:'2026-10-28 08:00',paused:false,allocations:[{symbol:'BTC',percent:'60'},{symbol:'ETH',percent:'40'}]};
 const result=prepareBinanceImport(initial(),{...file,balances:[],overviewVerified:false,overviewTotals:undefined,plans:[p]});
 assert.equal(result.state.entries.length,0);assert.equal(result.state.plans.length,2);assert.deepEqual(result.state.plans.map(x=>x.amount),['60','40']);
 assert.ok(result.state.plans.every(x=>x.paused&&x.sourceTimeVerified===false&&x.sourceNextText===p.nextText));
});
