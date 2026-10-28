// Reads test credentials from hidden stdin only; prints public coverage/status, never prices or secrets.
let input='';if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');
process.stderr.write('Ready for market-data probe JSON on stdin (input is hidden).\n');
process.stdin.on('data',async chunk=>{
 if(chunk.includes('\u0003'))process.exit(130);input+=chunk;if(!/[\r\n]/.test(input))return;if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();
 try{const options=JSON.parse(input.trim());input='';const origin=new URL(options.origin).origin;
  if(new URL(origin).protocol!=='https:'&&!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('HTTPS required');
  const headers={};if(options.token)headers['OAI-Sites-Authorization']='Bearer '+options.token;
  if(options.local===true){if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('Local auth is loopback only');headers.Cookie='__sites_local_auth=1';}
  const report={checkedAt:new Date().toISOString(),origin,checks:[]};
  for(const path of ['/api/market-data?ids=BTC,ETH,TRX,000001,399006,HSI,HSTECH,SPX,NDX,DJI','/api/market-data/candles?asset=BTC&provider=binance&interval=1m&limit=3','/api/market-data/candles?asset=BTC&provider=okx&interval=1m&limit=3']){
   try{const r=await fetch(origin+path,{headers,signal:AbortSignal.timeout(90000)});if(!r.headers.get('content-type')?.includes('application/json')){report.checks.push({path,status:r.status,json:false});continue;}
    const j=await r.json();report.checks.push({path,status:r.status,error:j.error,code:j.code,quotes:Object.values(j.quotes||{}).map(q=>({symbol:q.symbol,provider:q.provider,currency:q.currency,status:q.quoteStatus,hasPrice:q.lastPrice>0,hasSourceTime:!!q.timestamp,failures:q.failures?.map(f=>f.provider+':'+f.code)})),fx:!!j.fx,candles:j.candles?.length});
   }catch{report.checks.push({path,error:'NETWORK_OR_TIMEOUT'});}
  }
  if(options.stream){let events=0,real=0,statuses=new Set();const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),35000);
   try{const r=await fetch(origin+'/api/market-data/stream',{headers,signal:abort.signal});if(r.headers.get('content-type')?.includes('text/event-stream')){let buffer='';for await(const chunk of r.body){buffer+=new TextDecoder().decode(chunk);let i;while((i=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,i);buffer=buffer.slice(i+2);const text=frame.split('\n').find(x=>x.startsWith('data: '));if(!text)continue;const value=JSON.parse(text.slice(6));if(frame.startsWith('event: status'))statuses.add(value.status+':'+value.provider);if(value.quotes){events++;real+=Object.values(value.quotes).filter(q=>q.standard?.quoteStatus==='REALTIME').length;}}}}else statuses.add('HTTP_'+r.status);
   }catch{}finally{clearTimeout(timer);}report.stream={events,realtimeObjects:real,statuses:[...statuses]};
  }
  console.log(JSON.stringify(report));process.exit(0);
 }catch{console.error('Probe failed: invalid input or unavailable runtime');process.exit(1);}
});
process.stdin.resume();
