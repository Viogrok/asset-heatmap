'use client';
import {useEffect,useState,type Dispatch,type SetStateAction} from 'react';
import type {Asset,Quote} from '../lib/model';
import {mergeQuoteUpdate} from '../lib/quotes/client-updates';

/** Kept under the original hook name to avoid component changes; now same-origin SSE only. */
export function useKrakenLive(setQuotes:Dispatch<SetStateAction<Record<string,Quote>>>,enabled:boolean,assets:Asset[],onFx?:(fx:any)=>void){
 const [status,setStatus]=useState<'disabled'|'connecting'|'binance'|'okx'|'kraken'|'coinbase'|'fallback'>('disabled');
 useEffect(()=>{
  if(!enabled){setStatus('disabled');return;}
  let stream:EventSource|undefined,disposed=false,timer:ReturnType<typeof setTimeout>|undefined,watchdog:ReturnType<typeof setTimeout>|undefined,attempt=0;
  const stale=()=>setQuotes(old=>Object.fromEntries(Object.entries(old).map(([id,q])=>[id,q.standard?.quoteStatus==='REALTIME'?{...q,stale:true,standard:{...q.standard,quoteStatus:'STALE' as const}}:q])));
  const disconnect=()=>{if(timer)clearTimeout(timer);if(watchdog)clearTimeout(watchdog);stream?.close();stream=undefined;};
  const connect=()=>{
   if(disposed||document.visibilityState!=='visible'||!navigator.onLine||stream)return;setStatus('connecting');
   const s=new EventSource('/api/market-data/stream');stream=s;
   const arm=()=>{if(watchdog)clearTimeout(watchdog);watchdog=setTimeout(()=>{disconnect();stale();setStatus('fallback');if(!disposed)timer=setTimeout(connect,Math.min(60000,3000*2**Math.min(attempt++,5)));},75000);};arm();
   s.addEventListener('quotes',e=>{try{const j=JSON.parse((e as MessageEvent).data);if(j.quotes||j.unavailable)setQuotes(old=>mergeQuoteUpdate(old,j.quotes||{},j.unavailable||[]));if(j.fx)onFx?.(j.fx);attempt=0;arm();}catch{}});
   s.addEventListener('status',e=>{try{const j=JSON.parse((e as MessageEvent).data);setStatus(j.status==='live'&&['binance','okx','kraken','coinbase'].includes(j.provider)?j.provider:j.status==='connecting'?'connecting':'fallback');arm();}catch{}});
   s.addEventListener('heartbeat',arm);s.onerror=()=>{setStatus('fallback');stale();};
  };
  const visibility=()=>{if(document.visibilityState==='visible'&&navigator.onLine)connect();else{disconnect();stale();setStatus('fallback');}};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('online',visibility);window.addEventListener('offline',visibility);connect();
  return()=>{disposed=true;disconnect();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('online',visibility);window.removeEventListener('offline',visibility);};
 },[setQuotes,enabled,assets,onFx]);return status;
}
