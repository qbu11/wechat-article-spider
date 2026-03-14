# 微信公众号文章搜索与爬取流程

## 场景描述

当用户提供的关键词**不是公众号名称**，而是需要搜索的**文章主题关键词**时，`wechat-spider` 工具无法直接使用（它只支持按公众号名搜索）。

此时需要采用**浏览器自动化 + 搜狗微信搜索**的方案来完成任务。

---

## 完整流程

### 1. 识别关键词类型

```bash
# 先尝试用 wechat-spider 搜索公众号名
wechat-spider search "关键词"

# 如果返回的公众号列表明显不相关（如包含大量无关账号）
# 则判断：这是文章关键词，不是公众号名
```

**判断依据：**
- 搜索结果中没有知名/相关的技术公众号
- 返回的账号名称与关键词主题不符
- 用户意图是"搜文章"而非"找公众号"

---

### 2. 使用搜狗微信搜索

```javascript
// 打开搜狗微信搜索页面
navigate_page("https://weixin.sogou.com/weixin?type=2&query=关键词&ie=utf8")
```

**URL 参数说明：**
- `type=2`: 搜索公众号文章（type=1 为搜索公众号）
- `query`: 搜索关键词
- `ie=utf8`: 编码格式

---

### 3. 提取文章列表数据

```javascript
() => {
  const items = document.querySelectorAll('.news-list li');
  const results = [];
  items.forEach(item => {
    const titleEl = item.querySelector('h3 a');
    const timeScript = item.querySelector('.s-p script');
    const accountLink = item.querySelector('.account');
    const summaryEl = item.querySelector('.txt-info');

    let timestamp = '';
    if (timeScript) {
      const match = timeScript.textContent.match(/timeConvert\('(\d+)'\)/);
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
        date: date.toISOString().split('T')[0],  // YYYY-MM-DD
        link: titleEl.href,
        summary: summaryEl ? summaryEl.textContent.trim() : ''
      });
    }
  });
  return results;
}
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

---

### 4. 翻页收集更多数据

```javascript
// 点击下一页按钮
click(uid="下一页按钮的uid")

// 或直接构造翻页URL
navigate_page(`https://weixin.sogou.com/weixin?query=关键词&page=${页码}&type=2`)
```

---

### 5. 时间过滤（筛选最近N天）

```python
import datetime

# 计算时间阈值（例如最近7天）
cutoff = datetime.datetime(2026, 3, 6).timestamp()
cutoff_date = datetime.datetime.now() - datetime.timedelta(days=7)

# 过滤
recent_articles = [
    a for a in all_articles
    if a["timestamp"] >= cutoff_date.timestamp()
    and "关键词" in a["title"].lower()
]
```

---

### 6. 爬取文章正文

```javascript
// 通过搜狗链接跳转到微信原文
navigate_page(搜狗链接)

// 提取文章内容
() => {
  const title = document.querySelector('#activity-name')?.textContent.trim() || document.title;
  const account = document.querySelector('#js_name')?.textContent.trim() || '';
  const publishTime = document.querySelector('#publish_time')?.textContent.trim() || '';
  const contentEl = document.querySelector('#js_content');
  const content = contentEl ? contentEl.innerText.trim() : '';
  return { title, account, publishTime, content, url: window.location.href };
}
```

**微信公众号页面 DOM 结构：**
- `#activity-name`: 文章标题
- `#js_name`: 公众号名称
- `#publish_time`: 发布时间
- `#js_content`: 文章正文

---

### 7. 输出 CSV 文件

```python
import csv

with open('output.csv', 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['标题', '公众号', '发布时间', '链接', '内容摘要'])
    for article in articles:
        writer.writerow([
            article['title'],
            article['account'],
            article['publish_time'],
            article['link'],
            article['summary'][:500]  # 摘要截取500字符
        ])
```

---

## 关键注意事项

### 1. 搜狗链接处理
- 搜狗返回的是跳转链接，需要通过浏览器访问才能获取真实微信文章URL
- 不能直接用 `WebFetch` 抓取搜狗链接（会被网络策略阻止）

### 2. 时间戳解析
- 搜狗页面使用 `timeConvert('秒级时间戳')` 函数显示时间
- 需要用正则提取时间戳数字，再转换为日期进行过滤

### 3. 关键词匹配
- 标题可能包含相似但不同的词（如 "nemotron" vs "neutron"）
- 需要用小写匹配避免大小写问题

### 4. 翻页策略
- 搜狗微信搜索最多显示约10页结果
- 每页约10篇文章
- 建议先收集所有数据，再统一过滤

### 5. 内容截取
- 微信文章正文可能很长，建议摘要截取前500-1000字符
- 完整内容可单独保存

---

## 工具链选择

| 场景 | 推荐工具 | 原因 |
|------|---------|------|
| 按公众号名搜索 | `wechat-spider` skill | 专门工具，支持登录态，可直接爬取 |
| 按文章关键词搜索 | Chrome DevTools MCP | 需要解析搜狗搜索页面，提取时间戳 |
| 批量爬取文章 | `wechat-spider batch` | 效率高，支持时间范围过滤 |
| 单篇文章抓取 | `navigate_page` + JS提取 | 绕过搜狗跳转，直接获取微信原文 |

---

## 完整示例代码

```javascript
// Step 1: 打开搜狗微信搜索
chrome_devtools__navigate_page({
  url: "https://weixin.sogou.com/weixin?type=2&query=nemotron&ie=utf8"
})

// Step 2: 提取第一页数据
chrome_devtools__evaluate_script({
  function: `() => {
    const items = document.querySelectorAll('.news-list li');
    const results = [];
    items.forEach(item => {
      const titleEl = item.querySelector('h3 a');
      const timeScript = item.querySelector('.s-p script');
      // ... (完整提取逻辑见上方)
    });
    return results;
  }`
})

// Step 3: 翻页并提取（循环2-3页）
chrome_devtools__click({ uid: "下一页按钮uid" })

// Step 4: 打开文章链接获取正文
chrome_devtools__navigate_page({ url: article.link })
chrome_devtools__evaluate_script({
  function: `() => {
    return {
      title: document.querySelector('#activity-name')?.textContent.trim(),
      content: document.querySelector('#js_content')?.innerText.trim()
    };
  }`
})

// Step 5: 生成CSV
// (使用 Write 工具直接写CSV文件)
```

---

## 输出文件格式

```csv
标题,公众号,发布时间,链接,内容摘要
文章标题,公众号名称,2026-03-12,https://mp.weixin.qq.com/...,文章摘要内容...
```

---

## 优化方向

1. **缓存登录态**: 如果需要频繁使用，可以考虑缓存微信公众号登录态
2. **并行爬取**: 多篇文章可以并行打开（使用 `new_page` 创建多个标签页）
3. **增量更新**: 记录已爬取的文章链接，避免重复
4. **智能摘要**: 使用 LLM 对长文进行摘要生成

---

## 相关工具

- `chrome-browser-automation` skill: Chrome DevTools MCP 配置
- `wechat-spider` skill: 公众号搜索与爬取
- `union-search-skill`: 跨平台搜索（支持微信文章搜索）

---

## 更新日志

- 2026-03-13: 初始版本，基于 Nemotron 搜索实战
