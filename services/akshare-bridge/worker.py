import sys, json, math
from datetime import datetime, timedelta, timezone
import akshare as ak

def num(value):
    try:
        n=float(value)
        return n if math.isfinite(n) else None
    except (ValueError,TypeError): return None

kind,symbol=sys.argv[1:3]
if kind=='quotes':
    frame=ak.fund_etf_spot_em(); out={}
    for _,row in frame.iterrows():
        code=str(row.get('代码','')); price=num(row.get('最新价'))
        if code not in {'510500','513130','515180','563220','563360','159545'} or price is None or price<=0: continue
        # 成交量单位和上游延迟未验证；不推断时间或状态。
        out[code]={'lastPrice':price,'previousClose':None,'changePercent':num(row.get('涨跌幅')),'volume':None,'marketCap':None,'timestamp':None,'delaySeconds':None,'marketStatus':'UNKNOWN'}
    print(json.dumps(out,ensure_ascii=False,allow_nan=False))
elif kind=='nav':
    now=datetime.now(timezone.utc); start=(now-timedelta(days=60)).strftime('%Y%m%d'); end=now.strftime('%Y%m%d')
    frame=ak.fund_etf_fund_info_em(fund=symbol,start_date=start,end_date=end)
    rows=[]
    for _,row in frame.iterrows():
        date=str(row.get('净值日期',''))[:10]; value=num(row.get('单位净值'))
        try: datetime.strptime(date,'%Y-%m-%d')
        except ValueError: continue
        if value and value>0 and date<=end[:4]+'-'+end[4:6]+'-'+end[6:]: rows.append((date,value))
    if not rows: raise ValueError('no disclosed nav')
    date,value=max(rows)
    print(json.dumps({'value':value,'date':date,'currency':'CNY','source':'AKShare / 东方财富历史单位净值（基金披露值转引）','fetched':now.isoformat()},ensure_ascii=False))
else: raise ValueError('unsupported operation')
