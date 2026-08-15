# 部署测试报告

**测试日期**: 2026-03-14
**项目**: wechat-article-spider v1.0.0

---

## 测试环境

| 环境 | 状态 | 说明 |
|------|------|------|
| 本地 Claude Code | ✅ 通过 | Windows 11, Python 3.11 |
| OpenClaw | ✅ 通过 | 共享本地 Python 环境 |
| Docker/无头服务器 | ✅ 通过 | 模拟无浏览器环境，使用 import-login |

---

## 测试结果详情

### 1. 本地 Claude Code 测试

```bash
wechat-spider install-skill
wechat-spider scrape "人民日报" --pages 1 --days 7 --output test_output/claude_code_test.csv
```

**结果**:
- ✅ Skill 安装成功
- ✅ 爬取成功：5 篇文章
- ✅ 输出文件：`claude_code_test.csv` (19,224 字节)

### 2. OpenClaw 测试

```bash
wechat-spider scrape "新华社" --pages 1 --days 3 --output test_output/openclaw_test.csv
```

**结果**:
- ✅ Skill 已安装到 `~/.openclaw/skills/wechat-article-spider/`
- ✅ 爬取成功：5 篇文章
- ✅ 输出文件：`openclaw_test.csv` (25,750 字节)

### 3. Docker/无头服务器测试（历史记录）

这部分记录的是旧版 Python 实验，不再是推荐部署流程。WC01 只是编码而非加密，禁止把它作为位置参数、聊天内容、CI 输出或共享日志迁移。当前支持的 Node CLI 不需要微信登录；若必须使用旧版 Python，请在目标机器重新扫码认证。详见 [`docs/legacy-python.md`](docs/legacy-python.md)。

**结果**:
- ✅ 凭证导入成功
- ✅ 登录状态验证通过（token 已确认存在，值不输出）
- ✅ 爬取成功
- ✅ 输出文件：`docker_test_result.csv` (27,178 字节, 366 行)

---

## 输出文件验证

| 文件 | 大小 | 行数 | 内容 |
|------|------|------|------|
| claude_code_test.csv | 19,224 B | - | 人民日报最近7天文章 |
| openclaw_test.csv | 25,750 B | - | 新华社最近3天文章 |
| docker_test_result.csv | 27,178 B | 366 | 央视新闻最近3天文章 |

---

## 部署指南

### 本地 Claude Code / OpenClaw

```bash
# 安装
pip install git+https://github.com/qbu11/wechat-article-spider.git

# 安装 Skill
wechat-spider install-skill

# 登录（首次使用）
wechat-spider login

# 使用
wechat-spider scrape "公众号名称" --pages 5 --days 30 --content --output result.csv
```

### Docker / 无头服务器

推荐直接使用公开来源的 Node `npx` CLI，无需迁移微信 Cookie。旧版 Python 登录态不可安全地通过命令行字符串部署到无头服务器；请在目标环境重新认证，或不要使用该遗留流程。

---

## 结论

✅ **所有环境测试通过**

- 本地 Claude Code 和 OpenClaw 共享同一 Python 环境，功能正常
- 旧版无头凭证迁移结论已废弃；当前不建议传输 WC01
- CSV 输出格式正确，包含公众号、标题、发布时间、链接、内容（Markdown 格式）

---

## 注意事项

1. **登录凭证有效期**: 约 4-7 天，过期需重新扫码
2. **请求频率**: 建议间隔 >= 3 秒，避免被限制
3. **内容获取**: `--content` 参数会增加耗时，按需使用
4. **无头服务器**: 不要通过 argv、聊天或日志传输 WC01；旧版流程应在目标机器重新认证
