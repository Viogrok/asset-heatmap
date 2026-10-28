# AKShare 本地桥接

这是自托管适配器，不是 AKShare 官方服务。仅绑定 `127.0.0.1`，不会自行开放公网、配置 TLS 或启动后台服务。运行前应确认东方财富及 AKShare 上游数据的使用与展示许可。当前白名单仅含项目内六只沪深上市 ETF；标的身份、交易所、币种全部匹配才返回数据。需要扩容时，须同步检查 `server.py` 和 `worker.py` 中白名单及上游代码、单位。

在本目录创建隔离环境并安装依赖（以下 `python` 应是已安装的 Python 3.12，可改为其完整路径）：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:AKSHARE_BRIDGE_TOKEN = '<至少32字符的随机密钥>'
.\.venv\Scripts\python.exe server.py
```

密钥只放在服务端进程环境，切勿写入代码或聊天。可选 `AKSHARE_BRIDGE_PORT`，默认 8765。项目本机环境另配置 `AKSHARE_GATEWAY_URL=http://127.0.0.1:8765`、`AKSHARE_GATEWAY_TOKEN` 为同一密钥。Sites Worker 无法访问本机 loopback；远程使用须另行提供双方可访问的 HTTPS 入口并评估认证、网络访问、日志、上游许可与服务运行环境。不要直接将此开发服务器暴露到公网。本任务没有部署或开放公网端口。

两个 POST 接口均需 `Authorization: Bearer <token>`，请求体为 `{ "instruments": [{ "assetId":"A:XSHG:ETF:510500", "symbol":"510500", "market":"A", "assetType":"ETF", "exchange":"XSHG", "currency":"CNY" }] }`。

- `/quotes` 返回 `{ "quotes": [...] }`，仅有允许且上游有价的标的。价格来自 `fund_etf_spot_em`；上游时间、延迟、成交量单位未核验，字段为 null，不能称为实时。上游失败时返回 502。
- `/nav` 一次仅接受一个白名单标的，返回 `{ "nav": { "assetId", "value", "date", "currency", "source", "fetched" } }`。单位净值通过 `fund_etf_fund_info_em` 取披露日期，数据与现有东方财富源同源，不是独立验证。此服务契约已作为可配置备用接入应用 `/api/nav`；生产仍需有可访问的 HTTPS 桥接服务。

行情缓存 60 秒，NAV 缓存 6 小时；最多 30 次请求/分钟、每次最多 50 个标的，单上游子进程超时 7 秒，同时最多一个上游请求。忙碌或上游失败返回 502，不使用旧值伪装新值；429 带 `Retry-After`。这些限制只在单进程内生效，重启清空，也不是面向公网的完整防护。客户端现有 8 秒超时与此设置匹配。

本机测试：`python -m unittest discover -s . -p test_server.py`。测试使用模拟上游，不能证明外网可用。2026-10-28 使用本机 Python 3.12 / AKShare 1.20.1 实际调用服务 worker 的 510500 NAV，返回日期 2026-10-27；ETF spot 此前连接失败，不能声明行情已接通。Worker 与应用部署的网络和 Python 环境另需实际验证。
