# wechat-article-spider 版本管理

本项目支持多种浏览器自动化方案，通过 Git 分支管理不同版本。

## 版本概览

| 分支 | 浏览器方案 | 依赖 | 特点 |
|------|-----------|------|------|
| `master` | DrissionPage | Python | 纯 Python，接管/创建 Chrome，CDP 原生支持 |
| `agent-browser-version` | agent-browser | Node.js CLI | Vercel 官方工具，CDP 连接，性能最优 |

## 切换版本

```bash
cd /c/11projects/wechat-article/wechat-article-spider

# 切换到 DrissionPage 版本（推荐）
git checkout master
pip install -e .

# 切换到 agent-browser 版本
git checkout agent-browser-version
pip install -e .
```

---

## 版本详情

### 1. DrissionPage 版本 (master)

**优点：**
- 纯 Python 实现，无需额外安装 Node.js
- 可接管已打开的 Chrome（9222 端口）
- 可创建新的 Chrome 并暴露调试端口
- 与 Chrome DevTools MCP 共享浏览器
- 代码简洁，API 友好

**安装：**
```bash
pip install -e .
# DrissionPage 会自动安装
```

**使用：**
```bash
wechat-spider status   # 检查登录状态
wechat-spider login    # 扫码登录
wechat-spider scrape "人民日报" --pages 5
```

**技术细节：**
```python
from DrissionPage import ChromiumPage

# 接管现有 Chrome
page = ChromiumPage(addr_or_opts='127.0.0.1:9222')

# 或创建新的 Chrome
from DrissionPage import ChromiumOptions
co = ChromiumOptions()
co.set_local_port(9222)
page = ChromiumPage(addr_or_opts=co)
```

---

### 2. agent-browser 版本 (agent-browser-version)

**优点：**
- Vercel 官方维护，专为 AI Agent 设计
- Rust + Node.js 实现，性能最优
- 支持 CDP 连接现有 Chrome
- 支持 headed/headless 模式
- 丰富的命令行工具

**安装：**
```bash
# 1. 安装 agent-browser CLI
npm install -g agent-browser
agent-browser install

# 2. 安装 Python 包
pip install -e .
```

**使用：**
```bash
wechat-spider status   # 检查登录状态
wechat-spider login    # 扫码登录
wechat-spider scrape "人民日报" --pages 5
```

**技术细节：**
```bash
# agent-browser 命令示例
agent-browser --cdp 9222 open https://mp.weixin.qq.com/
agent-browser --cdp 9222 snapshot
agent-browser --cdp 9222 get url
agent-browser --cdp 9222 cookies get
```

---

## 与 Chrome DevTools MCP 配合

两个版本都支持与 Chrome DevTools MCP 共享浏览器：

### 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│  Chrome 浏览器 (端口 9222)                                   │
│  --remote-debugging-port=9222                               │
└─────────────────────────────────────────────────────────────┘
              │                           │
              ▼                           ▼
┌─────────────────────────┐   ┌─────────────────────────────┐
│  wechat-article-spider  │   │  Chrome DevTools MCP        │
│  (DrissionPage 或       │   │  (chrome-devtools-mcp)      │
│   agent-browser)        │   │                             │
└─────────────────────────┘   └─────────────────────────────┘
```

### 配置 MCP

在 `~/.claude/mcp.json` 中：
```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--browser-url=http://127.0.0.1:9222"]
    }
  }
}
```

### 启动 Chrome

```powershell
# 方式1: Hook 自动启动（推荐）
# 直接使用 MCP 工具，hook 会自动启动 Chrome

# 方式2: 手动启动
Start-Process "chrome.exe" -ArgumentList "--remote-debugging-port=9222"
```

---

## 备份与回滚

### 原始 Selenium 版本

原始 Selenium 版本已备份在：
```
C:\11projects\WeMediaSpider\wechat-article-spider-selenium-backup\
```

回滚到 Selenium 版本：
```bash
cd /c/11projects/WeMediaSpider
rm -rf wechat-article-spider
cp -r wechat-article-spider-selenium-backup wechat-article-spider
cd wechat-article-spider
pip install -e .
```

---

## 版本比较

| 特性 | Selenium (备份) | DrissionPage | agent-browser |
|------|----------------|--------------|---------------|
| **语言** | Python | Python | Rust + Node.js |
| **安装复杂度** | 中 | 低 | 中 |
| **性能** | 中 | 高 | 最高 |
| **CDP 支持** | ❌ | ✅ 原生 | ✅ 原生 |
| **MCP 共享** | ❌ | ✅ | ✅ |
| **维护状态** | 备份 | 活跃 | 活跃 |

---

## 推荐方案

1. **日常使用**：DrissionPage 版本（master 分支）
   - 纯 Python，安装简单
   - 与 MCP 无缝配合

2. **性能要求高**：agent-browser 版本
   - Rust 实现，性能最优
   - Vercel 官方维护

3. **需要稳定兼容**：保留 Selenium 备份
   - 传统的 WebDriver 方式
   - 兼容性最广

---

## 更新日志

- **2026-03-14**: 重命名为 wechat-article-spider
- **2026-03-13**: 创建 agent-browser 版本
- **2026-03-13**: 将 Selenium 替换为 DrissionPage
- **2026-03-12**: 初始版本（Selenium）
