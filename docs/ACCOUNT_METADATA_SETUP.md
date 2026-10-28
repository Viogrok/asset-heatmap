# CoinGecko、AKShare 与发行人 NAV

核验日期：2026-10-28（Asia/Shanghai）。不含密钥、私人账本或用户余额。

## CoinGecko：已配置并验证

- 免费 Demo 账户及一把 key 已按用户确认创建，服务端配置名 `COINGECKO_DEMO_API_KEY`，Sites 环境修订1；查询结果仅显示 secret 掩码，源码和客户端包均不包含密钥。
- 本机带 key 的 bitcoin/ethereum markets 请求 HTTP200；生产已取得 BTC/ETH/TRX 的市值、流通供应和源更新时间。它是 USD 聚合参考数据，不是交易所逐笔推送。
- 官方核验条件：10,000次/月、100次/分钟、一个Demo key、数据新鲜度从60秒起。应用另限8000次/月、元数据缓存一小时。来源：[定价](https://www.coingecko.com/en/api/pricing)、[署名要求](https://brand.coingecko.com/resources/attribution-guide)。没有使用不适合持续轮询的 keyless API 作为生产替代。

## AKShare：本机桥接已实现，生产桥接未部署

- `services/akshare-bridge` 提供 `/quotes` 与独立 `/nav`，使用Bearer、固定标的身份白名单、7秒上游子进程超时、单并发、缓存及限流。仅监听loopback，不暴露公网。安装说明见[桥接 README](../services/akshare-bridge/README.md)。
- 本机 Python3.12 / AKShare1.20.1 真正启动临时HTTP服务：未鉴权NAV返回401；带临时token的510500 NAV返回200，CNY、净值日期2026-10-28；spot行情返回502，不声称行情已接通。服务测试后停止，临时token未保存。
- NAV数据源是东方财富历史单位净值，与原应用同源，不能算独立交叉验证。上游可能限流或变动。[AKShare基金文档](https://akshare.akfamily.xyz/data/fund/fund_public.html)。
- 应用已消费该桥接契约，支持 `AKSHARE_GATEWAY_URL` / `AKSHARE_GATEWAY_TOKEN` 和NAV备用；Sites无法访问本机loopback。尚无已部署的HTTPS远程服务，没有购买服务器或开放端口。

## 默认可接入的发行人 NAV

| 标的 | 精确来源 | 本机披露日期 | 币种 |
|---|---|---|---|
| IWM | iShares基金页的明确NAV结构化数据 | 2026-10-27 | USD |
| SPY / DIA | State Street基金页，ticker、ISIN、NAV与日期绑定 | 2026-10-27 | USD |
| 港股2800 | 盈富基金官网配置的HSBC公开基金资料及ETF资料，ISIN、港元柜台与两份日期交叉检查 | 2026-10-28 | HKD |

这些真实请求在本机成功；生产连通必须分开验证。所有值均是披露NAV，日期随源保存，不当实时净值、收盘价或指数点位；2800的IOPV从未用于代替NAV。

接口保持 `/api/nav?asset=<目录ID>`。固定公开参考项 `/api/nav?asset=HK:02800` 可观察未持有的盈富基金，仍要求登录，不创建持仓、自选或UI目录记录。其他未映射基金返回404，不能把以上白名单称为全市场覆盖。

精确发现页面：
- [IWM](https://www.ishares.com/us/products/239710/ishares-russell-2000-etf)
- [SPY](https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-sp-500-etf-trust-spy)、[DIA](https://www.ssga.com/us/en/individual/etfs/state-street-spdr-dow-jones-industrial-average-etf-trust-dia)
- [盈富基金资料](https://www.trahk.com.hk/zh-hk/trahk-fund/fund-information/)

## QQQ：已实现，默认不自动请求

[QQQ官方基金页](https://www.invesco.com/us/en/financial-products/etfs/invesco-qqq-trust-series-1.html)公开组件配置可指向价格接口；一次本机可行性探测取得CUSIP、USD、NAV和日期，NAV与closingPrice分字段。

但[Invesco使用条款](https://www.invesco.com/us/en/resources/terms-of-use.html)第10节限制未经许可的重复自动访问和数据抽取。公开可访问与HTTP200不等于自动使用许可。QQQ NAV生产默认返回503 / `AUTHORIZATION_REQUIRED`，不发请求，也不会从缓存伪装接通。解析器与mock测试保留，市场报价仍由现有行情源提供。

`INVESCO_NAV_LICENSE_CONFIRMED=false` 为默认；仅取得发行人针对自动访问的许可后才可设置true。用户接受网页条款本身不等于取得该许可。本轮没有启用此标记。

[盈富基金条款](https://www.trahk.com.hk/en-hk/trahk-fund/termsandconditions/)限制商业和公开用途；本项目保持owner-private个人参考。任何公开或商业再分发需另核授权。发行人公开页面和前端接口无稳定SLA，改版、限流或地区限制可能使请求失败；失败明确返回不可用，不补造数据。
