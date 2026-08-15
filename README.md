<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/hero-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/hero-light.svg">
    <img alt="WeChat Agent Kit" src="assets/hero-light.svg" width="920">
  </picture>

  <p><strong>让 AI Agent 搜索、阅读和订阅微信公众号文章。</strong></p>

  [![npm](https://img.shields.io/npm/v/@qbu11/wechat-agent-kit?color=07c160&label=npm)](https://www.npmjs.com/package/@qbu11/wechat-agent-kit)
  [![CI](https://github.com/qbu11/wechat-article-spider/actions/workflows/ci.yml/badge.svg)](https://github.com/qbu11/wechat-article-spider/actions/workflows/ci.yml)
  [![Agent Skills](https://img.shields.io/badge/Agent%20Skills-compatible-111827)](https://agentskills.io)
  [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

  **中文** · [English](README.en.md)
</div>

## 一条命令安装

```bash
npx @qbu11/wechat-agent-kit install
```

在首个 npm 版本发布前，也可以直接使用固定的 GitHub 版本：

```bash
npx github:qbu11/wechat-article-spider#v0.1.0 install
```

安装器会先展示写入计划并请求确认，将 3 个标准 Agent Skills 安装到 Claude Code、Codex 和通用 `.agents/skills` 目录。它没有 `postinstall`，支持 `--dry-run`、项目级安装和安全卸载。

```bash
# 先预览，不写文件
npx @qbu11/wechat-agent-kit install --dry-run

# 只安装到当前项目的 Codex skills
npx @qbu11/wechat-agent-kit install --agent codex --scope project --yes
```

要求 Node.js 22.13 或更新版本；推荐当前 Node.js 24 LTS。

## 为什么它足够简单

```text
你的 Agent → 3 个 SKILL.md → wechat-agent JSON CLI → 一个本地 SQLite 文件
```

没有常驻服务，没有独立数据库，没有自动运行的后台任务。SQLite 是 Node.js 自带能力，CLI 会自动创建和维护；它只用来保存订阅、索引文章和同步状态。

| Skill | 能力 | 数据来源 |
|---|---|---|
| `wechat-search` | 按关键词搜索文章、发现公众号 | 本地索引 + 搜狗微信搜索 |
| `wechat-article` | 从原始链接读取正文与元数据 | `mp.weixin.qq.com` |
| `wechat-subscribe` | 保存订阅、手动同步、查看健康状态 | RSS 2.0 / Atom / JSON Feed |

所有命令把结构化 JSON 写到 stdout，便于任何 Agent 或脚本稳定调用。

## 30 秒上手

安装后可以直接对 Agent 说：

> 搜索最近关于 OpenAI 的微信公众号文章，并给出原文链接。

> 阅读这篇微信文章，概括主要观点并保留来源信息。

> 订阅这个 Atom 地址，然后同步一次并列出新增文章。

也可以直接使用 CLI：

```bash
# 全网发现 + 本地结果
wechat-agent search --type articles --query "OpenAI" --scope hybrid --limit 10 --json

# 读取微信原文
wechat-agent read --url "https://mp.weixin.qq.com/s/..." --content full --json

# 持久订阅一个明确的 Feed；更新只在 sync 时发生
wechat-agent subscribe --feed-url "https://example.com/wechat.xml" --label "我的订阅" --json
wechat-agent sync --json
wechat-agent list --json
```

如果没有全局命令，Skills 会回退到固定版本的 `npx` 调用。查看完整命令：

```bash
npx @qbu11/wechat-agent-kit --help
```

## 订阅边界

微信公众号没有面向此用途的稳定公开订阅接口。因此，本项目只持久订阅你明确提供、并经过内容验证的 RSS 2.0、Atom 或 JSON Feed 地址。搜索到的公众号名称或 ID **不会**被猜测成订阅源。

- `search --scope global` 依赖搜狗微信搜索，可能遇到验证码、限流或结果变化；工具会明确报错，不绕过访问控制。
- `read` 支持公开的微信原文链接；已删除、受限或需验证的页面会返回对应状态。
- `sync` 是显式操作。需要定时更新时，请让你信任的外部调度器调用固定的 `wechat-agent sync --json`。
- Feed 的覆盖范围和延迟由 Feed 提供方决定，本项目不声称完整收录某个公众号。

## 本地与安全

- 文章和订阅保存在操作系统应用数据目录的单个 `wechat-agent.sqlite` 中；可用 `WECHAT_AGENT_DATA_DIR` 改变位置。
- 网络访问拒绝私网目标、危险重定向和超大响应；文章、Feed 与搜索内容始终按不可信输入处理。
- 安装器只管理自己写入且未被用户修改的文件；覆盖前会备份，卸载不会删除已修改内容。
- 不在日志或结果中输出 Cookie、浏览器配置与认证头。

详见 [安全策略](SECURITY.md)、[隐私说明](PRIVACY.md) 与 [架构说明](docs/architecture.md)。

## 开发

```bash
npm ci
npm run validate
npm run build
npm run pack:check
```

仓库保留了原来的 Python `wechat-spider`，用于需要扫码登录微信公众平台后台的旧流程；它不是新 Agent Skills 的运行依赖。迁移和凭证注意事项见 [Python 旧版说明](docs/legacy-python.md)。

欢迎阅读 [贡献指南](CONTRIBUTING.md)。本项目基于 [MIT License](LICENSE) 开源，仅用于合法、合规的内容检索与个人信息管理；请遵守来源站点条款与著作权规则。
