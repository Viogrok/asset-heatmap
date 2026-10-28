# 行情接入层：检查、方案与配置

核验日期：2026-10-28。官方资料可能继续变更；文档中的“支持”与本机/生产的真实连通测试是三件事。

## 1. 原项目检查与增量范围

- 技术栈：Vinext / React 19 / TypeScript、Cloudflare Workers、Drizzle + D1；保留 OpenAlgo 热力图与现有账本。
- 原入口：`app/api/quotes/route.ts`，D1 `quote_cache` 每分钟缓存；`lib/market.ts` 混合腾讯、Yahoo、CoinGecko、Kraken适配及规模数据。
- 原推送：`hooks/use-kraken-live.ts` 在每个浏览器分别连接 Kraken/Coinbase，未做服务端统一订阅。
- 原数据：`Asset` 的内部 id、投资方向与交易所并不等价；`Quote` 仅含价格、涨跌、来源与两个时间。缺失统一可用状态、延迟、昨收、成交量及窗口枚举。
- 原问题：A股新增代码仅判断15前缀；Yahoo `chartPreviousClose` 可能是查询区间基准而非昨收；美股腾讯本地时间缺时区；没有分布式更新锁与供应商冷却；不能安全使用USDT价格计算USD成本浮盈亏。
- 生产环境变量检查时为空；没有读取或创建任何真实券商凭据。

新增 `lib/quotes/` 保存类型、资产身份、官方适配器、缓存、调度、汇率和服务器推送。`/api/quotes` 保留 quotes/errors/fx/scales；新增标准接口 `/api/market-data`、SSE和K线入口。NAV和规模仍由原模块负责。原hook文件名保留，内部改为同源EventSource；dashboard仅调整hook、连接文案和跨币种价格比较，不更换图表、组件结构、布局或记账方式。

## 2. 信源比较与最终顺序

| 市场/数据 | 主选 | 备用/补充 | 当前接入状态 |
|---|---|---|---|
| Crypto现货价格/24h/量 | Binance公共REST + Spot WS | OKX；Kraken USD；Coinbase USD | 已实现；USDT和USD分别保留，目录先核验现货及交易状态 |
| Crypto市值/元数据 | CoinGecko Demo | 无假造替代 | 需服务端Demo key，小时级缓存、月预算 |
| A股股票/ETF | Longbridge授权HTTP | AKShare授权桥接；保留腾讯兼容源 | 官方适配器实现，账户权限未配置；沪深京分开识别，不承诺北交所券商覆盖 |
| 港股股票/ETF | Longbridge授权HTTP | AKShare桥接（已知部分15分钟延迟）、腾讯/Yahoo兼容 | 实时权限必须按具体账户/标的核验 |
| 美股股票/ETF | Longbridge | Alpaca `iex`；AKShare桥接；腾讯/Yahoo兼容 | Alpaca与Longbridge凭据未配置 |
| 指数 | 显式指数映射；Longbridge仅在配置映射和账户允许后使用 | 腾讯/Yahoo独立指数代码 | 新增创业板指及NDX；不将QQQ或IXIC冒充NDX |
| ETF NAV | 原披露净值模块 | 原已核验披露快照，明确过期 | 境内上市ETF；香港/美国NAV未接通，不拿市价代替 |
| USD/CNY/HKD | Frankfurter日参考率 | 最近有效缓存，标STALE | 保留既有v1兼容接口，非实时成交汇率 |

故障顺序按资产能力过滤；配置、权限和地区拒绝均保留在标准报价 `failures`。一个标的的备用成功不代表整家供应商覆盖所有市场。bStocks仅以独立代币身份接入，不使用普通美股股价代替。

### Crypto官方条件

**Binance**：公共行情无需交易账户API key。WS ticker约每秒更新、滚动24小时；每连接最多1024 streams，入站控制消息上限5条/秒，连接24小时失效，20秒ping需pong。REST批量ticker 1–20 symbols权重2、21–100权重40；具体IP预算读exchangeInfo，遵守429/418与Retry-After。我们主动分批20个，统一请求和冷却；451进入24小时冷却，不尝试镜像、代理或其他区域域名规避。当前网络可访问性不代表Sites出口也被允许。官方：[WS](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md)、[REST](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md)、[市场数据](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints)。使用/展示需遵守所在地资格、平台条款与数据许可。

**OKX**：公共行情无key。Global官方2026-05-20推荐 `openapi.okx.com`，不是让受限用户换地区域名；账户地域须遵守指定接入。公共ticker 20请求/2秒/IP；产品目录20请求/2秒/IP+类型。WS连接3次/秒/IP，subscribe/unsubscribe/login合计480次/小时/连接；不足30秒闲时ping/pong。tickers最快100ms按事件，`open24h`与UTC自然日字段不同。官方：[API](https://www.okx.com/docs-v5/en/)、[变更](https://www.okx.com/docs-v5/log_en/)。[API协议§9.4](https://www.okx.com/en-ae/help/okx-api-agreement)限制公共行情的再分发/对外展示；本项目保持私人自用，公开或商业化需重新核验授权。

**CoinGecko Demo**：核验时官方定价页列100次/分钟、10,000次/月、数据新鲜度从60秒起、1个key。Demo使用 `x-cg-demo-api-key`，项目默认额外限制30次/分钟、8,000次/月，元数据至少缓存1小时。没有key返回NOT_CONFIGURED且不请求。Demo不包含商业权利；付费许可也有署名/再分发约束。[价格](https://www.coingecko.com/en/api/pricing)、[Demo API](https://docs.coingecko.com/demo/reference/simple-price)、[许可FAQ](https://support.coingecko.com/articles/1043089972-what-are-the-differences-between-commercial-and-custom-licenses)。

**Kraken/Coinbase**：保留现有已核验USD市场作为额外备用。Kraken REST的 `o` 是UTC自然日开盘，标UTC_DAY；其WS才提供滚动24小时变化。Coinbase为本交易所USD市场；均不假称Binance成交价。[Kraken REST](https://docs.kraken.com/api-reference/market-data/get-ticker-information)、[Kraken WS](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ticker)、[Coinbase WS](https://docs.cdp.coinbase.com/exchange/websocket-feed/channels)。

### 证券官方条件

**Longbridge**：需要OpenAPI资格和App Key/Secret/Access Token（或OAuth）；App/Web行情权限不能直接视为OpenAPI权限。总览列每账户1条行情长连接、最多500标的、10次/秒、并发≤5。官方不同页面关于免费港股LV1/Basic有冲突：总览写BMP约15分钟无推送且LV1另购，个别单项页写默认LV1；A股价格页也区分大陆IP实时/境外延迟。实现不采信“全部免费实时”，默认SNAPSHOT、延迟未知，账户逐标的验证后才配置延迟。

本适配器移植官方SDK HTTP签名，`POST https://openapi.longbridge.com/quote/quotes`；该路径为官方CLI当前HTTP shim，不是杜撰的/v1/quote。quote主对象只取常规价，盘前、盘后、夜盘子对象不混入昨收计算。WS是Protobuf协议，本版未伪装成JSON订阅。没有账户凭据所以未验证业务权限/报价。

来源：[总览](https://open.longbridge.com/docs/quote/overview)、[价格与权限](https://open.longbridge.com/pricing)、[quote字段](https://open.longbridge.com/docs/quote/pull/quote)、[状态枚举](https://open.longbridge.com/docs/quote/objects)、[官方CLI HTTP实现](https://github.com/longbridge/longbridge-terminal/blob/main/src/cli/quote_http/mod.rs)、[官方签名](https://github.com/longbridge/openapi/blob/main/rust/crates/httpclient/src/signature.rs)、[请求实现](https://github.com/longbridge/openapi/blob/main/rust/crates/httpclient/src/request.rs)。免费资格不代表允许商业再分发。

**Alpaca Basic**：美股股票/ETF的IEX单一交易所实时市场，非SIP综合市场；免费WS最多30 symbols，历史API 200次/分钟。本项目显式`feed=iex`，不访问交易接口；SIP/delayed_sip必须自行具备对应权限。无key不请求，401/403进入权限冷却，不猜测账户已获SIP。Snapshot昨收只取prevDailyBar，指数和基金NAV不适用。[订阅](https://docs.alpaca.markets/us/docs/about-market-data-api)、[IEX/SIP FAQ](https://docs.alpaca.markets/us/docs/market-data-faq)、[snapshot](https://docs.alpaca.markets/us/reference/stocksnapshotsingle)、[日历](https://docs.alpaca.markets/us/reference/legacycalendar)。账户/地区资格与数据再分发需按实际协议核验。

**AKShare**：Python开源库而非提供统一SLA的行情服务。沪深京/ETF与港美股使用不同第三方网页；港股stock_hk_spot_em明确15分钟延迟，新浪美股接口约15分钟。A股部分成交量单位是“手”，不得不经转换写成股。项目通过HTTPS+Bearer bridge消费已归一化数据；不在Worker执行Python、不裸露AKTools无鉴权接口、不绕过上游反爬。未知单位就写null。[股票](https://akshare.akfamily.xyz/data/stock/stock_quote.html)、[基金](https://akshare.akfamily.xyz/data/fund/fund_public.html)、[指数](https://akshare.akfamily.xyz/data/index/index.html)、[项目说明](https://akshare.akfamily.xyz/introduction.html)。官方研究用途说明不构成所有上游的商用再分发授权。

**Frankfurter**：免费无key，日参考率；v2已上线，v1 deprecated但继续可用。没有日/月配额承诺，但存在防滥用限流。项目保留v1以兼容已有USD基准转换，缓存一天；原始date、provider、receivedAt单独记录。[官方文档](https://frankfurter.dev/)。USDT不在法币参考率里，另由真实USDT/USD市场价换算。

## 3. 标准接口与身份

`GET /api/market-data?ids=BTC,510500,NDX`，参数使用原业务id，响应quotes使用全局assetId；不在目录中的资产先通过已有新增资产接口核验。接口始终检查Sites登录，所有Provider凭据仅服务端。

标准对象字段定义见 `lib/quotes/types.ts`，包含用户要求的assetId、symbol、name、market、assetType、exchange、currency、lastPrice、changePercent、previousClose、volume、marketCap、timestamp、receivedAt、provider、quoteStatus、delaySeconds、marketStatus，另有providerSymbol、quoteVolume、circulatingSupply、changeWindow、adjustment、warnings、failures。

- 全局ID包括实际上市市场、交易所、产品类型与代码；如A股股票000001与上证指数000001不相同。境内上市港股ETF的投资方向仍为港股，行情身份以实际沪深上市交易所为准。
- REALTIME只用于收到有效WS价格；REST为SNAPSHOT，已知延迟源为DELAYED，失败缓存STALE，无价UNAVAILABLE且lastPrice=null。REST抓取时间不会填进timestamp。
- `exchange`为此报价的实际市场，例如BINANCE、OKX、IEX；assetId仍是稳定产品身份。切源时一次替换价格、币种、涨跌窗口、时间、来源，并记录切换警告。
- `conversion.ts`提供十进制USD/CNY/HKD及有独立市场价的USDT换算；原UI的CNY/USD切换保留，未添加HKD设置控件。
- 股票涨跌用上一交易日收盘；加密的滚动24h与UTC_DAY明确枚举。previousClose不拿open24h充数。行情原价统一UNADJUSTED；不能拿复权K线核算ETF溢价。
- 拆股/分红/退市等公司行为不会被猜测为账本交易，也不在此模块自动改仓。授权公司行为或拆股修正数据尚未接入；跨除权日收益比较需要外部核验，不能据普通未复权价声称完整收益。
- `sessions.ts`能处理供应商提供的交易日、午休、盘前盘后、早收市与IANA时区/DST；无可靠日历保持UNKNOWN，不用“周一至周五”猜节假日。Longbridge明确停牌/熔断状态可映射HALTED。当前没有完整授权交易日历，不能承诺准确判定所有市场会话。

`GET /api/market-data/candles?asset=BTC&provider=binance&interval=1m&limit=100` 返回真实现货K线，参数白名单、最多300条。OKX日/周/月显式UTC版本；不支持的间隔或来源返回错误，不跨源默换区间。证券历史复权行情尚未开放此接口。

既有 `/api/nav?asset=510500` 保留独立NAV、估值日期、披露源时间；不是实时净值。ETF交易价、NAV、指数各使用独立资产/接口。港美ETF NAV没有已授权数据时明确未接入。

## 4. 推送、缓存和部署边界

浏览器只连接 `/api/market-data/stream`（同源SSE），不再独立连接交易所。D1租约选出一个公共上游采集者；其他请求读共享缓存。同实例按约1秒转发有效消息，持久缓存10秒一批；跨实例读到稍旧推送会标DELAYED并给出观察到的秒数。断流变STALE，绝不靠动画生成数字。地区拒绝冷却24小时，权限拒绝5分钟，网络错误指数退避；Retry-After优先。

上游先Binance，再OKX，再既有Kraken/Coinbase；只有已核验目录里的SPOT交易对才会订阅。OKX文本ping/pong、源连接超时、24小时前轮换、客户端隐藏/断网清理、租约失去后关闭连接均有处理。供应商主备不能绕开地域或账户许可。

现有Sites提供HTTP Worker和D1，未绑定独立Durable Object、常驻服务器或云调度。本版在至少一个页面连接期间由服务端统一采集；最后一页断开后不承诺继续采集。若要全天后台采集，应部署单例官方SDK collector / Durable Object，再接本接口；这不是已经启用的能力。未购买服务、未新建外部服务器、未更改站点私有范围。

预算：应用默认Crypto REST缓存10秒，证券30秒；每源另有保守分钟门限；CoinGecko默认8000/月。共享推送持久化改为默认40条/分钟，FIFO抽样并保留未写的最新值，避免日预算用尽后整天停止共享；全天上限约57600条，不含REST缓存等其他写入。实际D1读写额度取决于Sites/Cloudflare账户，不能保证全天多端都在免费额度内；触及安全门限会降级并提示。频率可降低，不能用提高刷新频率绕过供应商配额。

## 5. 服务端配置

### 2026-10-28 实时刷新修复

SSE 的每秒发送循环与 REST、缓存读写、连接建立、汇率更新分离。后台任务各自防重入，慢请求不会阻塞心跳。SSE 本身不重复执行全目录 REST 查询，证券继续由原页面的手动/分钟级轮询刷新；加密推送保持独立。正常 55 秒轮换先清理并释放租约再结束响应；异常断开由 Worker `waitUntil` 保持清理任务，失联租约最多 24 秒到期。客户端继续使用原生 EventSource 重连。

行情注册、缓存、刷新锁与资产规模读写已批量化，减少 D1 每次请求的查询次数。持久化按分钟预算公平抽样，保留待写入的最新报价，状态接口给出 `persistenceLimited`，原状态栏已显示限流及缓存故障提示。单页约每秒转发内存行情；跨实例抽样可能有数十秒延迟，逐报价如实降级。过期到不可用的报价从客户端移除，较旧帧不会覆盖已收到的新价。无效 K 线参数/不存在的交易对不污染全局故障冷却，成功的汇率/K线请求会重置故障计数。

Sites 支持 WebSockets；目前的证据是实现存在阻塞与清理问题，不能将未刷新归因于 Sites 不支持实时。本站保持私有；没有迁移至只能托管静态页面的 GitHub Pages。

见 `.env.example`，本机真实值放被Git忽略的`.dev.vars`；生产用Sites环境变量。不要把密钥写进hosting.json、浏览器localStorage或聊天。

- `LONGBRIDGE_APP_KEY` / `LONGBRIDGE_APP_SECRET` / `LONGBRIDGE_ACCESS_TOKEN`：官方legacy HTTP认证；区域前缀保留，data center按官方SDK选择。`LONGBRIDGE_SYMBOLS_JSON`可按全局id或业务id显式映射指数/北交所等待验证符号。
- `LONGBRIDGE_VERIFIED_DELAY_SECONDS`：只在实际权限验证后填写；空值为未知，不能为了显示实时填写0。
- `ALPACA_API_KEY` / `ALPACA_API_SECRET` / `ALPACA_FEED=iex`：只行情；sip/delayed_sip需要权限。
- `COINGECKO_DEMO_API_KEY`：身份明确的coin id；同ticker不自动映射。
- `LONGBRIDGE_GATEWAY_URL/TOKEN` 或 `AKSHARE_GATEWAY_URL/TOKEN`：可选SDK桥接，HTTPS，POST `/quotes` 接收 `{instruments:[{assetId,symbol,market,assetType,exchange,currency}]}`，返回 `{quotes:[{assetId,lastPrice,currency,previousClose,changePercent,volume,marketCap,timestamp,providerSymbol,delaySeconds,marketStatus}]}`。只接收请求过的assetId及相同原币种；缺字段不补造数据。桥接应使用官方SDK/有权访问的AKShare源并在服务端校验Bearer；不会自动安装或暴露桥接。
- `QUOTE_BINANCE_ENABLED=false`可按当前可访问资格关闭源；不是更换域名绕过451。`QUOTE_OKX_ENABLED`同理。`QUOTE_LEGACY_ENABLED=false`可停用无稳定承诺的兼容源。
- `QUOTE_POLL_SECONDS`最小5；Crypto TTL最小5秒，证券TTL最小10秒。手动模式不建立SSE。

新增目录标的无需持仓；已有观察列表和新增证券路径仍可用。自定义Crypto须有明确coin ID，`CRYPTO_SYMBOLS_JSON`可按全局assetId或业务id配置已经人工确认的基础币代码；随后仍必须通过交易所SPOT目录检查。未配置或未核验的ticker不会盲拼交易对；没有映射即UNAVAILABLE。

## 6. 迁移、验证与未完成事项

新增D1迁移 `0001_market_data.sql`（租约和预算表），不修改portfolios/真实账本。Sites发布时执行迁移；本地可按README用wrangler --local应用。原version=1 JSON备份不变。

验证记录见 `MARKET_DATA_VALIDATION.md`，严格区分fixture、真实本机HTTP/WS、生产环境。真实私人账本不用于fixture、不进Git。

仍需账户或外部条件：Longbridge行情资格；用户暂不注册的Alpaca权限；AKShare生产HTTPS桥接；完整已授权日历/公司行为/证券复权数据；IWM之外的港美ETF NAV；全天常驻采集及各地区的生产连通与许可。CoinGecko key已配置为服务端secret。没有凭据的适配器只表示实现和配置就绪，不表示已接通。

## 本轮新增接口与源码同步

`/api/nav?asset=IWM` 提供 iShares 明确披露的每日NAV与日期，和ETF市价独立；国内ETF仍保持原接口，并可通过AKShare `/nav`备用。其他港美ETF没有可靠披露源时返回404。NAV及规模缓存改用规范资产标识，拒绝自定义代码与源ticker错配，过往不含可靠身份的legacy-ID缓存不再迁移。

`/api/market-data/reference` 提供只读交易日历/公司行为，见 [账户与参考数据](ACCOUNT_EQUITIES_SETUP.md)。没有账户时返回NOT_CONFIGURED，代码接口完整不等于上游业务数据已接通。日历不会按工作日猜假期，公司行为不会自动修改账本。

GitHub私有仓库为 https://github.com/Viogrok/asset-heatmap ，同步方式见README；Sites继续托管动态服务。
