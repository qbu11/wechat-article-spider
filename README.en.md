<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/hero-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/hero-light.svg">
    <img alt="WeChat Agent Kit" src="assets/hero-light.svg" width="920">
  </picture>

  <p><strong>Search, read, and subscribe to WeChat Official Account articles from any AI agent.</strong></p>

  [![npm](https://img.shields.io/npm/v/@qbu11/wechat-agent-kit?color=07c160&label=npm)](https://www.npmjs.com/package/@qbu11/wechat-agent-kit)
  [![CI](https://github.com/qbu11/wechat-article-spider/actions/workflows/ci.yml/badge.svg)](https://github.com/qbu11/wechat-article-spider/actions/workflows/ci.yml)
  [![Agent Skills](https://img.shields.io/badge/Agent%20Skills-compatible-111827)](https://agentskills.io)
  [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

  [中文](README.md) · **English**
</div>

## Install with one command

```bash
npx @qbu11/wechat-agent-kit install
```

Before the first npm registry release, use the pinned GitHub version directly:

```bash
npx github:qbu11/wechat-article-spider#v0.2.0 install
```

The installer previews its writes and asks for confirmation, then installs three standard Agent Skills for Claude Code, Codex, and generic `.agents/skills` consumers. There is no `postinstall`; dry runs, project scope, backups, and ownership-aware uninstall are built in.

```bash
npx @qbu11/wechat-agent-kit install --dry-run
npx @qbu11/wechat-agent-kit install --agent codex --scope project --yes
```

Node.js 22.13+ is required. Current Node.js 24 LTS is recommended.

## The small architecture

```text
Your agent → 3 SKILL.md files → wechat-agent JSON CLI → one local SQLite file
```

There is no resident service, separate database, or built-in scheduler. The CLI creates and manages SQLite automatically.

| Skill | Capability | Source |
|---|---|---|
| `wechat-search` | Keyword queries, exact-account time windows, and account discovery | Local index + Sogou WeChat Search |
| `wechat-article` | Article body and metadata retrieval | `mp.weixin.qq.com` |
| `wechat-subscribe` | Subscriptions, explicit sync, and health | RSS 2.0 / Atom / JSON Feed |

Every command emits structured JSON on stdout for predictable agent and script integration.

## Quick start

Ask your agent to search for recent WeChat articles about a topic, summarize a supplied WeChat link with provenance, or subscribe to a supplied Atom feed and sync it once.

```bash
wechat-agent query --keywords "OpenAI" --scope hybrid --limit 10 --json
wechat-agent query --account "Huxiu" --after 2026-08-01 --before 2026-08-15 --scope hybrid --limit 20 --json
wechat-agent read --url "https://mp.weixin.qq.com/s/..." --content full --json
wechat-agent subscribe --feed-url "https://example.com/wechat.xml" --label "My feed" --json
wechat-agent sync --json
wechat-agent list --json
```

If the binary is not global, the bundled skills fall back to an exact-version `npx` command. See every command with:

```bash
npx @qbu11/wechat-agent-kit --help
```

`query` does not fetch every article body. It runs local and network discovery concurrently and returns compact JSON as quickly as possible. Each result separates `originalUrl` from `discoveryUrl`; a Sogou redirect is never mislabeled as an original link. See the [Skill workflow and data-processing specification](docs/workflow-and-data-processing.md) for intent routing, provenance, deduplication, and sync rules.

## Honest boundaries

WeChat does not expose a stable public subscription API for this use. Persistent subscriptions therefore require an explicit, validated RSS 2.0, Atom, or JSON Feed URL. An account name or search identifier is never guessed into a feed.

- Global discovery uses Sogou WeChat Search and may face CAPTCHA, rate limits, or markup changes. The CLI reports this instead of bypassing access controls.
- Reading supports public original WeChat URLs and distinguishes deleted, blocked, and incomplete pages.
- Updates happen only on explicit `sync`. Use a scheduler you control if periodic invocation is needed.
- Coverage and delay are determined by the feed provider; this project does not claim a complete account archive.

## Local-first and secure

- Articles and subscriptions live in one `wechat-agent.sqlite` file in the OS application data directory. Override it with `WECHAT_AGENT_DATA_DIR`.
- Network access rejects private targets, unsafe redirects, and oversized responses. All fetched content remains untrusted input.
- The installer backs up conflicts and only uninstalls unchanged files that it owns.
- Cookies, browser profiles, and authentication headers are not printed.

See [Security](SECURITY.md), [Privacy](PRIVACY.md), [Architecture](docs/architecture.md), and the [robustness testing guide](docs/testing.md).

## Development

```bash
npm ci
npm run test:robustness
npm run validate
npm run build
npm run pack:check
```

The original Python `wechat-spider` remains for legacy workflows that sign into the WeChat admin platform; it is not a dependency of the new Agent Skills. See [Legacy Python](docs/legacy-python.md).

Contributions are welcome—read [CONTRIBUTING.md](CONTRIBUTING.md). Released under the [MIT License](LICENSE). Use the project lawfully and respect source terms and copyright.
