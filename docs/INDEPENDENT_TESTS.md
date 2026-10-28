# 实时行情独立测试报告

检查日期：2026-10-28（Asia/Shanghai）

## 自动检查

- 完成SSE重构前，既有 Node 测试通过 50/50 项；当前 `node --experimental-strip-types --test tests/*.test.ts` 通过 59/59 项，其中 `tests/realtime-behavior.test.ts` 通过 8/8 项。
- `npx tsc --noEmit`：最新行情修复、兼容报价接口批量读写及新测试落地后通过。
- `npm run lint`：基线检查失败，69 errors、10 warnings。全项目已有多处 `no-explicit-any` 和 React Hooks 规则错误；实时行情相关的既有报错包括 `hooks/use-kraken-live.ts` 中的 `no-explicit-any` 与 `set-state-in-effect`。重构后没有重跑全项目 lint。
- 新增 `tests/realtime-behavior.test.ts`，用注入时钟和调度器验证：慢批量读取、Collector `tick`、persist 在等待时不阻塞 heartbeat；同一后台任务未完成时不会重入；重复 `CloseBarrier.close` 共用租约清理，并在释放完成后关闭响应；SSE 不调用 `QuoteService.get`；55 秒时结束发送并等待租约 release 后关闭；客户端取消期间真实 Collector 的 pending upstream fetch 会收到 abort、租约释放且不触发供应商熔断；价格接收年龄正确降级为 `DELAYED`/`STALE`；USDT币种与源时间不变，美股缺少可靠时间戳时不合成时间；客户端会删除 `unavailable` 指定的旧报价，且忽略较旧 SSE 帧。
- `tests/quotes.test.ts` 额外验证 D1 批量写入对较旧 `receivedAt` 的保护，以及 80 键分块读取和重复 key 去重。兼容 `/api/quotes` 的规模查询现按批量读取、租约、写入和释放，最多仍并发处理 4 个规模请求；市场规模计算的调用方式不变。
- 这些是本地自动化 mock 测试。真实 Collector 的取消用可中止的 mock fetch 覆盖，但不验证真实交易所握手、真实上游网络或浏览器 `EventSource` 的自动重连；55秒轮换由注入的时钟/调度器确定性模拟。

## 基线源码审查发现

重构前检查 `lib/quotes/stream.ts` 时发现，同一个 SSE 循环在发送下一帧之前会 `await service.get(assets)`。慢行情源会延后报价帧、状态帧和 heartbeat；55秒截止时间也只在每轮开始处判断。本次重构后，新测试覆盖了后台任务隔离和到期关闭顺序。以上均属于代码路径测试，不是生产环境实测。

## 端到端边界

自动测试使用本地 mock、注入时钟和内存存储验证逻辑，不会证明当前生产站点的认证、部署版本、D1绑定、代理/上游连通性或浏览器是否持续收到真实交易所推送。要声称“生产实时刷新已恢复”，仍需在用户已授权的生产浏览器会话中观察真实 SSE：连续跨过55秒连接边界、记录自动重连前后的报价事件和 `receivedAt`，确认源时间、报价状态及币种；本独立测试未访问生产账号、未部署，也未修改账本。

项目已有的 `docs/MARKET_DATA_VALIDATION.md` 记录了此前一次生产观察（约9秒采样），但那次记录没有覆盖55秒重连或慢 REST 阻塞；本报告不把此前记录当成本次生产验收。

SSE 现在不直接执行 REST 刷新；股票、ETF、指数仍由 Dashboard 经 `/api/quotes` 路径按分钟级/手动刷新。新测试验证该分离不会让共享 SSE 心跳等待行情REST调用，并验证客户端处理 `unavailable` 与拒绝旧帧。以上 fixture 只证明代码路径行为，不能替代交易所网络、生产基础设施或浏览器端到端验收。
