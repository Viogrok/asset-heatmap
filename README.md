# 资产地图

私人资产热力图。Node.js >=22.13；React/TypeScript、Vinext、D1、OpenAlgo Heatmap。

## 本地运行（PowerShell）

```powershell
npm ci
npm run build
# 按 drizzle/ 内顺序，仅应用尚未执行的迁移：
node node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_rapid_doctor_spectrum.sql
npm run dev
```

访问 http://127.0.0.1:5173 。本地登录仅在loopback模拟；生产使用Sites身份。

若本机npm shim路径出错，使用 `node E:/DevTools/nodejs/node_modules/npm/bin/npm-cli.js ci`，然后 `node scripts/run-framework.mjs build` / `dev`。

## 检查

```powershell
node node_modules/typescript/bin/tsc --noEmit
node --experimental-strip-types --test tests/model.test.ts
```

## 私人数据

在“数据与设置”导出完整JSON，下载后存放在私人目录。恢复会预览并整体替换数据，使用当前登录身份保存；不恢复平台用户ID。导出后可在全新本地数据库导入，核对数量与计划。

本机 `private/holdings-draft.json` 是历史持仓草稿，不提交Git；导入后仍需在账本核对确认。CSV模板自带示例行，正式导入前应删除示例。

行情接入层、官方信源条件、标准接口和配置见 [docs/MARKET_DATA.md](docs/MARKET_DATA.md)。密钥仅放Sites服务端环境或本地被忽略的 `.dev.vars`；CoinGecko无key不再请求。证券公开兼容源无稳定性承诺。

## 部署与迁移

`.openai/hosting.json`保存Sites项目编号和DB绑定；使用Sites工作流发布，平台在部署时执行Drizzle迁移。源码GitHub备份必须为私有仓库，排除private、.wrangler、密钥、导出文件。

业务计算在lib/model.ts；行情适配在lib/market.ts；登录封装在app/chatgpt-auth.ts。迁移时替换登录与D1持久层，复用计算、资产目录和界面，先恢复JSON到测试环境核对。D1支持的SQL结构随drizzle迁移保存。

## 当前限制

采用移动加权平均成本，不提供含分红、已实现收益或历史汇兑的完整回报。证券当前日与加密24小时不可直接等同。无报价的资产排除估值并列明；无数据与零涨跌不同。外部行情必须分别验证本地与托管环境，不能用模拟值代替。

## 许可证

OpenAlgo Heatmap 0.2.0，MIT。依赖许可证见各包；项目保留第三方声明文件。真实持仓不属于源码。

## v2.0

新版净值与定投、只读连接说明见 `V2_GUIDE.md`。保持JSON备份version=1兼容；新增字段可选，旧账本无需重新录入。账户连接未配置真实密钥前，不代表已完成真实账户同步。
