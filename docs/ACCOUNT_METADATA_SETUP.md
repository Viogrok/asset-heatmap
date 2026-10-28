# CoinGecko 与 AKShare 接入核验

核验日期：2026-10-28（Asia/Shanghai）。本记录不含密钥或私人账本。

## CoinGecko

- [Demo 价格页](https://www.coingecko.com/en/api/pricing)显示免费 10,000 次/月、100 次/分钟、1 个 key、数据新鲜度从 60 秒起；展示数据需[署名](https://brand.coingecko.com/resources/attribution-guide)。具体许可按实际协议确认。
- 用户已确认条款并通过 Google 登录完成免费 Demo 注册，又确认生成并配置一把 key。浏览器已完成 Create API Key，停留在复制密钥步骤。恢复工作后，工具报告“Local browser use is disabled in Work settings”，原浏览器会话无法读取；没有再次生成 key。2026-10-28 再次检查 Sites 环境变量仍为空，`COINGECKO_DEMO_API_KEY` 尚未配置，也未完成带 key 的生产验证。恢复浏览器控制后应读取已有 key，并直接保存为服务端 secret，不能把 key 写进聊天、日志或源码。
- [官方 Keyless Public API](https://docs.coingecko.com/docs/keyless-public-api)包含 `/coins/markets`；本机 2026-10-28 无密钥请求 bitcoin 成功且有市值字段。官方注明约每 IP 5 次/分钟、动态限流、需署名，并不建议用于生产或定时轮询。本机一次成功不代表 Sites 出口可用；项目当前并未实现 keyless 回退。

## AKShare

- Python 3.12 隔离环境安装 AKShare 1.20.1；其本机目录位于系统临时目录 `asset-heatmap-akshare-check`，并非部署的桥接服务。Windows 的 `python` 命令指向商店别名，本机另有 Python 3.14；本次使用 Codex 附带 Python 3.12。
- `fund_etf_fund_info_em(fund="510500", start_date="20260101", end_date="20261231")` 本机成功，返回 195 条、最新净值日期为 2026-10-27。此接口数据来自东方财富，与现有 NAV 源同源，不能算独立交叉验证。数据以净值日期为准，不视为实时市价。[官方接口文档](https://akshare.akfamily.xyz/data/fund/fund_public.html)。
- `fund_etf_spot_em()` 本机请求失败，底层 `push2delay.eastmoney.com` 连接经现有代理后被远端关闭，未验证行情。未修改系统代理或分流规则，失败原因不能确定为账户或地区限制。
- 当前项目只实现消费端：`AKSHARE_GATEWAY_URL` 与 `AKSHARE_GATEWAY_TOKEN` 两项均需要服务端配置。桥接应接受 `POST /quotes`、Bearer 鉴权、明确白名单与超时/限流，返回请求标的的币种、价格、日期、已知延迟及可信单位；缺失值为空，不使用估计值。应同时验证上游许可。详细契约见 `MARKET_DATA.md`。
- 本机 Python 可运行不等于 Sites Worker 可访问：Sites 无法访问本机 loopback，需有已授权且 Sites 可访问的 HTTPS 服务及鉴权；目前没有该服务，未开公网端口、未购买服务器、未部署桥接。当前 `/quotes` 契约也不传输基金净值，若要通过桥接提供 NAV 需另行设计受鉴权的独立 NAV 契约及日期和缓存规则。

