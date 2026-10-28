import os, json, time, threading, hmac, subprocess, sys, math
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from collections import deque
from datetime import datetime, timezone

# The allowlist binds every identity field, not just an attacker-controlled assetId.
ALLOW = {f'A:{ex}:ETF:{symbol}': {'symbol':symbol, 'market':'A', 'assetType':'ETF', 'exchange':ex, 'currency':'CNY'} for ex,symbol in [('XSHG','510500'),('XSHG','513130'),('XSHG','515180'),('XSHG','563220'),('XSHG','563360'),('XSHE','159545')]}
TOKEN = os.environ.get('AKSHARE_BRIDGE_TOKEN', '')
if len(TOKEN) < 32: raise SystemExit('AKSHARE_BRIDGE_TOKEN must contain at least 32 characters')
lock = threading.Lock(); calls = deque(); cache = {}; worker_lock = threading.Lock()
TTL = 60; NAV_TTL = 21600; TIMEOUT = 7

def worker(kind, symbol=''):
    if not worker_lock.acquire(blocking=False): raise RuntimeError('upstream busy')
    try:
        key = (kind,symbol); now=time.monotonic()
        if key in cache and now-cache[key][0] < (TTL if kind=='quotes' else NAV_TTL): return cache[key][1]
        proc=subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__),'worker.py'),kind,symbol],capture_output=True,timeout=TIMEOUT,check=True,env={**os.environ,'PYTHONIOENCODING':'utf-8'})
        result=json.loads(proc.stdout); cache[key]=(time.monotonic(),result); return result
    finally: worker_lock.release()

def allowed(row):
    if not isinstance(row,dict): return False
    asset_id=row.get('assetId')
    if not isinstance(asset_id,str): return False
    spec=ALLOW.get(asset_id)
    return bool(spec) and all(row.get(k)==v for k,v in spec.items())

class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup(); self.connection.settimeout(8)
    def log_message(self, format, *args): pass # never log tokens or raw input
    def reply(self, status, obj, headers=None):
        data=json.dumps(obj,ensure_ascii=False,allow_nan=False).encode('utf-8'); self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Cache-Control','no-store'); self.send_header('Content-Length',str(len(data)))
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(data)
    def do_POST(self):
        auth=self.headers.get('Authorization','')
        if not hmac.compare_digest(auth.encode('utf-8'), ('Bearer '+TOKEN).encode('utf-8')): return self.reply(401,{'error':'unauthorized'})
        if self.path not in ('/quotes','/nav'): return self.reply(404,{'error':'not found'})
        with lock:
            now=time.monotonic()
            while calls and now-calls[0]>=60: calls.popleft()
            if len(calls)>=30: return self.reply(429,{'error':'rate limited'},{'Retry-After':'60'})
            calls.append(now)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<1 or length>16384: raise ValueError()
            body=json.loads(self.rfile.read(length)); rows=body.get('instruments')
            if not isinstance(rows,list) or len(rows)>50 or not all(isinstance(x,dict) for x in rows): raise ValueError()
        except (ValueError,TypeError,AttributeError,json.JSONDecodeError): return self.reply(400,{'error':'invalid request'})
        selected=[r for r in rows if allowed(r)]
        try:
            if self.path=='/quotes':
                if not selected: return self.reply(200,{'quotes':[]})
                data=worker('quotes'); out=[]
                for row in selected:
                    quote=data.get(row['symbol'])
                    if quote: out.append({'assetId':row['assetId'],'currency':'CNY','providerSymbol':row['symbol'],**quote})
                return self.reply(200,{'quotes':out})
            if len(selected)!=1 or len(rows)!=1: return self.reply(400,{'error':'one allowlisted instrument required'})
            data=worker('nav',selected[0]['symbol'])
            return self.reply(200,{'nav':{'assetId':selected[0]['assetId'],**data}})
        except (subprocess.SubprocessError,ValueError,KeyError,OSError,RuntimeError): return self.reply(502,{'error':'upstream unavailable'})
    def do_GET(self): self.reply(405,{'error':'method not allowed'})

if __name__=='__main__':
    # Loopback only. HTTPS and access control must be arranged separately for remote usage.
    server=ThreadingHTTPServer(('127.0.0.1',int(os.environ.get('AKSHARE_BRIDGE_PORT','8765'))),Handler)
    server.daemon_threads=True; server.serve_forever()
