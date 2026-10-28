# CoinGecko 与 AKShare 接入核验

核验日期：2026-10-28（Asia/Shanghai）。本记录不含密钥或私人账本。

## CoinGecko

- [Demo 价格页](https://www.coingecko.com/en/api/pricing)显示免费 10,000 次/月、100 次/分钟、1 个 key、数据新鲜度从 60 秒起；展示数据需[署名](https://brand.coingecko.com/resources/attribution-guide)。具体许可按实际协议确认。
- 用户已确认条款并通过 Google 完成免费 Demo 注册。本轮浏览器控制已恢复，读取现有的一把 key，并保存为 Sites 服务端 secret `COINGECKO_DEMO_API_KEY`（环境修订 1）；没有重新生成、没有把明文写入源码或聊天。本机使用该 key 请求 `/coins/markets` 的 bitcoin/ethereum，HTTP200，返回市值、流通供应与源时间。发布后还需独立验证 Sites 出口。
- [官方 Keyless Public API](https://docs.coingecko.com/docs/keyless-public-api)包含 `/coins/markets`；本机 2026-10-28 无密钥请求 bitcoin 成功且有市值字段。官方注明约每 IP 5 次/分钟、动态限流、需署名，并不建议用于生产或定时轮询。本机一次成功不代表 Sites 出口可用；项目当前并未实现 keyless 回退。

## AKShare

- Python 3.12 隔离环境安装 AKShare 1.20.1；其本机目录位于系统临时目录 `asset-heatmap-akshare-check`，并非部署的桥接服务。Windows 的 `python` 命令指向商店别名，本机另有 Python 3.14；本次使用 Codex 附带 Python 3.12。
- `fund_etf_fund_info_em(fund="510500", start_date="20260101", end_date="20261231")` 本机成功，返回 195 条、最新净值日期为 2026-10-27。此接口数据来自东方财富，与现有 NAV 源同源，不能算独立交叉验证。数据以净值日期为准，不视为实时市价。[官方接口文档](https://akshare.akfamily.xyz/data/fund/fund_public.html)。
- `fund_etf_spot_em()` 本机请求失败，底层 `push2delay.eastmoney.com` 连接经现有代理后被远端关闭，未验证行情。未修改系统代理或分流规则，失败原因不能确定为账户或地区限制。
- 已增量提供 `services/akshare-bridge`，支持 Bearer、完整标的白名单、超时、缓存及限流。具体安装与契约见 [桥接说明](../services/akshare-bridge/README.md)。2026-10-28 本机实际调用桥接 worker 的 510500 NAV 成功，日期 2026-10-27；行情 spot 仍未验证成功。单进程限流与缓存不会在重启后保留。
- 桥接只绑定本机 loopback，未部署、未开放公网。Sites 不能访问本机 loopback，远程运行需要另行提供可访问的 HTTPS 服务和鉴权。桥接新增的 `/nav` 已作为境内 ETF NAV 的可配置备用接入应用路由。
- 港美基金：iShares [IWM 官方页面](https://www.ishares.com/us/products/239710/ishares-russell-2000-etf)明确提供带估值日期的 NAV；已实现发行人页面解析，2026-10-28 本机实取并解析出 2026-10-27 NAV 280.14 USD，页面结构变化或网络限制可导致失败。SPY、DIA、QQQ 和香港上市 ETF 尚未验证可可靠解析的公开数据接口，不能以交易价、指数或估算净值替代。实际使用、展示及再分发仍应核验发行人条款。项目中名称含港股的 ETF 在沪深上市，使用 CNY 的基金披露 NAV。

本轮桥接真实 HTTP 验证：仅临时监听随机 loopback 端口，未带 Bearer 的 `/nav` 返回401；带临时 token 的510500 `/nav` 返回200、CNY、净值日期2026-10-28；`/quotes` 上游失败返回502。测试后服务停止，token未保存、未开公网。IWM 已接入现有 `/api/nav?asset=IWM`，本机返回200；其他尚未支持的发行人NAV返回404。
