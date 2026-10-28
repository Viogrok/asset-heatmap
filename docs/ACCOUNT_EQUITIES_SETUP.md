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
- [Alpaca 日历](https://docs.alpaca.markets/us/v1.1/reference/getcalendar-1)文档描述美股 1970–2029 年交易日、开收市时间及提前收市。它不覆盖 A 股和港股，范围之后的日期不能假定可用。项目尚未实现或测试该接口。
- [Longbridge 公司行为](https://open.longbridge.com/docs/fundamental/fundamental/corporate-actions)提供标的历史公司行为；[Alpaca 公司行为](https://docs.alpaca.markets/us/reference/corporateactions-1)明确数据可能在宣布后延迟出现，默认排除部分不完整记录。[Alpaca 更新](https://docs.alpaca.markets/us/changelog/2026-06-03-market-data-9dddd18)描述 `us`、`non_us` 和 `all` 区域过滤；覆盖与免费账户权限未实测。无论何源均需核验公司行为和时效，不自动修改账本。
- 港美 ETF 的披露 NAV 需独立来源。例如 [iShares IVV 官方页面](https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf)显示每日 NAV 及日期；[港交所 ETF 说明](https://www.hkex.com.hk/-/media/HKEX-Market/Products/Securities/Exchange-Traded-Products/Launch/HKEX_ETF-Leaflet.pdf?la=en)指出 ETF 网站提供 NAV。不同发行人覆盖、自动化可用性、数据许可均需逐基金核验；该例不代表统一 API 或全面覆盖，ETF 市价不能充当 NAV。

## 后续操作

Alpaca 采用免费 Paper Only 路线，不申请实盘券商账户。用户提供或亲自输入姓名、税务居民国，亲自设置新密码并完成必要验证；接受法律条款须在提交时确认。新 API 密钥或其他敏感访问需行动时确认。Longbridge 仍需依其规则确认现有账户和开发者资格，此次不申请开户。仅在获得相应授权后配置服务端密钥并验证公开标的、市场权限和失败行为，再实现日历、公司行为和 NAV 接口。不要在聊天、客户端代码或日志中暴露凭据；不购买行情订阅或执行交易。

