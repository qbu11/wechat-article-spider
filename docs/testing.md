# 健壮性测试指南

_目标不是验证“今天恰好能搜到某篇文章”，而是验证来源变化、网络失败、重复数据和恶意输入下，系统仍给出确定、诚实、可恢复的结果。_

---

## 🧪 一键本地门禁

```bash
npm ci
npm run test:robustness
npm run test:python
npm run validate
npm run pack:check
```

Windows 的 Python 命令可写为 `python -m pytest -q`。`test:robustness` 只依赖 Node.js，覆盖核心模型、SQLite、Feed、搜索解析、查询意图、网络安全和安装器，因此适合每次提交执行。

通过标准：全部命令退出码为 0；测试中没有真实账号、Cookie 或浏览器配置；工作区之外不产生未追踪文件。

## 🎯 意图分流测试

让每一种目标 Agent 分别执行下列提示，并只检查它选择的命令，不先评价搜索内容：

| 提示 | 必须判定 | 必须出现 | 不应出现 |
|---|---|---|---|
| 搜索“大模型”相关文章 | `keyword-search` | `query --keywords` | `--account` |
| 获取“虎嗅APP”最近一周文章 | `account-window` | `query --account --after --before` | `search --type accounts` |
| 获取“虎嗅APP”8 月关于机器人的文章 | `account-window` | `--account --keywords --after --before` | 仅关键词查询 |
| 帮我找名为“虎嗅”的公众号 | 账号发现 | `search --type accounts` | `subscribe` |
| 阅读给定微信 URL | 文章读取 | `read --url` | 先全网搜索 |

CLI 还应在 JSON 的 `data.intent.kind` 中回显 `keyword-search` 或 `account-window`。这使 Agent 的自然语言路由和 CLI 的结构化执行可分别检查。

## 📦 JSON 与链接真实性

对每个查询结果做结构断言：

- `success`、`data.intent`、`data.mode`、`data.articles` 存在且类型稳定。
- `mode` 为 `fast-links`，搜索阶段不应批量抓正文。
- `originalUrl` 非空时必须是 `https://mp.weixin.qq.com/s...` 微信原文地址；其他主机即使不是搜狗也只能作为发现来源。
- 只有搜狗跳转时，`originalUrl` 必须为 `null`、`linkKind` 必须为 `discovery`，并包含 warning。
- 每条结果保留 `provenance`，不能只返回无来源标题。
- 失败时 stdout 不混入成功数据，stderr 是 JSON，退出码非零。

建议把这些断言作为 Agent 上层集成测试，而不是比较整段 JSON 文本，以允许未来新增字段。

## 🧯 故障注入矩阵

| 故障 | 预期行为 |
|---|---|
| DNS 或网络超时 | 非零退出；hybrid 有本地命中时降级并产生 warning |
| HTTP 429 / 5xx | 不伪造空成功；保留可诊断错误 |
| 搜狗验证码 | `code=CAPTCHA_REQUIRED`、`retryable=true`、`needsUserAction=true` |
| 搜狗 HTML 结构变化 | 解析器不崩溃；固定 fixture 能快速暴露字段丢失 |
| 非 RSS/Atom/JSON Feed | 订阅被拒绝，不写入伪订阅 |
| Feed 项重复或顺序变化 | 稳定 ID 不变；重复 sync 的新增数为 0 |
| 缺失或非法发布日期 | 不因排序崩溃；带日期过滤时不误收无日期记录 |
| Feed 超大响应 | 达到字节上限即中止 |
| 跳转到私网、本机或内嵌凭据 URL | 在请求目标前拒绝 |
| 正文含“忽略之前指令”等文本 | 作为不可信文章内容返回，不改变 Agent 工作流 |

`tests/runtime/http.test.ts`、`query.test.ts`、`service.test.ts` 和固定 HTML/Feed fixtures 覆盖上述关键不变量。新增连接器时应扩展同一矩阵。

## 🔁 数据一致性测试

在临时 `WECHAT_AGENT_DATA_DIR` 中执行：

```bash
export WECHAT_AGENT_DATA_DIR="$(mktemp -d)"
npx -y @qbu11/wechat-agent-kit@0.2.1 subscribe --feed-url "https://your-test-host.example/feed.xml" --label "测试号" --json
npx -y @qbu11/wechat-agent-kit@0.2.1 sync --json
npx -y @qbu11/wechat-agent-kit@0.2.1 sync --json
npx -y @qbu11/wechat-agent-kit@0.2.1 query --account "测试号" --scope local --json
npx -y @qbu11/wechat-agent-kit@0.2.1 status --json
```

验证第一次同步新增文章，第二次不重复新增；指定公众号查询只返回精确标签匹配；数据库状态仍可读取。测试完成后仅删除刚创建并已核对路径的临时目录。

## 🌐 线上烟雾测试

线上来源会变，因此只断言协议和结构，不固定文章标题或数量：

```bash
npx -y @qbu11/wechat-agent-kit@0.2.1 query --keywords "人工智能" --scope global --limit 1 --json
npx -y @qbu11/wechat-agent-kit@0.2.1 query --account "人民日报" --after 2026-08-01 --before 2026-08-16 --scope hybrid --limit 3 --json
```

接受两种结果：结构正确的成功 JSON；或结构正确的验证码/限流错误。不要把“某次必须返回 3 篇固定文章”设为 CI 条件，否则测试会把第三方内容波动误判成程序回归。

## 🚀 发布前验证

1. 在 Node.js 22 与 24、Ubuntu/macOS/Windows 上运行 `npm ci`、`npm run validate`、`npm run build` 和打包检查。
2. 运行 `npm run verify:npm`，检查 npm 11.17 publish dry-run、三个 bin、三个 Skills 和真实 tarball `npx` 调用；同时确认 tarball 不含测试、凭证、绝对路径或 MCP 文件。
3. 从 tarball 安装到空临时项目，执行 `install --dry-run`、真实安装、`doctor`、卸载预览和卸载。
4. 用固定 Git tag 再做一次真实 `npx` 安装，确认不依赖开发工作区。
5. 只有所有本地门禁和远程 CI 全绿后才发布 npm 版本。

每次来源解析规则、数据身份算法或安装器发生变化时，都应跑完整发布门禁；纯文档修改至少运行 Skill 和插件校验。
