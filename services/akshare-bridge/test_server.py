import os, json, threading, unittest, urllib.request, urllib.error
from unittest.mock import patch
os.environ['AKSHARE_BRIDGE_TOKEN']='x'*32
import server

class BridgeTest(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
  cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True); cls.thread.start()
 @classmethod
 def tearDownClass(cls): cls.http.shutdown(); cls.http.server_close(); cls.thread.join()
 def setUp(self): server.calls.clear(); server.cache.clear()
 def call(self,path,body,token='x'*32):
  req=urllib.request.Request('http://127.0.0.1:%d%s'%(self.http.server_port,path),data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
  try:
   with urllib.request.urlopen(req,timeout=10) as response: return response.status,json.load(response)
  except urllib.error.HTTPError as e: return e.code,json.load(e)
 def row(self): return {'assetId':'A:XSHG:ETF:510500','symbol':'510500','market':'A','assetType':'ETF','exchange':'XSHG','currency':'CNY'}
 def test_auth_and_whitelist(self):
  row=self.row(); self.assertEqual(self.call('/quotes',{'instruments':[row]},'bad')[0],401)
  row['currency']='USD'; self.assertEqual(self.call('/quotes',{'instruments':[row]})[1],{'quotes':[]})
 def test_quotes_and_nav_contract(self):
  row=self.row()
  with patch.object(server,'worker',return_value={'510500':{'lastPrice':1.2}}):
   status,body=self.call('/quotes',{'instruments':[row]}); self.assertEqual((status,body['quotes'][0]['assetId']),(200,row['assetId']))
  with patch.object(server,'worker',return_value={'value':1.5,'date':'2026-10-27','currency':'CNY'}):
   status,body=self.call('/nav',{'instruments':[row]}); self.assertEqual((status,body['nav']['date']),(200,'2026-10-27'))
 def test_limit(self):
  for _ in range(30): self.assertEqual(self.call('/quotes',{'instruments':[]})[0],200)
  self.assertEqual(self.call('/quotes',{'instruments':[]})[0],429)
 def test_worker_timeout_and_cache(self):
  from subprocess import CompletedProcess, TimeoutExpired
  with patch.object(server.subprocess,'run',return_value=CompletedProcess([],0,b'{}',b'')) as run:
   server.worker('quotes'); server.worker('quotes'); self.assertEqual(run.call_count,1); self.assertEqual(run.call_args.kwargs['timeout'],7)
  server.cache.clear()
  with patch.object(server.subprocess,'run',side_effect=TimeoutExpired('worker',7)):
   self.assertEqual(self.call('/quotes',{'instruments':[self.row()]})[0],502)
if __name__=='__main__': unittest.main()
