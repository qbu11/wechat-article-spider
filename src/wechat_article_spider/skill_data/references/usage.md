# 微信公众号文章爬取工具 - 详细用法

## 安装

### 方式一：pip 安装

```bash
# 从本地目录安装
pip install ./wechat-article-spider

# 开发模式安装（代码修改立即生效）
pip install -e ./wechat-article-spider
```

### 方式二：从 Git 仓库安装

```bash
pip install git+https://github.com/qbu11/wechat-article-spider.git
```

## 环境要求

- Python >= 3.8
- Chrome 浏览器（登录时需要）
- 依赖包：requests, loguru, beautifulsoup4, lxml, markdownify, tqdm, DrissionPage, aiohttp

## 登录流程

### 首次使用

```bash
wechat-spider login
```

1. 系统会自动打开 Chrome 浏览器
2. 访问微信公众平台登录页
3. 使用微信扫描二维码
4. 登录成功后自动关闭浏览器
5. 凭证缓存到本地（有效期约 4 天）

### 检查登录状态

```bash
wechat-spider status
```

返回示例：
```json
{
  "success": true,
  "data": {
    "isLoggedIn": true,
    "loginTime": "2026-03-12 10:00:00",
    "expireTime": "2026-03-16 10:00:00",
    "hoursSinceLogin": 2.5,
    "hoursUntilExpire": 93.5,
    "tokenPresent": true,
    "message": "已登录 2.5 小时"
  }
}
```

## 搜索公众号

```bash
wechat-spider search "人民日报"
```

返回示例：
```json
{
  "success": true,
  "data": {
    "query": "人民日报",
    "count": 3,
    "accounts": [
      {"wpub_name": "人民日报", "wpub_fakid": "xxx"},
      {"wpub_name": "人民日报评论", "wpub_fakid": "yyy"},
      {"wpub_name": "人民日报文艺", "wpub_fakid": "zzz"}
    ]
  }
}
```

## 爬取文章

### 基础爬取

```bash
wechat-spider scrape "人民日报" --pages 5 --days 30
```

- 获取最近 30 天的文章
- 最多爬取 5 页（每页 5 篇）
- 只获取标题、链接、发布时间

### 获取正文

```bash
wechat-spider scrape "人民日报" --pages 5 --days 30 --content
```

正文为 Markdown 格式。

### 保存到文件

```bash
wechat-spider scrape "人民日报" --pages 5 --days 30 --content --output result.csv
```

CSV 格式包含：公众号、标题、发布时间、链接、内容

## 批量爬取

```bash
wechat-spider batch "人民日报,新华社,CCTV" --pages 3 --days 7 --content
```

- 公众号名称用逗号、分号或空格分隔
- 结果保存到 `~/WeChatSpider/wechat_batch_YYYYMMDD_HHMMSS.csv`

### 指定输出目录

```bash
wechat-spider batch "人民日报,新华社" --pages 3 --days 7 --output-dir ./results
```

## 请求频率

建议请求间隔 >=3 秒，避免被限制：

- 单篇爬取默认间隔：5 秒
- 批量爬取默认间隔：10 秒

可通过 `--interval` 参数调整。

## 作为 Python 库使用

```python
from wechat_article_spider.spider.wechat.login import WeChatSpiderLogin
from wechat_article_spider.spider.wechat.scraper import WeChatScraper, BatchWeChatScraper

# 登录
login = WeChatSpiderLogin()
if login.login():
    token = login.get_token()
    headers = login.get_headers()

    # 搜索
    scraper = WeChatScraper(token, headers)
    accounts = scraper.search_account("人民日报")

    # 爬取
    if accounts:
        fakeid = accounts[0]["wpub_fakid"]
        articles = scraper.get_account_articles("人民日报", fakeid, max_pages=5)

        # 获取正文
        for article in articles:
            scraper.get_article_content_by_url(article)
```

## 错误处理

所有错误通过 JSON 返回：

```json
{
  "success": false,
  "error": "未登录或登录已过期，请先执行 login"
}
```

常见错误：

- `未登录或登录已过期`：需要重新执行 `login`
- `未找到公众号: xxx`：公众号名称不正确
- `请求失败，状态码: xxx`：网络或 API 问题
