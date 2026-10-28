'use client';
import {useState} from 'react';
import {prepareBinanceImport, type BinanceImportPreview} from '../lib/binance-file-import';
import type {State} from '../lib/model';

export default function BinanceFileImport({state,onSave}:{state:State;onSave:(s:State)=>Promise<boolean>}) {
 const [preview,setPreview]=useState<BinanceImportPreview|null>(null);
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 async function read(file:File){setError('');setPreview(null);try{if(file.size>2000000)throw Error('文件超过 2 MB');setPreview(prepareBinanceImport(state,JSON.parse(await file.text())));}catch(e){setError(e instanceof Error?e.message:String(e));}}
 return <section className="panel"><h2>导入 Binance 余额与定投</h2><p>导入经核对的 JSON 快照。钱包总览与分账户明细只用于核对，不会重复相加；计划不会自动增加持仓。</p>
 <label className="file">选择 Binance 快照文件<input type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];if(file)void read(file);e.target.value='';}}/></label>
 {error&&<p role="alert" className="alert">{error}</p>}
 {preview&&<div><h3>导入预览</h3><p>新增或校准 {preview.balanceCount} 项余额；新增或更新 {preview.planCount} 个组合计划分项。</p>{preview.messages.map((m,i)=><p key={i}>{m}</p>)}<p>成本缺失的持仓不计算浮盈亏。未取得行情的资产保留数量并显示未估值。</p><div className="actions"><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);try{if(await onSave(preview.state))setPreview(null);}finally{setBusy(false);}}}>确认并导入</button><button disabled={busy} onClick={()=>setPreview(null)}>取消</button></div></div>}
 </section>;
}
