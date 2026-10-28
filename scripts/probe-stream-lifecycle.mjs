// Local read-only integration check; never prints quotes, account data, or credentials.
const origin='http://127.0.0.1:5173',headers={Cookie:'__sites_local_auth=1'};
const report={connections:[],priceChanges:0},seen=new Map();
for(let n=0;n<2;n++){
 const start=Date.now(),abort=new AbortController(),timer=setTimeout(()=>abort.abort(),n?26000:70000);
 const c={status:0,frames:0,heartbeats:0,realtime:0,maxHeartbeatGapMs:0,elapsedMs:0,ended:false};let previous=0;
 try{const r=await fetch(origin+'/api/market-data/stream',{headers,signal:abort.signal});c.status=r.status;if(!r.ok)throw Error('HTTP');
  let buffer='';const decoder=new TextDecoder();for await(const bytes of r.body){buffer+=decoder.decode(bytes,{stream:true});let i;
   while((i=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,i);buffer=buffer.slice(i+2);const data=frame.split('\n').find(x=>x.startsWith('data: '));if(!data)continue;const j=JSON.parse(data.slice(6));c.frames++;
    if(frame.startsWith('event: heartbeat')){c.heartbeats++;if(previous)c.maxHeartbeatGapMs=Math.max(c.maxHeartbeatGapMs,Date.now()-previous);previous=Date.now();}
    for(const [id,q]of Object.entries(j.quotes||{})){if(q.standard?.quoteStatus==='REALTIME')c.realtime++;if(seen.has(id)&&seen.get(id)!==q.price)report.priceChanges++;seen.set(id,q.price);}
   }
  }c.ended=true;
 }catch(e){c.result=e.name==='AbortError'?'observation-window-ended':'request-failed';}finally{clearTimeout(timer);c.elapsedMs=Date.now()-start;report.connections.push(c);}
}
console.log(JSON.stringify(report));
