# 行情与参考数据独立测试报告

检查日期：2026-10-28（Asia/Shanghai）

## 自动检查

- `node --experimental-strip-types --test tests/*.test.ts`：81/81 通过。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- 桥接服务单测：Python 3.12.14，`python -m unittest discover -s . -p test_server.py -v`，4/4 通过。用例模拟 worker，不调用 AKShare 上游。
- 本轮没有运行 lint。此前单独的基线 lint 记录为 69 errors、10 warnings；该结果不代表本轮后的 lint 状态。

## 主要覆盖

- SSE 慢任务隔离、heartbeat、55 秒轮换与租约释放、客户端取消、报价年龄降级、旧帧拒绝和 unavailable 清理。
- Collector 注册资产超过 512 条时的 D1 keyset 分页；当前请求资产并入订阅；缓存读取失败时发出 fallback 状态、继续 heartbeat，并在缓存恢复后清除错误；写预算短暂拒绝后重试，脏行情按 FIFO 分批写入。
- D1 批量读写、分块、去重、共享租约、配额窗口和旧接收报价保护；坏映射不得进入上游，也不能让同批有效资产失败；identity 不匹配的毒化旧缓存不会复用。
- NAV 解析只接受标注、有效日期和正确币种的数据；桥接 NAV 校验资产身份、币种、披露日期；参考日历处理 DST/早收市，Alpaca 默认使用 Paper 日历端点且仅显式 `ALPACA_TRADING_ENV=live` 切换 live 端点；公司行为必须完整分页且匹配请求标的。
- 桥接 Python 测试覆盖认证、白名单、响应契约、限流、worker 超时及缓存；所有测试均使用本地模拟响应。

以上自动检查验证本地代码路径与 fixture，不证明真实供应商权限、生产部署、生产 D1、浏览器 `EventSource` 自动重连或持续行情刷新。

## 本机运行验证（由主指挥执行，非本代理独立实测）

- CoinGecko Demo 公共行情请求 HTTP 200；BTC、ETH 响应包含市值、流通供应及源时间。
- 本机应用 `/api/nav?asset=IWM` 返回 HTTP 200，币种 USD、披露日期 2026-10-27；SPY 返回 404（未接入）。这是本机运行验证，不是生产验收。
- 本机参考数据路由在未配置 Alpaca 凭据时返回 503 / `NOT_CONFIGURED`；无效日期返回 400。此前无凭据直连 Alpaca Paper 返回 HTTP 401，只能说明该请求未获授权，不能证明业务数据接通。
- 本机 loopback AKShare 桥接：未鉴权 `/nav` 返回 401；携带服务端 token 后，510500 NAV 返回 HTTP 200、CNY、披露日期 2026-10-28；`/quotes` 返回 HTTP 502，故 ETF 行情仍未接通。桥接服务随后停止，未开放公网。

这些运行检查由主指挥执行，未使用生产账号或执行账户交易。未部署、未做生产浏览器观察，也未用真实生产 D1 验收；不得据此声称生产实时刷新已恢复。

## 验收边界

AKShare 桥接当前 NAV 可返回本机真实上游数据，但 quotes 上游仍失败。Alpaca 未注册、未配置凭据，参考日历与公司行为适配器仅经过 fixture 测试；Longbridge SDK/桥接未配置。iShares IWM NAV 的本机 HTTP 验证与其它未接入基金无关。真实行情覆盖、权限、时效和生产环境仍需分别核验。

SSE 自动化使用注入时钟和本地 mock；真实 Collector 取消测试以可中止的 mock fetch 验证 abort，不代表连接了交易所。跨过 55 秒边界的轮换由注入调度器模拟，没有观察浏览器 EventSource 自动重连。
