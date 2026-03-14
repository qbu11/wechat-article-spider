# wechat-article-spider

微信公众号文章爬取工具。pip 可安装，CLI 驱动，支持 Claude Code / OpenClaw Skill 集成。

## 项目结构

```
wechat-article-spider/
├── CLAUDE.md                          # 本文件
├── pyproject.toml                     # 包定义，入口 wechat-spider
├── VERSIONS.md                        # 多版本管理（DrissionPage / agent-browser / Selenium）
├── src/wechat_article_spider/
│   ├── cli.py                         # CLI 入口，所有子命令定义
│   ├── skill_data/SKILL.md            # Skill 文档（随 pip 包分发）
│   └── spider/
│       ├── log/utils.py               # loguru 日志
│       └── wechat/
│           ├── login.py               # QR 扫码登录 + 凭证缓存（DrissionPage）
│           ├── scraper.py             # 爬虫核心（WeChatScraper / BatchWeChatScraper）
│           ├── utils.py               # 微信公众平台 API 请求
│           ├── paths.py               # 路径管理（缓存目录、输出目录）
│           ├── cache_codec.py         # 凭证导入导出（zlib + CRC32 + Base64）
│           └── async_utils.py         # 异步批量爬取
└── skill/                             # 旧版 skill 目录（已迁移到 skill_data）
```

## 分支管理

| 分支 | 浏览器方案 | 状态 |
|------|-----------|------|
| `master` | DrissionPage（纯 Python，推荐） | 活跃 |
| `agent-browser-version` | agent-browser（Vercel，Node.js） | 备选 |
| 本地备份 `wechat-article-spider-selenium-backup/` | Selenium | 归档 |

## 开发约定

- Python >= 3.8，无 GUI 依赖
- 所有 CLI 命令输出 JSON 到 stdout，日志输出到 stderr（loguru）
- Windows 必须处理 UTF-8：`_ensure_utf8_stdout()` + `_print_json()`
- 请求间隔 >= 3 秒，避免微信限流
- 登录模块使用 DrissionPage 操控 Chrome（CDP 端口 9222）
- 凭证缓存在 `~/.wechat_spider/cache/`，有效期约 4-7 天

## CLI 命令

```bash
wechat-spider status                    # 检查登录状态
wechat-spider login                     # 扫码登录（弹出 Chrome）
wechat-spider search "关键词"            # 搜索公众号
wechat-spider scrape "公众号" --pages 5 --days 30 --content --output result.csv
wechat-spider batch "号1,号2" --pages 3 --days 7 --content --output-dir ./out
wechat-spider export-login              # 导出凭证字符串
wechat-spider import-login "凭证字符串"  # 导入凭证
wechat-spider install-skill             # 部署 SKILL.md 到 ~/.claude/skills/
```

## 两种搜索模式

### 场景 A：按公众号名称（CLI 工具）

`wechat-spider search/scrape/batch`，依赖微信公众平台 API + 登录态。

### 场景 B：按文章关键词（Chrome DevTools MCP + 搜狗）

通过 `weixin.sogou.com` 搜索文章，用 Chrome DevTools MCP 提取列表和正文。

关键限制（已验证）：
- 搜狗有反爬虫机制，`requests` / `WebFetch` 会被重定向到 `/antispider/`
- **必须**使用 Chrome DevTools MCP 浏览器访问
- 逐个访问，每篇间隔 3-5 秒
- 当用户要求"全部内容"/"完整文章"/"正文"时，自动批量抓取，不要先保存摘要再询问

## 打包与部署

```bash
# 安装
pip install .
# 或从 GitHub
pip install git+https://github.com/qbu11/wechat-article-spider.git

# 部署 Skill
wechat-spider install-skill
# → ~/.claude/skills/wechat-article-spider/SKILL.md
# → ~/.openclaw/skills/wechat-article-spider/SKILL.md
```

## 测试

```bash
wechat-spider status                                          # 登录态
wechat-spider search "人民日报"                                # 搜索
wechat-spider scrape "人民日报" --pages 2 --days 7             # 爬取标题
wechat-spider scrape "人民日报" --pages 2 --days 7 --content   # 爬取正文
wechat-spider export-login                                     # 导出凭证
```

## 已知问题

- Windows 终端 GBK 编码导致 JSON 输出乱码 → 已通过 `_ensure_utf8_stdout()` 修复
- 搜狗链接 requests 跟随跳转被反爬虫拦截 → 只能用浏览器
- 单篇文章抓取失败会中断批量任务 → 已加 try/except 容错
