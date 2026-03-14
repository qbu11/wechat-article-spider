# 微信公众号文章爬取

微信公众号文章搜索与爬取工具。支持两种搜索模式：按公众号名称搜索和按文章关键词搜索。

## 触发词

wechat-article-spider, wechat-spider, 微信公众号搜索, 公众号检索, 微信文章搜索, 微信文章爬取

## 安装

```bash
# 从本地目录安装
pip install ./wechat-article-spider

# 或从 Git 仓库安装
pip install git+https://github.com/qbu11/wechat-article-spider.git
```

## 前置条件

- Python >= 3.8
- Chrome 浏览器（登录时需要）
- 需要先登录微信公众平台（扫码登录，缓存有效期约4天）

---

## 智能决策：自动识别搜索类型

**第一步：判断用户输入类型**

```bash
# 先尝试搜索公众号
wechat-spider search "用户输入的关键词"
```

**判断依据：**
- 如果返回的公众号列表包含明确相关的账号 → 用户输入的是**公众号名称** → 走场景 A
- 如果返回的公众号列表不相关或为空 → 用户输入的是**文章关键词** → 走场景 B

---

## 场景 A：按公众号名称搜索

用户知道具体公众号名称，想获取该公众号的文章。使用 `wechat-spider` CLI 工具。

### 1. 检查登录状态

```bash
wechat-spider status
```

返回 JSON 格式的登录状态。如果 `success: false`，需要先登录。

### 2. 登录（需要用户扫码）

```bash
wechat-spider login
```

会弹出 Chrome 浏览器窗口，用户需要用微信扫码。登录成功后凭证自动缓存。

**重要**: 登录需要用户交互（扫码），必须提示用户操作。

### 3. 搜索公众号

```bash
wechat-spider search "公众号名称"
```

返回匹配的公众号列表，包含 `wpub_name`（名称）和 `wpub_fakid`（ID）。

### 4. 爬取单个公众号文章

```bash
wechat-spider scrape "公众号名称" --pages 5 --days 30 --content
```

参数说明:
- `--pages N`: 最大页数，每页5篇（默认5）
- `--days N`: 时间范围，最近N天（默认30）
- `--content`: 是否获取文章正文（不加则只获取标题和链接）
- `--interval N`: 请求间隔秒数（默认5，建议不低于3）
- `--output FILE`: 输出CSV文件路径

### 5. 批量爬取多个公众号

```bash
wechat-spider batch "公众号1,公众号2,公众号3" --pages 3 --days 7 --content
```

参数说明:
- 公众号名称用逗号分隔
- `--output-dir DIR`: 输出目录（默认 ~/WeChatSpider）
- 其他参数同 scrape

### 6. 无头服务器部署（导入/导出登录凭证）

适用于在无头服务器上使用，无需扫码：

```bash
# 在有浏览器的机器上导出凭证
wechat-spider export-login

# 在无头服务器上导入凭证
wechat-spider import-login "导出的凭证字符串"
```

---

## 场景 B：按文章关键词搜索

用户提供的是**文章主题关键词**，需要跨公众号搜索相关文章。使用**搜狗微信搜索**。

### 1. 打开搜狗微信搜索

```javascript
// 使用 Chrome DevTools MCP
chrome_devtools__navigate_page({
  url: "https://weixin.sogou.com/weixin?type=2&query=关键词&ie=utf8"
})
```

**URL 参数说明：**
- `type=2`: 搜索公众号文章（type=1 为搜索公众号）
- `query`: 搜索关键词
- `ie=utf8`: 编码格式

### 2. 提取文章列表数据

```javascript
chrome_devtools__evaluate_script({
  function: `() => {
    const items = document.querySelectorAll('.news-list li');
    const results = [];
    items.forEach(item => {
      const titleEl = item.querySelector('h3 a');
      const timeScript = item.querySelector('.s-p script');
      const accountLink = item.querySelector('.account');
      const summaryEl = item.querySelector('.txt-info');

      let timestamp = '';
      if (timeScript) {
        const match = timeScript.textContent.match(/timeConvert\\('(\d+)'\\)/);
        if (match) timestamp = match[1];
      }

      let accountName = '';
      if (accountLink) accountName = accountLink.textContent.trim();

      if (titleEl && timestamp) {
        const ts = parseInt(timestamp);
        const date = new Date(ts * 1000);
        results.push({
          title: titleEl.textContent.trim(),
          account: accountName,
          timestamp: ts,
          date: date.toISOString().split('T')[0],
          link: titleEl.href,
          summary: summaryEl ? summaryEl.textContent.trim() : ''
        });
      }
    });
    return results;
  }`
})
```

**返回数据结构：**
```json
{
  "title": "文章标题",
  "account": "公众号名称",
  "timestamp": 1773327658,
  "date": "2026-03-12",
  "link": "搜狗跳转链接",
  "summary": "文章摘要"
}
```

### 3. 翻页收集更多数据

```javascript
// 方法1：点击下一页按钮
chrome_devtools__click({ selector: ".np" })

// 方法2：构造翻页 URL
chrome_devtools__navigate_page({
  url: "https://weixin.sogou.com/weixin?query=关键词&page=2&type=2"
})
```

**注意：** 搜狗微信搜索最多显示约10页结果，每页约10篇文章。

### 4. 时间过滤（筛选最近N天）

```python
import datetime

# 计算时间阈值（例如最近7天）
cutoff_date = datetime.datetime.now() - datetime.timedelta(days=7)

# 过滤
recent_articles = [
    a for a in all_articles
    if a["timestamp"] >= cutoff_date.timestamp()
    and "关键词" in a["title"].lower()
]
```

### 5. 爬取文章正文

**重要：必须使用 Chrome DevTools MCP，不能用 requests/WebFetch**

搜狗链接有反爬虫机制，直接用 `requests` 或 `WebFetch` 会被重定向到 `/antispider/` 页面。必须通过浏览器访问才能绕过。

```javascript
// 通过搜狗链接跳转到微信原文（浏览器会自动跟随跳转）
chrome_devtools__navigate_page({ url: article.link })

// 等待页面加载完成后提取内容
chrome_devtools__evaluate_script({
  function: `() => {
    const title = document.querySelector('#activity-name')?.textContent.trim() || document.title;
    const account = document.querySelector('#js_name')?.textContent.trim() || '';
    const publishTime = document.querySelector('#publish_time')?.textContent.trim() || '';
    const contentEl = document.querySelector('#js_content');
    const content = contentEl ? contentEl.innerText.trim() : '';
    return { title, account, publishTime, content, url: window.location.href };
  }`
})
```

**批量抓取策略：**
- 逐个访问链接（不能并行，避免触发限流）
- 每篇文章间隔 3-5 秒
- 30 篇文章预计耗时 2-3 分钟

**微信公众号页面 DOM 结构：**
- `#activity-name`: 文章标题
- `#js_name`: 公众号名称
- `#publish_time`: 发布时间
- `#js_content`: 文章正文

### 6. 输出 CSV 文件

```python
import csv

with open('output.csv', 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['标题', '公众号', '发布时间', '链接', '内容摘要'])
    for article in articles:
        writer.writerow([
            article['title'],
            article['account'],
            article['publish_time'] or article['date'],
            article['link'],
            article.get('summary', '')[:500]  # 摘要截取500字符
        ])
```

---

## 工具链选择

| 场景 | 推荐工具 | 原因 |
|------|---------|------|
| 按公众号名搜索 | `wechat-spider` CLI | 专门工具，支持登录态，可直接爬取 |
| 按文章关键词搜索 | Chrome DevTools MCP | 需要解析搜狗搜索页面，提取时间戳 |
| 批量爬取文章 | `wechat-spider batch` | 效率高，支持时间范围过滤 |
| 单篇文章抓取 | Chrome DevTools + JS 提取 | 绕过搜狗跳转，直接获取微信原文 |
| 无头服务器部署 | `export-login` / `import-login` | 无需扫码，凭证可移植 |

---

## 注意事项

1. **登录有效期**: 微信 token 约4-7天过期，过期后需重新扫码
2. **频率限制**: 请求间隔建议 >=3秒，避免被微信限制
3. **合法使用**: 仅用于学习和研究目的
4. **正文获取**: 加 `--content` 会显著增加耗时，按需使用
5. **日志输出**: 日志输出到 stderr，JSON 结果输出到 stdout
6. **搜狗链接**: 搜狗返回的是跳转链接，必须通过**浏览器**访问才能获取真实微信文章 URL。直接用 `requests`/`WebFetch` 会被反爬虫机制阻止
7. **时间戳解析**: 搜狗页面使用 `timeConvert('秒级时间戳')` 函数显示时间
8. **批量抓取**: 使用 Chrome DevTools MCP 逐个访问链接，每篇间隔 3-5 秒，30 篇约需 2-3 分钟

---

## 典型场景

### 场景A: 快速查看某公众号最近文章标题

```bash
wechat-spider scrape "极客公园" --pages 2 --days 7
```

### 场景B: 获取某公众号文章全文用于分析

```bash
wechat-spider scrape "某公众号" --pages 10 --days 90 --content --output results.csv
```

### 场景C: 对比多个公众号的内容

```bash
wechat-spider batch "公众号A,公众号B,公众号C" --pages 5 --days 30 --content
```

### 场景D: 按关键词搜索文章（跨公众号）

**完整自动化工作流：**

当用户提供文章关键词时，AI 应自动执行以下步骤：

#### 第一阶段：搜索和筛选

1. 打开搜狗微信搜索
2. 提取文章列表数据（标题、链接、摘要、时间戳）
3. 按时间过滤（如最近 N 天）
4. 保存为临时 CSV

#### 第二阶段：批量抓取全文（自动执行）

**重要：当用户要求"全部内容"、"完整文章"、"正文"时，必须自动执行此阶段，无需再次询问用户。**

```javascript
// 自动化批量抓取流程（AI 应自动执行）
const results = [];

for (let i = 0; i < articles.length; i++) {
  const article = articles[i];

  console.log(`[${i+1}/${articles.length}] 抓取: ${article.title}`);

  // 1. 访问搜狗链接（自动跳转到微信原文）
  await chrome_devtools__navigate_page({ url: article.link });

  // 2. 等待页面加载
  await sleep(2000);

  // 3. 提取文章内容
  const content = await chrome_devtools__evaluate_script({
    function: `() => {
      const title = document.querySelector('#activity-name')?.textContent.trim() || document.title;
      const account = document.querySelector('#js_name')?.textContent.trim() || '';
      const publishTime = document.querySelector('#publish_time')?.textContent.trim() || '';
      const contentEl = document.querySelector('#js_content');
      const content = contentEl ? contentEl.innerText.trim() : '';
      return { title, account, publishTime, content, url: window.location.href };
    }`
  });

  // 4. 保存结果
  results.push({
    ...article,
    account: content.account,
    publishTime: content.publishTime,
    content: content.content,
    wechatUrl: content.url
  });

  // 5. 等待间隔（避免限流）
  if (i < articles.length - 1) {
    console.log(`等待 4 秒...`);
    await sleep(4000);
  }
}

// 6. 输出完整 CSV
saveToCSV(results, 'articles_with_full_content.csv');
```

#### 执行规则

**自动触发条件：**
- 用户说"我要全部内容"
- 用户说"不要给我摘要"
- 用户说"获取完整文章"
- 用户说"抓取正文"

**执行时机：**
- 在保存 CSV 之前，先完成批量抓取
- 不要先保存摘要 CSV，再问用户是否需要全文
- 直接一次性输出包含完整内容的 CSV

**进度提示：**
```
正在批量抓取 10 篇文章的完整内容...
[1/10] 抓取: OpenClaw 技能体系 ✓
[2/10] 抓取: OpenClaw 技能系统架构 ✓
...
[10/10] 抓取: OpenClaw Skill 是什么 ✓

已保存到: articles_with_full_content.csv
```

#### 技术限制

**为什么不能用 Python requests？**

搜狗有反爬虫机制，直接用 requests 访问会被重定向到 `/antispider/` 页面。只有浏览器才能绕过。

**禁止做法：**
- ❌ 用 Python requests 直接访问搜狗链接（会被反爬虫阻止）
- ❌ 用 WebFetch 工具（会被反爬虫阻止）
- ❌ 并行访问多个链接（会触发限流）
- ❌ 先保存摘要 CSV，再询问用户是否需要全文（应直接抓取）

**推荐做法：**
- ✅ 使用 Chrome DevTools MCP 逐个访问
- ✅ 每篇间隔 3-5 秒
- ✅ 自动执行，无需用户确认
- ✅ 显示实时进度
- ✅ 30 篇文章约需 2-3 分钟

---

## 相关工具

- `chrome-browser-automation` skill: Chrome DevTools MCP 配置
- `union-search-skill`: 跨平台搜索（支持微信文章搜索）
