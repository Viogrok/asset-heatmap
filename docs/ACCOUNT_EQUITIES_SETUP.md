# 证券数据账户与能力核验

核验日期：2026-10-28。以下区分公开文档能力与账户实测；未创建券商账户、API 密钥或修改任何权限。

## 实测状态

- Alpaca 控制台显示登录页；注册页要求名字、姓氏、税务居民国、邮箱、密码及来源选项。当前没有用户提供的姓名、税务居民国或凭据，未提交注册。页面称创建 Trading API 账户；未提交，因此尚未确认注册后可选择的账户类型、地区资格或实际权限。
- Longbridge 开发者登录页提供手机验证码、密码、扫码及第三方登录；当前会话未登录，未核验是否已有 Longbridge 账户、OpenAPI 资格或具体行情权限。
- 没有真实凭据注入或报价实测。项目已有行情适配器，但日历、公司行为、港美 ETF NAV 尚无供应商接入。

## Alpaca Paper Only 最少配置路径

- [Alpaca 官方 Paper Trading](https://docs.alpaca.markets/us/docs/paper-trading)说明全球用户可通过邮箱注册免费 Paper Only，使用 IEX 行情，不要求开通实盘券商账户或入金。纸面账户不进行真实资金交易；实际注册资格及权限尚未验证。
- 官方文字将邮箱概括为注册条件，但本次实测注册页还要求名字、姓氏、税务居民国、邮箱、新密码和来源选项。前两项与税务居民国不能推断；新密码由用户自己设置。用户尚未接受条款，未提交注册。
- 注册成功并完成必要验证后，需在控制台取得 Paper API key/secret，并仅配置服务端 `ALPACA_API_KEY`、`ALPACA_API_SECRET` 与 `ALPACA_FEED=iex`；创建凭据涉及敏感访问，需行动时确认。之后用公开标的测试 Market Data，IEX 是单一交易所而非全美综合行情；不得声称已经测试成功。免费额度与权限参见 [Market Data API](https://docs.alpaca.markets/us/docs/about-market-data-api)。

## 官方文档可行路径

- [Longbridge 开通说明](https://open.longbridge.com/docs)：需完成账户开立与开发者验证。OpenAPI 和 App/Web 行情权限独立；有账户后按标的测试可用性。不得默认账户具有实时行情。凭据只存服务端；新建或授权敏感访问需在行动时确认。
- [Longbridge 交易日](https://open.longbridge.com/docs/market/trade-days)覆盖 US/HK/CN/SG，返回完整交易日与半日标识；单次区间不超过一个月，仅支持最近一年，须分段与缓存。不要将半日标识自行转换成未经核验的具体收市时间。[当日交易时段](https://open.longbridge.com/docs/market/trade-session)另行提供时间，生产需核验各市场及半日返回值。
- [Alpaca 日历](https://docs.alpaca.markets/us/v1.1/reference/getcalendar-1)文档描述美股 1970–2029 年交易日、开收市时间及提前收市。它不覆盖 A 股和港股，范围之后的日期不能假定可用。已实现只读适配器和路由；真实凭据及生产环境尚未验证。
- [Longbridge 公司行为](https://open.longbridge.com/docs/fundamental/fundamental/corporate-actions)提供标的历史公司行为；[Alpaca 公司行为](https://docs.alpaca.markets/us/reference/corporateactions-1)明确数据可能在宣布后延迟出现，默认排除部分不完整记录。[Alpaca 更新](https://docs.alpaca.markets/us/changelog/2026-06-03-market-data-9dddd18)描述 `us`、`non_us` 和 `all` 区域过滤；覆盖与免费账户权限未实测。无论何源均需核验公司行为和时效，不自动修改账本。
- 港美 ETF 的披露 NAV 需独立来源。例如 [iShares IVV 官方页面](https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf)显示每日 NAV 及日期；[港交所 ETF 说明](https://www.hkex.com.hk/-/media/HKEX-Market/Products/Securities/Exchange-Traded-Products/Launch/HKEX_ETF-Leaflet.pdf?la=en)指出 ETF 网站提供 NAV。不同发行人覆盖、自动化可用性、数据许可均需逐基金核验；该例不代表统一 API 或全面覆盖，ETF 市价不能充当 NAV。

## 后续操作

Alpaca 采用免费 Paper Only 路线，不申请实盘券商账户。用户提供或亲自输入姓名、税务居民国，亲自设置新密码并完成必要验证；接受法律条款须在提交时确认。新 API 密钥或其他敏感访问需行动时确认。Longbridge 仍需依其规则确认现有账户和开发者资格，此次不申请开户。仅在获得相应授权后配置服务端密钥并验证公开标的、市场权限和失败行为，并验证日历和公司行为接口，另行落实 NAV 来源。不要在聊天、客户端代码或日志中暴露凭据；不购买行情订阅或执行交易。


## 参考数据适配器（2026-10-28）

`lib/quotes/reference-equities.ts` 新增只读适配器，并通过 `/api/market-data/reference` 接入；未接入 UI 或现有报价状态：Alpaca 使用现有服务端 key/secret 请求 Paper 交易日历与 Market Data 公司行为；日历限定官方列出的 1970–2029 年，使用纽约 IANA 时区和供应商实际开收市时间。只按完整成功的查询推断休市；交易日常规时段之外保持 UNKNOWN，不假定盘前盘后状态。公司行为以 process date 查询，获取全部分页并保留供应商原始字段，`data_quality=all` 可能包含不完整记录，存在公告后延迟。它不会修改账本。没有凭据时返回 NOT_CONFIGURED，不发送请求。

Longbridge 适配器接受由服务端官方 SDK 或可信桥接实现的调用函数，分别返回文档所列交易日与半日列表及公司行为 items。按自然月分段，调用方仍需满足官方最近一年范围；半日与完整交易日仅确认是否交易，不推断开收市时刻。尚未安装或配置该 SDK/桥接，函数注入接口不是已经接通的网络服务。

本机无凭据直连探测 Alpaca Paper 日历与公司行为端点均返回 HTTP 401，表明端点可达但无法取得数据；没有进行账户授权或实盘操作。测试仅使用模拟响应，尚不能证明任何账户的权限、数据覆盖或生产可用性。


### 只读参考数据 API

登录用户可请求 `GET /api/market-data/reference?asset=AAPL&provider=alpaca&kind=calendar&start=2025-11-27&end=2025-11-28`，`asset` 必须存在于当前用户资产目录，且是实际美股股票或 ETF。`kind` 为 `calendar` 或 `corporate-actions`，日期为严格的 `YYYY-MM-DD`，包含首尾；日历最多 366 天，公司行为最多 31 天。公司行为时间范围按供应商 `process_date`，不是除权日。缺少凭据或 Longbridge 实际 SDK/桥接返回 HTTP 503 / `NOT_CONFIGURED`，不会返回伪造的空数据。

成功结果仅包含所请求的美股标的；日历是美股市场公开参考数据。共享 D1 按请求范围缓存日历 6 小时、公司行为 1 小时，并通过租约防止同时刷新；每一页先检查 Alpaca 共享预算，单次网络请求限时 8 秒，整个 HTTP 调用限时 20 秒。Alpaca Paper `/v2/calendar` 是交易 API 中的只读日历端点，本功能不调用订单或交易操作。现阶段测试为模拟数据，尚未用真实账户、真实 D1 路由或生产环境验收。


用户在本轮明确选择暂不注册 Alpaca，保留适配器。`ALPACA_TRADING_ENV=paper` 为默认日历环境；如以后配置的是实盘账户 key，需明确改成 `live`，仅选择相应只读 `/v2/calendar` 入口，不会下单。行情本身仍走 Market Data API；Paper/live key不能混用。
